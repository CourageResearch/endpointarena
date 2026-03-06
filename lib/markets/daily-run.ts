import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, fdaCalendarEvents, marketAccounts, marketActions, marketPositions, marketRuns, predictionMarkets } from '@/lib/db'
import { MODEL_INFO, type ModelId } from '@/lib/constants'
import {
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
import { getMarketRuntimeConfig, type MarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { MARKET_MODEL_RESPONSE_TIMEOUT_MS, MARKET_RUN_STALE_TIMEOUT_MINUTES, MARKET_RUN_STALE_TIMEOUT_SECONDS } from '@/lib/markets/run-health'
import {
  generateAndStoreModelDecisionSnapshot,
  getMarketActionIdForRun,
  linkSnapshotToMarketAction,
} from '@/lib/model-decision-snapshots'
import { MODEL_DECISION_GENERATORS } from '@/lib/predictions/model-decision-generators'

const DAY_MS = 24 * 60 * 60 * 1000

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

function getMarketAgeInRuns(openedAt: Date, runDate: Date): number {
  const openedRunDate = normalizeRunDate(openedAt)
  return Math.floor((runDate.getTime() - openedRunDate.getTime()) / DAY_MS)
}

function applyRiskCap({
  action,
  requestedUsd,
  accountCash,
  marketOpenedAt,
  runDate,
  config,
}: {
  action: string
  requestedUsd: number
  accountCash: number
  marketOpenedAt: Date
  runDate: Date
  config: MarketRuntimeConfig
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

  const runAge = getMarketAgeInRuns(marketOpenedAt, runDate)
  const inWarmupWindow = config.warmupRunCount > 0 && runAge >= 0 && runAge < config.warmupRunCount
  const maxTradeUsd = inWarmupWindow ? config.warmupMaxTradeUsd : config.steadyMaxTradeUsd
  const buyCashFraction = inWarmupWindow ? config.warmupBuyCashFraction : config.steadyBuyCashFraction
  const tradeCapUsd = action === 'BUY_YES' || action === 'BUY_NO'
    ? Math.min(maxTradeUsd, Math.max(0, accountCash * buyCashFraction))
    : maxTradeUsd

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
    note: `${inWarmupWindow ? 'Warm-up' : 'Steady-state'} cap reduced request to $${cappedAmount.toFixed(2)}.`,
  }
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
    .onConflictDoUpdate({
      target: marketRuns.runDate,
      set: {
        createdAt: now,
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
      },
    })
    .returning()

  return runRecord
}

export async function executeDailyRun(runDate: Date, hooks?: DailyRunHooks): Promise<DailyRunPayload> {
  const normalizedRunDate = normalizeRunDate(runDate)
  const runDateIso = normalizedRunDate.toISOString()
  const modelOrder = rotateModelOrder(normalizedRunDate)

  const [runtimeConfig, openMarkets] = await Promise.all([
    getMarketRuntimeConfig(),
    db.query.predictionMarkets.findMany({
      where: eq(predictionMarkets.status, 'OPEN'),
    }),
  ])

  const openMarketEventIds = Array.from(new Set(openMarkets.map((market) => market.fdaEventId)))
  const openMarketEvents = openMarketEventIds.length > 0
    ? await db.query.fdaCalendarEvents.findMany({
        where: inArray(fdaCalendarEvents.id, openMarketEventIds),
      })
    : []
  const eventById = new Map(openMarketEvents.map((event) => [event.id, event]))
  const orderedOpenMarkets = [...openMarkets].sort((a, b) => {
    const aEvent = eventById.get(a.fdaEventId)
    const bEvent = eventById.get(b.fdaEventId)
    const aPdufaTime = aEvent?.pdufaDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bPdufaTime = bEvent?.pdufaDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    if (aPdufaTime !== bPdufaTime) return aPdufaTime - bPdufaTime

    const aOpenedTime = a.openedAt?.getTime() ?? 0
    const bOpenedTime = b.openedAt?.getTime() ?? 0
    if (aOpenedTime !== bOpenedTime) return aOpenedTime - bOpenedTime

    return a.id.localeCompare(b.id)
  })
  const openMarketContextById = new Map<string, {
    marketId: string
    fdaEventId: string
    drugName: string
    companyName: string
    pdufaDate: string
    marketPriceYes: number
  }>()
  for (const market of orderedOpenMarkets) {
    const event = eventById.get(market.fdaEventId)
    if (!event) continue
    openMarketContextById.set(market.id, {
      marketId: market.id,
      fdaEventId: market.fdaEventId,
      drugName: event.drugName,
      companyName: event.companyName,
      pdufaDate: event.pdufaDate.toISOString(),
      marketPriceYes: market.priceYes,
    })
  }
  const orderedMarketPlan = orderedOpenMarkets
    .map((market) => {
      const event = eventById.get(market.fdaEventId)
      if (!event) return null
      return {
        marketId: market.id,
        fdaEventId: market.fdaEventId,
        drugName: event.drugName,
        companyName: event.companyName,
        pdufaDate: event.pdufaDate.toISOString(),
      }
    })
    .filter((entry): entry is DailyRunPlannedMarket => entry !== null)

  // Ensure newly-added models always have account + position state for existing open markets.
  await ensureMarketAccounts()
  await Promise.all(orderedOpenMarkets.map((market) => ensureMarketPositions(market.id)))

  const totalActions = orderedOpenMarkets.length * modelOrder.length
  const runRecord = await startRunRecord({
    runDate: normalizedRunDate,
    openMarkets: orderedOpenMarkets.length,
    totalActions,
  })

  hooks?.onStart?.({
    runId: runRecord.id,
    runDate: runDateIso,
    modelOrder,
    orderedMarkets: orderedMarketPlan,
    openMarkets: orderedOpenMarkets.length,
    totalActions,
  })

  const results: DailyRunResult[] = []
  let processedActions = 0

  const pushResult = (result: DailyRunResult): void => {
    results.push(result)
    processedActions += 1
    hooks?.onProgress?.({
      completedActions: processedActions,
      totalActions,
      result,
    })
  }

  try {
    for (const [marketIndex, market] of orderedOpenMarkets.entries()) {
      const marketEvent = eventById.get(market.fdaEventId)

      if (!marketEvent) {
        const modelId = modelOrder[0]
        if (!modelId) {
          throw new Error(`Halting daily run: FDA event is missing for market ${market.id} and no models are configured`)
        }
        const message = 'FDA event no longer exists for this market'
        pushResult({
          marketId: market.id,
          fdaEventId: market.fdaEventId,
          modelId,
          action: 'HOLD',
          amountUsd: 0,
          status: 'error',
          detail: message,
        })
        throw new Error(`Halting daily run: ${message} (market ${market.id})`)
      }

      for (const modelId of modelOrder) {
        const existing = await db.query.marketActions.findFirst({
          where: and(
            eq(marketActions.marketId, market.id),
            eq(marketActions.modelId, modelId),
            eq(marketActions.runDate, normalizedRunDate)
          ),
        })

        if (existing) {
          if (existing.status === 'error') {
            await db.delete(marketActions).where(eq(marketActions.id, existing.id))
          } else {
            pushResult({
              marketId: market.id,
              fdaEventId: market.fdaEventId,
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
            where: eq(marketAccounts.modelId, modelId),
          }),
          db.query.marketPositions.findFirst({
            where: and(
              eq(marketPositions.marketId, market.id),
              eq(marketPositions.modelId, modelId)
            ),
          }),
        ])

        if (!account || !position) {
          const message = 'Missing account or position state'
          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            runDate: normalizedRunDate,
            priceYes: market.priceYes,
            message,
            code: 'MISSING_MARKET_STATE',
          })

          const modelName = MODEL_INFO[modelId].fullName
          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          throw new Error(`Halting daily run after ${modelName} failed on ${marketEvent.drugName}: ${message}`)
        }

        const generator = MODEL_DECISION_GENERATORS[modelId]
        if (!generator?.enabled()) {
          const message = `${modelId} generator is disabled because its API key is not configured`
          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            runDate: normalizedRunDate,
            priceYes: market.priceYes,
            message,
            code: 'API_KEY_MISSING',
          })

          const modelName = MODEL_INFO[modelId].fullName
          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          throw new Error(`Halting daily run after ${modelName} failed on ${marketEvent.drugName}: ${message}`)
        }

        let generatedSnapshotId: string | null = null
        try {
          const modelName = MODEL_INFO[modelId].fullName
          const marketOrdinal = marketIndex + 1
          hooks?.onActivity?.({
            completedActions: processedActions,
            totalActions,
            message: `Running ${modelName} on ${marketEvent.drugName} (${marketOrdinal}/${orderedOpenMarkets.length} markets)`,
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            phase: 'running',
          })

          const latestMarket = await db.query.predictionMarkets.findFirst({
            where: eq(predictionMarkets.id, market.id),
          })

          if (!latestMarket || latestMarket.status !== 'OPEN') {
            pushResult({
              marketId: market.id,
              fdaEventId: market.fdaEventId,
              modelId,
              action: 'HOLD',
              amountUsd: 0,
              status: 'skipped',
              detail: 'Market is no longer open',
            })
            continue
          }

          const otherOpenMarkets = Array.from(openMarketContextById.values())
            .filter((entry) => entry.marketId !== latestMarket.id)
            .sort((a, b) => a.pdufaDate.localeCompare(b.pdufaDate))
          const marketsRemainingThisRun = Math.max(0, orderedOpenMarkets.length - (marketIndex + 1))

          const waitStartedAtMs = Date.now()
          hooks?.onActivity?.({
            completedActions: processedActions,
            totalActions,
            message: `Waiting for ${modelName} response... 0s`,
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            phase: 'waiting',
          })
          const waitHeartbeat = setInterval(() => {
            const waitSeconds = Math.max(1, Math.round((Date.now() - waitStartedAtMs) / 1000))
            hooks?.onActivity?.({
              completedActions: processedActions,
              totalActions,
              message: `Waiting for ${modelName} response... ${waitSeconds}s`,
              marketId: market.id,
              fdaEventId: market.fdaEventId,
              modelId,
              phase: 'waiting',
            })
          }, 5000)

          const generatedDecision = await withTimeout(
            generateAndStoreModelDecisionSnapshot({
              runSource: 'cycle',
              modelId,
              runDate: normalizedRunDate,
              event: marketEvent,
              market: latestMarket,
              account,
              position,
              runtimeConfig,
              otherOpenMarkets: otherOpenMarkets.map((entry) => ({
                drugName: entry.drugName,
                companyName: entry.companyName,
                pdufaDate: entry.pdufaDate,
                yesPrice: entry.marketPriceYes,
              })),
            }),
            MARKET_MODEL_RESPONSE_TIMEOUT_MS,
            `${modelName} response`
          ).finally(() => {
            clearInterval(waitHeartbeat)
          })
          generatedSnapshotId = generatedDecision.snapshot.id
          const decision = generatedDecision.decision

          if (!latestMarket.openedAt) {
            throw new Error(`Market ${latestMarket.id} is missing openedAt`)
          }

          const cappedDecision = applyRiskCap({
            action: decision.action.type,
            requestedUsd: decision.action.amountUsd,
            accountCash: account.cashBalance,
            marketOpenedAt: latestMarket.openedAt,
            runDate: normalizedRunDate,
            config: runtimeConfig,
          })
          const explanation = cappedDecision.capApplied && cappedDecision.note
            ? `${decision.action.explanation} ${cappedDecision.note}`.trim()
            : decision.action.explanation

          if (decision.action.type === 'HOLD' || cappedDecision.amountUsd <= 0) {
            await runHoldAction({
              runId: runRecord.id,
              marketId: latestMarket.id,
              fdaEventId: latestMarket.fdaEventId,
              modelId,
              runDate: normalizedRunDate,
              explanation,
              priceYes: latestMarket.priceYes,
            })
            await linkSnapshotToMarketAction(
              generatedDecision.snapshot.id,
              await getMarketActionIdForRun({
                marketId: latestMarket.id,
                modelId,
                runDate: normalizedRunDate,
              })
            )

            pushResult({
              marketId: latestMarket.id,
              fdaEventId: latestMarket.fdaEventId,
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
              modelId,
              runDate: normalizedRunDate,
              side: decision.action.type,
              requestedUsd: cappedDecision.amountUsd,
              explanation,
              maxPositionPerSideShares: runtimeConfig.maxPositionPerSideShares,
            })
            await linkSnapshotToMarketAction(
              generatedDecision.snapshot.id,
              await getMarketActionIdForRun({
                marketId: latestMarket.id,
                modelId,
                runDate: normalizedRunDate,
              })
            )
            const action = buyResult.spent > 0 ? decision.action.type : 'HOLD'

            pushResult({
              marketId: latestMarket.id,
              fdaEventId: latestMarket.fdaEventId,
              modelId,
              action,
              amountUsd: action === 'HOLD' ? 0 : buyResult.spent,
              status: 'ok',
              detail: explanation,
            })

            const context = openMarketContextById.get(latestMarket.id)
            if (context) {
              context.marketPriceYes = buyResult.priceAfter
            }
            continue
          }

          const sellResult = await runSellAction({
            runId: runRecord.id,
            market: latestMarket,
            modelId,
            runDate: normalizedRunDate,
            side: decision.action.type,
            requestedUsd: cappedDecision.amountUsd,
            explanation,
          })
          await linkSnapshotToMarketAction(
            generatedDecision.snapshot.id,
            await getMarketActionIdForRun({
              marketId: latestMarket.id,
              modelId,
              runDate: normalizedRunDate,
            })
          )
          const action = sellResult.proceeds > 0 && sellResult.shares > 0 ? decision.action.type : 'HOLD'

          pushResult({
            marketId: latestMarket.id,
            fdaEventId: latestMarket.fdaEventId,
            modelId,
            action,
            amountUsd: action === 'HOLD' ? 0 : sellResult.proceeds,
            status: 'ok',
            detail: explanation,
          })

          const context = openMarketContextById.get(latestMarket.id)
          if (context) {
            context.marketPriceYes = sellResult.priceAfter
          }
        } catch (error) {
          const latestMarket = await db.query.predictionMarkets.findFirst({
            where: eq(predictionMarkets.id, market.id),
          })
          const price = latestMarket?.priceYes ?? market.priceYes
          const message = error instanceof Error ? error.message : 'Unknown error'
          const errorCode = inferErrorCode(message)

          await recordMarketActionError({
            runId: runRecord.id,
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            runDate: normalizedRunDate,
            priceYes: price,
            message,
            code: errorCode,
          })
          if (typeof generatedSnapshotId === 'string') {
            await linkSnapshotToMarketAction(
              generatedSnapshotId,
              await getMarketActionIdForRun({
                marketId: market.id,
                modelId,
                runDate: normalizedRunDate,
              })
            )
          }

          const modelName = MODEL_INFO[modelId].fullName
          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          throw new Error(`Halting daily run after ${modelName} failed on ${marketEvent.drugName}: ${message}`)
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
      openMarkets: orderedOpenMarkets.length,
      totalActions,
      processedActions,
      summary,
      results,
    }

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
    await db.update(marketRuns)
      .set({
        status: 'failed',
        processedActions,
        okCount: summary.ok,
        errorCount: summary.error,
        skippedCount: summary.skipped,
        failureReason: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketRuns.id, runRecord.id))
    throw error
  }
}
