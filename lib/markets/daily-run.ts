import { and, desc, eq, sql } from 'drizzle-orm'
import {
  db,
  marketAccounts,
  marketActions,
  marketPositions,
  marketRuns,
  predictionMarkets,
} from '@/lib/db'
import { MODEL_INFO, type ModelId } from '@/lib/constants'
import {
  calculateExecutableTradeCaps,
  recordMarketActionError,
  runBuyAction,
  runHoldAction,
  runSellAction,
  upsertDailySnapshots,
} from '@/lib/markets/engine'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import { ConflictError } from '@/lib/errors'
import { getActiveDatabaseTarget } from '@/lib/database-target'
import type { DailyRunHooks, DailyRunPayload, DailyRunPlannedMarket, DailyRunResult, DailyRunSummary } from '@/lib/markets/types'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { getMarketModelResponseTimeoutMs, MARKET_RUN_STALE_TIMEOUT_MINUTES, MARKET_RUN_STALE_TIMEOUT_SECONDS } from '@/lib/markets/run-health'
import {
  generateAndStoreModelDecisionSnapshot,
  linkSnapshotToMarketAction,
  storeImportedModelDecisionSnapshot,
} from '@/lib/model-decision-snapshots'
import {
  createDailyRunPausedError,
  DAILY_RUN_STOPPED_REASON,
  isDailyRunPausedError,
  throwIfDailyRunStopRequested,
} from '@/lib/markets/run-control'
import {
  getModelDecisionGeneratorDisabledReason,
  MODEL_DECISION_GENERATORS,
} from '@/lib/predictions/model-decision-generators'
import { appendTrialRunLog } from '@/lib/trial-run-logs'
import { getModelDecisionParseErrorDetails, type ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import { prepareDailyRunContext } from '@/lib/markets/daily-run-planning'
import {
  getDailyRunAutomationSourceLabel,
  type DailyRunAutomationSource,
} from '@/lib/markets/automation-handoff-shared'

export interface DailyRunExecutionOptions {
  hooks?: DailyRunHooks
  nctNumber?: string
  modelIds?: ModelId[]
  marketIds?: string[]
  importedDecisions?: Map<string, ImportedDailyRunDecision>
  importedDecisionSource?: DailyRunAutomationSource | null
}

type ImportedDailyRunDecision = {
  source: DailyRunAutomationSource
  decision: ModelDecisionResult
}

function summarizeResults(results: DailyRunResult[]): DailyRunSummary {
  return results.reduce<DailyRunSummary>((acc, result) => {
    if (result.status === 'ok') acc.ok += 1
    if (result.status === 'error') acc.error += 1
    if (result.status === 'skipped') acc.skipped += 1
    return acc
  }, { ok: 0, error: 0, skipped: 0 })
}

function inferErrorCode(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('api key')) return 'API_KEY_MISSING'
  if (normalized.includes('rate limit') || normalized.includes('429')) return 'RATE_LIMITED'
  if (normalized.includes('timeout') || normalized.includes('timed out')) return 'TIMEOUT'
  if (normalized.includes('json') || normalized.includes('parse')) return 'PARSE_ERROR'
  return 'UNHANDLED_ERROR'
}

function pauseDailyRun(message: string): never {
  throw createDailyRunPausedError(message)
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
    note: `Portfolio constraints reduced request to $${cappedAmount.toFixed(2)}.`,
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
      throw new ConflictError(`A daily trial cycle is already running (runDate ${activeRunDate}). Wait for it to finish before starting another run.`)
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
  if (getActiveDatabaseTarget() !== 'toy') {
    throw new ConflictError('Legacy daily run is toy-only on season 4. Use /api/admin/season4/model-cycle/run for live season 4 execution.')
  }

  const {
    hooks,
    nctNumber,
    modelIds,
    marketIds,
    importedDecisionSource,
  } = options
  const prepared = await prepareDailyRunContext(runDate, {
    nctNumber,
    modelIds,
    marketIds,
  })
  const normalizedRunDate = prepared.normalizedRunDate
  const runDateIso = prepared.runDateIso
  const runtimeConfig = prepared.runtimeConfig
  const modelOrder = prepared.modelOrder
  const scopedNctNumber = prepared.scopedNctNumber
  const scopedOpenMarkets = prepared.scopedOpenMarkets
  const orderedMarketPlan = prepared.orderedMarketPlan as DailyRunPlannedMarket[]
  const questionById = prepared.questionById
  const actorIdByModelId = prepared.actorIdByModelId

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
  await appendTrialRunLog({
    runId: runRecord.id,
    logType: 'system',
    message: 'Starting daily trial cycle...',
    completedActions: 0,
    totalActions,
    okCount: 0,
    errorCount: 0,
    skippedCount: 0,
  })
  const runConfigMessageParts = [
    modelOrder.length > 0 ? `Models: ${modelOrder.map((modelId) => MODEL_INFO[modelId].fullName).join(', ')}` : null,
    scopedNctNumber ? `Trial ${scopedNctNumber}` : null,
    importedDecisionSource ? `Imported via ${getDailyRunAutomationSourceLabel(importedDecisionSource)}` : null,
  ].filter((value): value is string => Boolean(value))

  if (runConfigMessageParts.length > 0) {
    await appendTrialRunLog({
      runId: runRecord.id,
      logType: 'system',
      message: `Run config: ${runConfigMessageParts.join(' | ')}`,
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
  const importedDecisions = options.importedDecisions ?? null

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
    await appendTrialRunLog({
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

    await appendTrialRunLog({
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
        pauseDailyRun(`${message} (market ${market.id})`)
      }

      for (const modelId of modelOrder) {
        await throwIfDailyRunStopRequested(runRecord.id)
        const actorId = actorIdByModelId.get(modelId)
        if (!actorId) {
          throw new Error(`Halting daily run: market actor is missing for model ${modelId}`)
        }
        const importedTaskKey = `${market.id}:${modelId}`
        const importedDecision = importedDecisions?.get(importedTaskKey) ?? null

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
          pauseDailyRun(`${MODEL_INFO[modelId].fullName} could not continue on ${marketQuestion.trial.shortTitle}: ${message}`)
        }

        if (importedDecisions && !importedDecision) {
          const message = 'Missing imported decision for this market/model step'
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
          pauseDailyRun(`${MODEL_INFO[modelId].fullName} could not continue on ${marketQuestion.trial.shortTitle}: ${message}`)
        }

        const generator = MODEL_DECISION_GENERATORS[modelId]
        if (!importedDecision && !generator?.enabled()) {
          const message = getModelDecisionGeneratorDisabledReason(modelId)
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
          pauseDailyRun(`${MODEL_INFO[modelId].fullName} could not continue on ${marketQuestion.trial.shortTitle}: ${message}`)
        }

        let generatedSnapshotId: string | null = null
        try {
          const modelName = MODEL_INFO[modelId].fullName
          const marketOrdinal = marketIndex + 1
          const importedSourceLabel = importedDecision
            ? getDailyRunAutomationSourceLabel(importedDecision.source)
            : null
          await emitActivity({
            completedActions: processedActions,
            totalActions,
            message: importedSourceLabel
              ? `Applying ${importedSourceLabel} ${modelName} decision on ${marketQuestion.trial.shortTitle} (${marketOrdinal}/${scopedOpenMarkets.length} trials)`
              : `Running ${modelName} on ${marketQuestion.trial.shortTitle} (${marketOrdinal}/${scopedOpenMarkets.length} trials)`,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            modelId,
            phase: 'running',
          })

          const latestMarket = await db.query.predictionMarkets.findFirst({
            columns: predictionMarketColumns,
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

          const generatedDecision = importedDecision
            ? await storeImportedModelDecisionSnapshot({
                runSource: 'cycle',
                runId: runRecord.id,
                modelId,
                actorId,
                runDate: normalizedRunDate,
                trial: marketQuestion.trial,
                trialQuestionId: marketQuestion.id,
                questionPrompt: normalizeTrialQuestionPrompt(marketQuestion.prompt),
                market: latestMarket,
                portfolio: {
                  cashAvailable: account.cashBalance,
                  yesSharesHeld: position.yesShares,
                  noSharesHeld: position.noShares,
                },
                runtimeConfig,
                decision: importedDecision.decision,
              })
            : await (async () => {
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

                return withTimeout(
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
                    portfolio: {
                      cashAvailable: account.cashBalance,
                      yesSharesHeld: position.yesShares,
                      noSharesHeld: position.noShares,
                    },
                    runtimeConfig,
                  }),
                  getMarketModelResponseTimeoutMs(modelId),
                  `${modelName} response`,
                ).finally(() => {
                  clearInterval(waitHeartbeat)
                })
              })()

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
          const detailParts = [
            generatedSnapshotId ? `snapshotId=${generatedSnapshotId}` : null,
            getModelDecisionParseErrorDetails(error),
          ].filter((value): value is string => Boolean(value))

          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            trialQuestionId: market.trialQuestionId,
            actorId,
            runDate: normalizedRunDate,
            priceYes: market.priceYes,
            message,
            code,
            details: detailParts.length > 0 ? detailParts.join('\n\n') : undefined,
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
          pauseDailyRun(`${MODEL_INFO[modelId].fullName} failed on ${marketQuestion.trial.shortTitle}: ${message}`)
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

    await appendTrialRunLog({
      runId: runRecord.id,
      logType: 'system',
      message: 'Daily trial cycle completed',
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
    const pausedByFailure = isDailyRunPausedError(error)
    const stoppedByAdmin = message === DAILY_RUN_STOPPED_REASON

    await appendTrialRunLog({
      runId: runRecord.id,
      logType: stoppedByAdmin || pausedByFailure ? 'system' : 'error',
      message: stoppedByAdmin || pausedByFailure ? message : `RUN FAILED - ${message}`,
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
        failureReason: stoppedByAdmin ? DAILY_RUN_STOPPED_REASON : message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketRuns.id, runRecord.id))

    throw error
  }
}
