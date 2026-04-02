import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  db,
  marketAccounts,
  marketActions,
  marketPositions,
  marketRuns,
  phase2Trials,
  predictionMarkets,
  trialQuestions,
} from '@/lib/db'
import { isModelId, MODEL_INFO, type ModelId } from '@/lib/constants'
import {
  calculateExecutableTradeCaps,
  ensureMarketAccounts,
  ensureMarketPositions,
  normalizeRunDate,
  recordMarketActionError,
  rotateModelOrder,
  runBuyAction,
  runHoldAction,
  runSellAction,
  upsertDailySnapshots,
} from '@/lib/markets/engine'
import { ConflictError } from '@/lib/errors'
import type { DailyRunHooks, DailyRunPayload, DailyRunPlannedMarket, DailyRunResult, DailyRunSummary } from '@/lib/markets/types'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { MARKET_MODEL_RESPONSE_TIMEOUT_MS, MARKET_RUN_STALE_TIMEOUT_MINUTES, MARKET_RUN_STALE_TIMEOUT_SECONDS } from '@/lib/markets/run-health'
import {
  generateAndStoreModelDecisionSnapshot,
  linkSnapshotToMarketAction,
} from '@/lib/model-decision-snapshots'
import { DAILY_RUN_STOPPED_REASON, throwIfDailyRunStopRequested } from '@/lib/markets/run-control'
import {
  getModelDecisionGeneratorDisabledReason,
  MODEL_DECISION_GENERATORS,
  type ModelDecisionGeneratorOptions,
} from '@/lib/predictions/model-decision-generators'
import { getModelActorIds } from '@/lib/market-actors'
import { appendMarketRunLog } from '@/lib/market-run-logs'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

type Phase2OpenMarket = typeof predictionMarkets.$inferSelect & {
  trialQuestionId: string
}

type TrialQuestionWithTrial = typeof trialQuestions.$inferSelect & {
  trial: typeof phase2Trials.$inferSelect
}

export interface DailyRunExecutionOptions {
  hooks?: DailyRunHooks
  nctNumber?: string
  modelIds?: ModelId[]
  claudeProvider?: ModelDecisionGeneratorOptions['claudeProvider']
}

function summarizeResults(results: DailyRunResult[]): DailyRunSummary {
  return results.reduce<DailyRunSummary>((acc, result) => {
    if (result.status === 'ok') acc.ok += 1
    if (result.status === 'error') acc.error += 1
    if (result.status === 'skipped') acc.skipped += 1
    return acc
  }, { ok: 0, error: 0, skipped: 0 })
}

function normalizeScopedNctNumber(value: string): string {
  return value.trim().toUpperCase()
}

function resolveDailyRunModelOrder(runDate: Date, requestedModelIds?: ModelId[]): ModelId[] {
  if (requestedModelIds && requestedModelIds.length > 0) {
    return Array.from(new Set(requestedModelIds))
  }

  const defaultOrder = rotateModelOrder(runDate)
  const rawModelIds = process.env.MARKET_RUN_MODEL_IDS?.trim()
  if (!rawModelIds) {
    return defaultOrder
  }

  const allowedModelIds = Array.from(new Set(
    rawModelIds
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is ModelId => isModelId(value)),
  ))

  if (allowedModelIds.length === 0) {
    throw new Error('MARKET_RUN_MODEL_IDS did not include any valid model ids')
  }

  const allowedModelIdSet = new Set<ModelId>(allowedModelIds)
  const filteredOrder = defaultOrder.filter((modelId) => allowedModelIdSet.has(modelId))
  if (filteredOrder.length === 0) {
    throw new Error('MARKET_RUN_MODEL_IDS did not overlap with the active daily-run model order')
  }

  return filteredOrder
}

function inferErrorCode(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('api key')) return 'API_KEY_MISSING'
  if (normalized.includes('rate limit') || normalized.includes('429')) return 'RATE_LIMITED'
  if (normalized.includes('timeout') || normalized.includes('timed out')) return 'TIMEOUT'
  if (normalized.includes('json') || normalized.includes('parse')) return 'PARSE_ERROR'
  return 'UNHANDLED_ERROR'
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${context} timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
    })

    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function applyRiskCap({
  action,
  requestedUsd,
  market,
  account,
  position,
  runDate,
  config,
}: {
  action: string
  requestedUsd: number
  market: typeof predictionMarkets.$inferSelect
  account: typeof marketAccounts.$inferSelect
  position: typeof marketPositions.$inferSelect
  runDate: Date
  config: Awaited<ReturnType<typeof getMarketRuntimeConfig>>
}): {
  amountUsd: number
  capApplied: boolean
  note: string
} {
  const requested = Math.max(0, requestedUsd)
  if (requested <= 0 || action === 'HOLD') {
    return {
      amountUsd: 0,
      capApplied: false,
      note: '',
    }
  }

  const tradeCaps = calculateExecutableTradeCaps({
    state: {
      qYes: market.qYes,
      qNo: market.qNo,
      b: market.b,
    },
    accountCash: account.cashBalance,
    yesSharesHeld: position.yesShares,
    noSharesHeld: position.noShares,
    marketOpenedAt: market.openedAt,
    runDate,
    config,
  })
  const tradeCapUsd = action === 'BUY_YES'
    ? tradeCaps.maxBuyYesUsd
    : action === 'BUY_NO'
      ? tradeCaps.maxBuyNoUsd
      : action === 'SELL_YES'
        ? tradeCaps.maxSellYesUsd
        : tradeCaps.maxSellNoUsd

  const cappedAmount = Math.max(0, Math.min(requested, tradeCapUsd))
  if (cappedAmount >= requested - 1e-9) {
    return {
      amountUsd: requested,
      capApplied: false,
      note: '',
    }
  }

  return {
    amountUsd: cappedAmount,
    capApplied: true,
    note: `${tradeCaps.inWarmupWindow ? 'Warm-up' : 'Steady-state'} cap reduced request to $${cappedAmount.toFixed(2)}.`,
  }
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

function formatProgressLog(result: DailyRunResult): string {
  const modelName = MODEL_INFO[result.modelId].fullName
  const amountPart = result.amountUsd > 0 ? ` ${formatMoney(result.amountUsd)}` : ''
  return `${modelName} ${result.action}${amountPart} (${result.status}) - ${truncateText(result.detail, 110)}`
}

async function startRunRecord({
  runDate,
  openMarkets,
  totalActions,
}: {
  runDate: Date
  openMarkets: number
  totalActions: number
}) {
  const now = new Date()
  const activeRun = await db.query.marketRuns.findFirst({
    where: eq(marketRuns.status, 'running'),
    orderBy: [desc(marketRuns.updatedAt), desc(marketRuns.createdAt)],
  })

  if (activeRun) {
    const staleFailureReason = `Auto-failed stale run after ${MARKET_RUN_STALE_TIMEOUT_MINUTES}m without heartbeat updates.`
    const staleRunUpdate = await db.update(marketRuns)
      .set({
        status: 'failed',
        failureReason: staleFailureReason,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(marketRuns.id, activeRun.id),
        eq(marketRuns.status, 'running'),
        sql`COALESCE(${marketRuns.updatedAt}, ${marketRuns.createdAt}, ${marketRuns.runDate}) < NOW() - (${MARKET_RUN_STALE_TIMEOUT_SECONDS} * INTERVAL '1 second')`,
      ))
      .returning({ id: marketRuns.id })

    if (staleRunUpdate.length === 0) {
      const activeRunDate = activeRun.runDate.toISOString()
      throw new ConflictError(`A daily market cycle is already running (runDate ${activeRunDate}). Wait for it to finish before starting another run.`)
    }
  }

  const [runRecord] = await db.insert(marketRuns)
    .values({
      runDate,
      status: 'running',
      openMarkets,
      totalActions,
      processedActions: 0,
      okCount: 0,
      errorCount: 0,
      skippedCount: 0,
      failureReason: null,
      updatedAt: now,
      completedAt: null,
    })
    .returning()

  return runRecord
}

export async function executeDailyRun(
  runDate: Date,
  options: DailyRunExecutionOptions = {},
): Promise<DailyRunPayload> {
  const {
    hooks,
    nctNumber,
    modelIds,
    claudeProvider,
  } = options
  const normalizedRunDate = normalizeRunDate(runDate)
  const runDateIso = normalizedRunDate.toISOString()
  const modelOrder = resolveDailyRunModelOrder(normalizedRunDate, modelIds)
  const generatorOptions: ModelDecisionGeneratorOptions | undefined = claudeProvider
    ? { claudeProvider }
    : undefined
  const scopedNctNumber = nctNumber ? normalizeScopedNctNumber(nctNumber) : null

  const [runtimeConfig, rawOpenMarkets] = await Promise.all([
    getMarketRuntimeConfig(),
    db.query.predictionMarkets.findMany({
      where: and(
        eq(predictionMarkets.status, 'OPEN'),
        isNotNull(predictionMarkets.trialQuestionId),
      ),
    }),
  ])

  const openMarkets = rawOpenMarkets.filter((market): market is Phase2OpenMarket => (
    typeof market.trialQuestionId === 'string' && market.trialQuestionId.length > 0
  ))

  const openQuestionIds = Array.from(new Set(openMarkets.map((market) => market.trialQuestionId)))
  const rawOpenQuestions = openQuestionIds.length > 0
    ? await db.query.trialQuestions.findMany({
        where: inArray(trialQuestions.id, openQuestionIds),
        with: {
          trial: true,
        },
      }) as TrialQuestionWithTrial[]
    : []
  const openQuestions = filterSupportedTrialQuestions(rawOpenQuestions)
  const supportedQuestionIds = new Set(openQuestions.map((question) => question.id))
  const supportedOpenMarkets = openMarkets.filter((market) => supportedQuestionIds.has(market.trialQuestionId))

  const questionById = new Map(openQuestions.map((question) => [question.id, question]))
  const orderedOpenMarkets = [...supportedOpenMarkets].sort((a, b) => {
    const aQuestion = questionById.get(a.trialQuestionId)
    const bQuestion = questionById.get(b.trialQuestionId)
    const aDecisionTime = aQuestion?.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bDecisionTime = bQuestion?.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    if (aDecisionTime !== bDecisionTime) return aDecisionTime - bDecisionTime

    const aOpenedTime = a.openedAt?.getTime() ?? 0
    const bOpenedTime = b.openedAt?.getTime() ?? 0
    if (aOpenedTime !== bOpenedTime) return aOpenedTime - bOpenedTime

    return a.id.localeCompare(b.id)
  })
  const scopedOpenMarkets = scopedNctNumber
    ? orderedOpenMarkets.filter((market) => questionById.get(market.trialQuestionId)?.trial.nctNumber.toUpperCase() === scopedNctNumber)
    : orderedOpenMarkets

  if (scopedNctNumber && scopedOpenMarkets.length === 0) {
    throw new Error(`No open market found for ${scopedNctNumber}`)
  }

  const orderedMarketPlan = scopedOpenMarkets
    .map((market) => {
      const question = questionById.get(market.trialQuestionId)
      if (!question) return null

      return {
        marketId: market.id,
        trialQuestionId: market.trialQuestionId,
        trialId: question.trial.id,
        shortTitle: question.trial.shortTitle,
        sponsorName: question.trial.sponsorName,
        decisionDate: question.trial.estPrimaryCompletionDate.toISOString(),
      } satisfies DailyRunPlannedMarket
    })
    .filter((entry): entry is DailyRunPlannedMarket => entry !== null)

  await ensureMarketAccounts()
  await Promise.all(scopedOpenMarkets.map((market) => ensureMarketPositions(market.id)))
  const actorIdByModelId = await getModelActorIds(modelOrder)

  const totalActions = scopedOpenMarkets.length * modelOrder.length
  const runRecord = await startRunRecord({
    runDate: normalizedRunDate,
    openMarkets: scopedOpenMarkets.length,
    totalActions,
  })

  hooks?.onStart?.({
    runId: runRecord.id,
    runDate: runDateIso,
    modelOrder,
    orderedMarkets: orderedMarketPlan,
    openMarkets: scopedOpenMarkets.length,
    totalActions,
  })
  await appendMarketRunLog({
    runId: runRecord.id,
    logType: 'system',
    message: 'Starting daily market cycle...',
    completedActions: 0,
    totalActions,
    okCount: 0,
    errorCount: 0,
    skippedCount: 0,
  })
  if (scopedNctNumber || modelIds?.length || claudeProvider) {
    const scopedMessageParts = [
      scopedNctNumber ? `Trial ${scopedNctNumber}` : null,
      modelOrder.length > 0 ? `Models: ${modelOrder.map((modelId) => MODEL_INFO[modelId].fullName).join(', ')}` : null,
      claudeProvider ? `Claude provider: ${claudeProvider}` : null,
    ].filter((value): value is string => Boolean(value))

    await appendMarketRunLog({
      runId: runRecord.id,
      logType: 'system',
      message: `Scoped run: ${scopedMessageParts.join(' | ')}`,
      completedActions: 0,
      totalActions,
      okCount: 0,
      errorCount: 0,
      skippedCount: 0,
    })
  }

  const results: DailyRunResult[] = []
  let processedActions = 0
  let okCount = 0
  let errorCount = 0
  let skippedCount = 0

  const persistRunHeartbeat = async (): Promise<void> => {
    await db.update(marketRuns)
      .set({
        totalActions,
        processedActions,
        okCount,
        errorCount,
        skippedCount,
        updatedAt: new Date(),
      })
      .where(eq(marketRuns.id, runRecord.id))
  }

  const emitActivity = async (input: {
    completedActions: number
    totalActions: number
    message: string
    marketId?: string
    trialQuestionId?: string
    actorId?: string | null
    modelId?: ModelId
    phase?: 'running' | 'waiting'
  }): Promise<void> => {
    await appendMarketRunLog({
      runId: runRecord.id,
      logType: 'activity',
      message: input.message,
      completedActions: input.completedActions,
      totalActions: input.totalActions,
      okCount,
      errorCount,
      skippedCount,
      marketId: input.marketId ?? null,
      trialQuestionId: input.trialQuestionId ?? null,
      actorId: input.actorId ?? null,
      activityPhase: input.phase ?? null,
    })
    await persistRunHeartbeat()
    hooks?.onActivity?.(input)
  }

  const pushResult = async (result: DailyRunResult): Promise<void> => {
    results.push(result)
    processedActions += 1
    if (result.status === 'ok') okCount += 1
    if (result.status === 'error') errorCount += 1
    if (result.status === 'skipped') skippedCount += 1

    await appendMarketRunLog({
      runId: runRecord.id,
      logType: result.status === 'error' ? 'error' : 'progress',
      message: formatProgressLog(result),
      completedActions: processedActions,
      totalActions,
      okCount,
      errorCount,
      skippedCount,
      marketId: result.marketId,
      trialQuestionId: result.trialQuestionId,
      actorId: result.actorId,
      action: result.action,
      actionStatus: result.status,
      amountUsd: result.amountUsd,
    })
    await persistRunHeartbeat()
    hooks?.onProgress?.({
      completedActions: processedActions,
      totalActions,
      result,
    })
  }

  try {
    await throwIfDailyRunStopRequested(runRecord.id)

    for (const [marketIndex, market] of scopedOpenMarkets.entries()) {
      await throwIfDailyRunStopRequested(runRecord.id)
      const marketQuestion = questionById.get(market.trialQuestionId)

      if (!marketQuestion) {
        const modelId = modelOrder[0]
        if (!modelId) {
          throw new Error(`Halting daily run: trial question is missing for market ${market.id} and no models are configured`)
        }
        const message = 'Trial question no longer exists for this market'
        await pushResult({
          marketId: market.id,
          trialQuestionId: market.trialQuestionId,
          actorId: null,
          modelId,
          action: 'HOLD',
          amountUsd: 0,
          status: 'error',
          detail: message,
        })
        throw new Error(`Halting daily run: ${message} (market ${market.id})`)
      }

      for (const modelId of modelOrder) {
        await throwIfDailyRunStopRequested(runRecord.id)
        const actorId = actorIdByModelId.get(modelId)
        if (!actorId) {
          throw new Error(`Halting daily run: market actor is missing for model ${modelId}`)
        }

        const existing = await db.query.marketActions.findFirst({
          where: and(
            eq(marketActions.marketId, market.id),
            eq(marketActions.actorId, actorId),
            eq(marketActions.runDate, normalizedRunDate),
            eq(marketActions.actionSource, 'cycle'),
          ),
        })

        if (existing) {
          if (existing.status === 'error') {
            await db.delete(marketActions).where(eq(marketActions.id, existing.id))
          } else {
            await pushResult({
              marketId: market.id,
              trialQuestionId: market.trialQuestionId,
              actorId,
              modelId,
              action: existing.action,
              amountUsd: existing.usdAmount,
              status: 'skipped',
              detail: 'Action already exists for this model/date',
            })
            continue
          }
        }

        const [account, position] = await Promise.all([
          db.query.marketAccounts.findFirst({
            where: eq(marketAccounts.actorId, actorId),
          }),
          db.query.marketPositions.findFirst({
            where: and(
              eq(marketPositions.marketId, market.id),
              eq(marketPositions.actorId, actorId),
            ),
          }),
        ])

        if (!account || !position) {
          const message = 'Missing account or position state'
          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            runDate: normalizedRunDate,
            priceYes: market.priceYes,
            message,
            code: 'MISSING_MARKET_STATE',
          })

          await pushResult({
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          continue
        }

        const generator = MODEL_DECISION_GENERATORS[modelId]
        if (!generator?.enabled(generatorOptions)) {
          const message = getModelDecisionGeneratorDisabledReason(modelId, generatorOptions)
          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            runDate: normalizedRunDate,
            priceYes: market.priceYes,
            message,
            code: inferErrorCode(message),
          })

          await pushResult({
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          continue
        }

        let generatedSnapshotId: string | null = null
        try {
          const modelName = MODEL_INFO[modelId].fullName
          const marketOrdinal = marketIndex + 1
          await emitActivity({
            completedActions: processedActions,
            totalActions,
            message: `Running ${modelName} on ${marketQuestion.trial.shortTitle} (${marketOrdinal}/${scopedOpenMarkets.length} markets)`,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            modelId,
            phase: 'running',
          })

          const latestMarket = await db.query.predictionMarkets.findFirst({
            where: eq(predictionMarkets.id, market.id),
          })

          if (!latestMarket || latestMarket.status !== 'OPEN') {
            await pushResult({
              marketId: market.id,
              trialQuestionId: market.trialQuestionId,
              actorId,
              modelId,
              action: 'HOLD',
              amountUsd: 0,
              status: 'skipped',
              detail: 'Market is no longer open',
            })
            continue
          }

          const waitStartedAtMs = Date.now()
          await emitActivity({
            completedActions: processedActions,
            totalActions,
            message: `Waiting for ${modelName} response... 0s`,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            modelId,
            phase: 'waiting',
          })

          const waitHeartbeat = setInterval(() => {
            const waitSeconds = Math.max(1, Math.round((Date.now() - waitStartedAtMs) / 1000))
            void emitActivity({
              completedActions: processedActions,
              totalActions,
              message: `Waiting for ${modelName} response... ${waitSeconds}s`,
              marketId: market.id,
              trialQuestionId: market.trialQuestionId,
              actorId,
              modelId,
              phase: 'waiting',
            })
          }, 5000)

          const generatedDecision = await withTimeout(
            generateAndStoreModelDecisionSnapshot({
              runSource: 'cycle',
              runId: runRecord.id,
              modelId,
              actorId,
              runDate: normalizedRunDate,
              trial: marketQuestion.trial,
              trialQuestionId: marketQuestion.id,
              questionPrompt: normalizeTrialQuestionPrompt(marketQuestion.prompt),
              market: latestMarket,
              account,
              position,
              runtimeConfig,
              generatorOptions,
            }),
            MARKET_MODEL_RESPONSE_TIMEOUT_MS,
            `${modelName} response`,
          ).finally(() => {
            clearInterval(waitHeartbeat)
          })

          await throwIfDailyRunStopRequested(runRecord.id)
          generatedSnapshotId = generatedDecision.snapshot.id
          const decision = generatedDecision.decision

          const cappedDecision = applyRiskCap({
            action: decision.action.type,
            requestedUsd: decision.action.amountUsd,
            market: latestMarket,
            account,
            position,
            runDate: normalizedRunDate,
            config: runtimeConfig,
          })
          const explanation = cappedDecision.capApplied && cappedDecision.note
            ? `${decision.action.explanation} ${cappedDecision.note}`.trim()
            : decision.action.explanation

          if (decision.action.type === 'HOLD' || cappedDecision.amountUsd <= 0) {
            const actionRecord = await runHoldAction({
              runId: runRecord.id,
              marketId: latestMarket.id,
              trialQuestionId: latestMarket.trialQuestionId ?? market.trialQuestionId,
              actorId,
              runDate: normalizedRunDate,
              explanation,
              priceYes: latestMarket.priceYes,
            })
            await linkSnapshotToMarketAction(generatedDecision.snapshot.id, actionRecord.id)

            await pushResult({
              marketId: latestMarket.id,
              trialQuestionId: latestMarket.trialQuestionId ?? market.trialQuestionId,
              actorId,
              modelId,
              action: 'HOLD',
              amountUsd: 0,
              status: 'ok',
              detail: explanation,
            })
            continue
          }

          if (decision.action.type === 'BUY_YES' || decision.action.type === 'BUY_NO') {
            const buyResult = await runBuyAction({
              runId: runRecord.id,
              market: latestMarket,
              actorId,
              runDate: normalizedRunDate,
              side: decision.action.type,
              requestedUsd: cappedDecision.amountUsd,
              explanation,
            })
            await linkSnapshotToMarketAction(generatedDecision.snapshot.id, buyResult.actionId)

            await pushResult({
              marketId: latestMarket.id,
              trialQuestionId: latestMarket.trialQuestionId ?? market.trialQuestionId,
              actorId,
              modelId,
              action: decision.action.type,
              amountUsd: buyResult.spent,
              status: 'ok',
              detail: explanation,
            })
            continue
          }

          const sellResult = await runSellAction({
            runId: runRecord.id,
            market: latestMarket,
            actorId,
            runDate: normalizedRunDate,
            side: decision.action.type,
            requestedUsd: cappedDecision.amountUsd,
            explanation,
          })
          await linkSnapshotToMarketAction(generatedDecision.snapshot.id, sellResult.actionId)

          await pushResult({
            marketId: latestMarket.id,
            trialQuestionId: latestMarket.trialQuestionId ?? market.trialQuestionId,
            actorId,
            modelId,
            action: decision.action.type,
            amountUsd: sellResult.proceeds,
            status: 'ok',
            detail: explanation,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown action error'
          const code = inferErrorCode(message)

          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            runDate: normalizedRunDate,
            priceYes: market.priceYes,
            message,
            code,
            details: generatedSnapshotId ? `snapshotId=${generatedSnapshotId}` : undefined,
          })

          await pushResult({
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })

          continue
        }
      }
    }

    await upsertDailySnapshots(normalizedRunDate)

    const summary = summarizeResults(results)
    const payload: DailyRunPayload = {
      success: true,
      runId: runRecord.id,
      runDate: runDateIso,
      modelOrder,
      orderedMarkets: orderedMarketPlan,
      openMarkets: scopedOpenMarkets.length,
      totalActions,
      processedActions,
      summary,
      results,
    }

    await appendMarketRunLog({
      runId: runRecord.id,
      logType: 'system',
      message: 'Daily market cycle completed',
      completedActions: processedActions,
      totalActions,
      okCount: summary.ok,
      errorCount: summary.error,
      skippedCount: summary.skipped,
    })

    await db.update(marketRuns)
      .set({
        status: 'completed',
        processedActions,
        okCount: summary.ok,
        errorCount: summary.error,
        skippedCount: summary.skipped,
        failureReason: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketRuns.id, runRecord.id))

    return payload
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Daily run failed'
    const summary = summarizeResults(results)

    await appendMarketRunLog({
      runId: runRecord.id,
      logType: message === DAILY_RUN_STOPPED_REASON ? 'system' : 'error',
      message: message === DAILY_RUN_STOPPED_REASON ? message : `RUN FAILED - ${message}`,
      completedActions: processedActions,
      totalActions,
      okCount: summary.ok,
      errorCount: summary.error,
      skippedCount: summary.skipped,
    })

    await db.update(marketRuns)
      .set({
        status: 'failed',
        processedActions,
        okCount: summary.ok,
        errorCount: summary.error,
        skippedCount: summary.skipped,
        failureReason: message === DAILY_RUN_STOPPED_REASON ? DAILY_RUN_STOPPED_REASON : message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketRuns.id, runRecord.id))

    throw error
  }
}
