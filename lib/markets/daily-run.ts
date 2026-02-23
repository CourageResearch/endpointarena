import { and, eq, inArray } from 'drizzle-orm'
import { db, fdaCalendarEvents, marketAccounts, marketActions, marketPositions, marketRuns, predictionMarkets } from '@/lib/db'
import { type ModelId } from '@/lib/constants'
import { MARKET_DECISION_GENERATORS } from '@/lib/predictions/market-generators'
import { normalizeRunDate, recordMarketActionError, rotateModelOrder, runBuyAction, runHoldAction, runSellAction, upsertDailySnapshots } from '@/lib/markets/engine'
import { ConflictError } from '@/lib/errors'
import type { DailyRunHooks, DailyRunPayload, DailyRunResult, DailyRunSummary } from '@/lib/markets/types'
import { getMarketRuntimeConfig, type MarketRuntimeConfig } from '@/lib/markets/runtime-config'

const DAY_MS = 24 * 60 * 60 * 1000
const STALE_RUNNING_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000

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

function getMarketAgeInRuns(openedAt: Date, runDate: Date): number {
  const openedRunDate = normalizeRunDate(openedAt)
  return Math.floor((runDate.getTime() - openedRunDate.getTime()) / DAY_MS)
}

function applyWarmupCap({
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

  if (config.warmupRunCount <= 0) {
    return {
      amountUsd: requested,
      capApplied: false,
      note: '',
    }
  }

  const runAge = getMarketAgeInRuns(marketOpenedAt, runDate)
  if (runAge < 0 || runAge >= config.warmupRunCount) {
    return {
      amountUsd: requested,
      capApplied: false,
      note: '',
    }
  }

  const tradeCapUsd = action === 'BUY_YES' || action === 'BUY_NO'
    ? Math.min(config.warmupMaxTradeUsd, Math.max(0, accountCash * config.warmupBuyCashFraction))
    : config.warmupMaxTradeUsd

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
    note: `Warm-up cap reduced request to $${cappedAmount.toFixed(2)}.`,
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
    const heartbeatAt = activeRun.updatedAt ?? activeRun.createdAt ?? activeRun.runDate
    const heartbeatAgeMs = now.getTime() - heartbeatAt.getTime()

    if (heartbeatAgeMs < STALE_RUNNING_RUN_TIMEOUT_MS) {
      const activeRunDate = activeRun.runDate.toISOString()
      throw new ConflictError(`A daily market cycle is already running (runDate ${activeRunDate}). Wait for it to finish before starting another run.`)
    }

    await db.update(marketRuns)
      .set({
        status: 'failed',
        failureReason: `Auto-failed stale run after ${Math.round(heartbeatAgeMs / 60000)}m without heartbeat updates.`,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(marketRuns.id, activeRun.id))
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

  const totalActions = orderedOpenMarkets.length * modelOrder.length
  const runRecord = await startRunRecord({
    runDate: normalizedRunDate,
    openMarkets: orderedOpenMarkets.length,
    totalActions,
  })

  hooks?.onStart?.({
    runDate: runDateIso,
    modelOrder,
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
      const event = eventById.get(market.fdaEventId)

      if (!event) {
        for (const modelId of modelOrder) {
          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: 'FDA event no longer exists for this market',
          })
        }
        continue
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

          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          continue
        }

        const generator = MARKET_DECISION_GENERATORS[modelId]
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

          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })
          continue
        }

        try {
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

          const decision = await generator.generator({
            runDateIso,
            modelId,
            drugName: event.drugName,
            companyName: event.companyName,
            symbols: event.symbols,
            applicationType: event.applicationType,
            pdufaDate: event.pdufaDate.toISOString(),
            eventDescription: event.eventDescription,
            therapeuticArea: event.therapeuticArea,
            marketPriceYes: latestMarket.priceYes,
            marketPriceNo: 1 - latestMarket.priceYes,
            accountCash: account.cashBalance,
            positionYesShares: position.yesShares,
            positionNoShares: position.noShares,
            totalOpenMarkets: orderedOpenMarkets.length,
            marketsRemainingThisRun,
            otherOpenMarkets,
          })

          if (!latestMarket.openedAt) {
            throw new Error(`Market ${latestMarket.id} is missing openedAt`)
          }

          const cappedDecision = applyWarmupCap({
            action: decision.action,
            requestedUsd: decision.amountUsd,
            accountCash: account.cashBalance,
            marketOpenedAt: latestMarket.openedAt,
            runDate: normalizedRunDate,
            config: runtimeConfig,
          })
          const explanation = cappedDecision.capApplied && cappedDecision.note
            ? `${decision.explanation} ${cappedDecision.note}`.trim()
            : decision.explanation

          if (decision.action === 'HOLD' || cappedDecision.amountUsd <= 0) {
            await runHoldAction({
              runId: runRecord.id,
              marketId: latestMarket.id,
              fdaEventId: latestMarket.fdaEventId,
              modelId,
              runDate: normalizedRunDate,
              explanation,
              priceYes: latestMarket.priceYes,
            })

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

          if (decision.action === 'BUY_YES' || decision.action === 'BUY_NO') {
            const buyResult = await runBuyAction({
              runId: runRecord.id,
              market: latestMarket,
              modelId,
              runDate: normalizedRunDate,
              side: decision.action,
              requestedUsd: cappedDecision.amountUsd,
              explanation,
            })
            const action = buyResult.spent > 0 ? decision.action : 'HOLD'

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
            side: decision.action,
            requestedUsd: cappedDecision.amountUsd,
            explanation,
          })
          const action = sellResult.proceeds > 0 && sellResult.shares > 0 ? decision.action : 'HOLD'

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

          pushResult({
            marketId: market.id,
            fdaEventId: market.fdaEventId,
            modelId,
            action: 'HOLD',
            amountUsd: 0,
            status: 'error',
            detail: message,
          })

          // Parse failures are recorded on the action row and surfaced in run
          // results, but should not halt the entire cycle for other models/markets.
          if (errorCode === 'PARSE_ERROR') {
            continue
          }
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
    await db.update(marketRuns)
      .set({
        status: 'failed',
        processedActions,
        failureReason: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketRuns.id, runRecord.id))
    throw error
  }
}
