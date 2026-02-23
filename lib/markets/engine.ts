import { db, fdaCalendarEvents, marketAccounts, marketActions, marketDailySnapshots, marketPositions, marketPriceSnapshots, predictionMarkets } from '@/lib/db'
import { MODEL_IDS, type ModelId } from '@/lib/constants'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DEFAULT_LMSR_B, HISTORICAL_PDUFA_APPROVAL_BASELINE, MARKET_STARTING_CASH, type MarketActionType, type MarketOutcome } from './constants'
import { ConfigurationError, ConflictError, NotFoundError } from '@/lib/errors'
import { getMarketRuntimeConfig } from './runtime-config'

const OPENING_PROBABILITY_FLOOR = 0.05
const OPENING_PROBABILITY_CEIL = 0.95

export type MarketState = {
  qYes: number
  qNo: number
  b: number
}

type BuyMarketAction = Extract<MarketActionType, 'BUY_YES' | 'BUY_NO'>
type SellMarketAction = Extract<MarketActionType, 'SELL_YES' | 'SELL_NO'>

export function normalizeRunDate(input: Date = new Date()): Date {
  const normalized = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
  return normalized
}

export function rotateModelOrder(runDate: Date): ModelId[] {
  const dayNumber = Math.floor(normalizeRunDate(runDate).getTime() / (1000 * 60 * 60 * 24))
  const offset = ((dayNumber % MODEL_IDS.length) + MODEL_IDS.length) % MODEL_IDS.length
  return MODEL_IDS.map((_, i) => MODEL_IDS[(i + offset) % MODEL_IDS.length])
}

function clampProbability(probability: number): number {
  if (!Number.isFinite(probability)) return 0.5
  return Math.max(OPENING_PROBABILITY_FLOOR, Math.min(OPENING_PROBABILITY_CEIL, probability))
}

function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b)
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m))
}

function logSubExp(x: number, y: number): number {
  if (x <= y) {
    throw new Error('Invalid logSubExp arguments: x must be greater than y')
  }
  return x + Math.log1p(-Math.exp(y - x))
}

export function lmsrCost({ qYes, qNo, b }: MarketState): number {
  return b * logSumExp(qYes / b, qNo / b)
}

export function lmsrPriceYes({ qYes, qNo, b }: MarketState): number {
  const z = (qNo - qYes) / b
  if (z > 40) return 0
  if (z < -40) return 1
  return 1 / (1 + Math.exp(z))
}

export function createInitialMarketState(openingProbability: number, b: number = DEFAULT_LMSR_B): MarketState {
  const p = clampProbability(openingProbability)
  const delta = b * Math.log(p / (1 - p))
  return {
    qYes: delta / 2,
    qNo: -delta / 2,
    b,
  }
}

export function executeLmsrBudgetTrade(
  state: MarketState,
  side: BuyMarketAction,
  budgetUsd: number
): {
  qYes: number
  qNo: number
  shares: number
  priceBefore: number
  priceAfter: number
} {
  const budget = Math.max(0, budgetUsd)
  if (budget <= 0) {
    const samePrice = lmsrPriceYes(state)
    return {
      qYes: state.qYes,
      qNo: state.qNo,
      shares: 0,
      priceBefore: samePrice,
      priceAfter: samePrice,
    }
  }

  const { qYes, qNo, b } = state
  const priceBefore = lmsrPriceYes(state)
  const baseLog = logSumExp(qYes / b, qNo / b)
  const targetLog = baseLog + budget / b

  let nextQYes = qYes
  let nextQNo = qNo

  if (side === 'BUY_YES') {
    const next = b * logSubExp(targetLog, qNo / b)
    nextQYes = next
  } else {
    const next = b * logSubExp(targetLog, qYes / b)
    nextQNo = next
  }

  const shares = side === 'BUY_YES' ? nextQYes - qYes : nextQNo - qNo
  const priceAfter = lmsrPriceYes({ qYes: nextQYes, qNo: nextQNo, b })

  return {
    qYes: nextQYes,
    qNo: nextQNo,
    shares,
    priceBefore,
    priceAfter,
  }
}

export function executeLmsrShareSale(
  state: MarketState,
  side: SellMarketAction,
  sharesToSell: number
): {
  qYes: number
  qNo: number
  shares: number
  proceeds: number
  priceBefore: number
  priceAfter: number
} {
  const shares = Math.max(0, sharesToSell)
  const priceBefore = lmsrPriceYes(state)

  if (shares <= 0) {
    return {
      qYes: state.qYes,
      qNo: state.qNo,
      shares: 0,
      proceeds: 0,
      priceBefore,
      priceAfter: priceBefore,
    }
  }

  const nextQYes = side === 'SELL_YES' ? state.qYes - shares : state.qYes
  const nextQNo = side === 'SELL_NO' ? state.qNo - shares : state.qNo
  const nextState = { qYes: nextQYes, qNo: nextQNo, b: state.b }
  const proceeds = Math.max(0, lmsrCost(state) - lmsrCost(nextState))
  const priceAfter = lmsrPriceYes(nextState)

  return {
    qYes: nextQYes,
    qNo: nextQNo,
    shares,
    proceeds,
    priceBefore,
    priceAfter,
  }
}

function solveConstrainedSaleForProceeds(
  state: MarketState,
  side: SellMarketAction,
  heldShares: number,
  proceedsUsd: number
): {
  qYes: number
  qNo: number
  shares: number
  proceeds: number
  priceBefore: number
  priceAfter: number
} {
  const maxShares = Math.max(0, heldShares)
  const targetProceeds = Math.max(0, proceedsUsd)
  const zeroSale = executeLmsrShareSale(state, side, 0)

  if (maxShares <= 0 || targetProceeds <= 0) {
    return zeroSale
  }

  const maxSale = executeLmsrShareSale(state, side, maxShares)
  if (maxSale.proceeds <= 0) {
    return zeroSale
  }
  if (targetProceeds >= maxSale.proceeds - 1e-9) {
    return maxSale
  }

  let lowShares = 0
  let highShares = maxShares
  let lowSale = zeroSale

  // Proceeds are monotonic in sold shares. Solve for the largest sale that
  // does not exceed the target proceeds and never exceeds held shares.
  for (let i = 0; i < 56; i++) {
    const midShares = (lowShares + highShares) / 2
    const midSale = executeLmsrShareSale(state, side, midShares)
    if (midSale.proceeds <= targetProceeds) {
      lowShares = midShares
      lowSale = midSale
    } else {
      highShares = midShares
    }
  }

  return lowSale
}

export async function calculateHistoricalApprovalRate(): Promise<number> {
  // Use an external historical benchmark instead of local DB composition.
  return clampProbability(HISTORICAL_PDUFA_APPROVAL_BASELINE)
}

export async function ensureMarketAccounts(): Promise<void> {
  for (const modelId of MODEL_IDS) {
    await db.insert(marketAccounts)
      .values({
        modelId,
        startingCash: MARKET_STARTING_CASH,
        cashBalance: MARKET_STARTING_CASH,
      })
      .onConflictDoNothing({ target: marketAccounts.modelId })
  }
}

export async function ensureMarketPositions(marketId: string): Promise<void> {
  for (const modelId of MODEL_IDS) {
    await db.insert(marketPositions)
      .values({
        marketId,
        modelId,
      })
      .onConflictDoNothing({ target: [marketPositions.marketId, marketPositions.modelId] })
  }
}

export async function openMarketForEvent(fdaEventId: string) {
  await ensureMarketAccounts()

  const event = await db.query.fdaCalendarEvents.findFirst({
    where: eq(fdaCalendarEvents.id, fdaEventId),
  })

  if (!event) {
    throw new NotFoundError('FDA event not found')
  }

  if (event.outcome !== 'Pending') {
    throw new ConflictError('Cannot open market for an event that already has a final outcome')
  }

  const existing = await db.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.fdaEventId, fdaEventId),
  })

  if (existing) {
    if (existing.status === 'OPEN') {
      await ensureMarketPositions(existing.id)
      return existing
    }
    throw new ConflictError('Market already exists and is resolved')
  }

  const [openingProbability, runtimeConfig] = await Promise.all([
    calculateHistoricalApprovalRate(),
    getMarketRuntimeConfig(),
  ])

  const initialLiquidityB = Math.max(1, runtimeConfig.openingLmsrB)
  const initialState = createInitialMarketState(openingProbability, initialLiquidityB)

  const [market] = await db.insert(predictionMarkets)
    .values({
      fdaEventId,
      status: 'OPEN',
      openingProbability,
      b: initialLiquidityB,
      qYes: initialState.qYes,
      qNo: initialState.qNo,
      priceYes: lmsrPriceYes(initialState),
      openedAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  await ensureMarketPositions(market.id)
  const runDate = normalizeRunDate(new Date())

  await db.insert(marketPriceSnapshots)
    .values({
      marketId: market.id,
      snapshotDate: runDate,
      priceYes: market.priceYes,
      qYes: market.qYes,
      qNo: market.qNo,
    })
    .onConflictDoNothing({ target: [marketPriceSnapshots.marketId, marketPriceSnapshots.snapshotDate] })

  return market
}

export async function getOpenMarkets() {
  return db.query.predictionMarkets.findMany({
    where: eq(predictionMarkets.status, 'OPEN'),
  })
}

export async function runHoldAction({
  runId,
  marketId,
  fdaEventId,
  modelId,
  runDate,
  explanation,
  priceYes,
}: {
  runId?: string
  marketId: string
  fdaEventId: string
  modelId: ModelId
  runDate: Date
  explanation: string
  priceYes: number
}): Promise<void> {
  await db.insert(marketActions)
    .values({
      runId,
      marketId,
      fdaEventId,
      modelId,
      runDate,
      action: 'HOLD',
      usdAmount: 0,
      sharesDelta: 0,
      priceBefore: priceYes,
      priceAfter: priceYes,
      explanation,
      status: 'ok',
    })
    .onConflictDoUpdate({
      target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
      set: {
        runId,
        action: 'HOLD',
        usdAmount: 0,
        sharesDelta: 0,
        priceBefore: priceYes,
        priceAfter: priceYes,
        explanation,
        status: 'ok',
        errorCode: null,
        errorDetails: null,
        error: null,
      },
    })
}

export async function recordMarketActionError({
  runId,
  marketId,
  fdaEventId,
  modelId,
  runDate,
  priceYes,
  message,
  code,
  details,
}: {
  runId?: string
  marketId: string
  fdaEventId: string
  modelId: ModelId
  runDate: Date
  priceYes: number
  message: string
  code?: string
  details?: string
}): Promise<void> {
  await db.insert(marketActions)
    .values({
      runId,
      marketId,
      fdaEventId,
      modelId,
      runDate,
      action: 'HOLD',
      usdAmount: 0,
      sharesDelta: 0,
      priceBefore: priceYes,
      priceAfter: priceYes,
      explanation: `Error: ${message}`,
      status: 'error',
      errorCode: code ?? null,
      errorDetails: details ?? null,
      error: message,
    })
    .onConflictDoUpdate({
      target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
      set: {
        runId,
        action: 'HOLD',
        usdAmount: 0,
        sharesDelta: 0,
        priceBefore: priceYes,
        priceAfter: priceYes,
        explanation: `Error: ${message}`,
        status: 'error',
        errorCode: code ?? null,
        errorDetails: details ?? null,
        error: message,
      },
    })
}

export async function runBuyAction({
  runId,
  market,
  modelId,
  runDate,
  side,
  requestedUsd,
  explanation,
}: {
  runId?: string
  market: typeof predictionMarkets.$inferSelect
  modelId: ModelId
  runDate: Date
  side: Extract<MarketActionType, 'BUY_YES' | 'BUY_NO'>
  requestedUsd: number
  explanation: string
}): Promise<{
  spent: number
  shares: number
  priceBefore: number
  priceAfter: number
}> {
  return db.transaction(async (tx) => {
    // Lock and re-read rows inside the transaction so trade math is based on
    // current q/cash/position state, preventing stale overwrite races.
    await tx.execute(sql`
      SELECT 1
      FROM ${predictionMarkets}
      WHERE ${predictionMarkets.id} = ${market.id}
      FOR UPDATE
    `)
    await tx.execute(sql`
      SELECT 1
      FROM ${marketAccounts}
      WHERE ${marketAccounts.modelId} = ${modelId}
      FOR UPDATE
    `)
    await tx.execute(sql`
      SELECT 1
      FROM ${marketPositions}
      WHERE ${marketPositions.marketId} = ${market.id}
        AND ${marketPositions.modelId} = ${modelId}
      FOR UPDATE
    `)

    const freshMarket = await tx.query.predictionMarkets.findFirst({
      where: eq(predictionMarkets.id, market.id),
    })

    if (!freshMarket) {
      throw new NotFoundError(`Market ${market.id} not found`)
    }

    if (freshMarket.status !== 'OPEN') {
      throw new ConflictError(`Market ${freshMarket.id} is no longer open`)
    }

    const account = await tx.query.marketAccounts.findFirst({
      where: eq(marketAccounts.modelId, modelId),
    })

    if (!account) {
      throw new ConfigurationError(`Missing market account for model ${modelId}`)
    }

    const spent = Math.max(0, Math.min(requestedUsd, account.cashBalance))
    if (spent <= 0) {
      await tx.insert(marketActions)
        .values({
          runId,
          marketId: freshMarket.id,
          fdaEventId: freshMarket.fdaEventId,
          modelId,
          runDate,
          action: 'HOLD',
          usdAmount: 0,
          sharesDelta: 0,
          priceBefore: freshMarket.priceYes,
          priceAfter: freshMarket.priceYes,
          explanation,
          status: 'ok',
        })
        .onConflictDoUpdate({
          target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
          set: {
            runId,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
            errorCode: null,
            errorDetails: null,
            error: null,
          },
        })

      return {
        spent: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
      }
    }

    const position = await tx.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, freshMarket.id),
        eq(marketPositions.modelId, modelId)
      ),
    })

    if (!position) {
      throw new ConfigurationError(`Missing position for model ${modelId} in market ${freshMarket.id}`)
    }

    const trade = executeLmsrBudgetTrade(
      {
        qYes: freshMarket.qYes,
        qNo: freshMarket.qNo,
        b: freshMarket.b,
      },
      side,
      spent
    )

    await tx.update(predictionMarkets)
      .set({
        qYes: trade.qYes,
        qNo: trade.qNo,
        priceYes: trade.priceAfter,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, freshMarket.id))

    await tx.update(marketAccounts)
      .set({
        cashBalance: account.cashBalance - spent,
        updatedAt: new Date(),
      })
      .where(eq(marketAccounts.modelId, modelId))

    await tx.update(marketPositions)
      .set({
        yesShares: side === 'BUY_YES' ? position.yesShares + trade.shares : position.yesShares,
        noShares: side === 'BUY_NO' ? position.noShares + trade.shares : position.noShares,
        updatedAt: new Date(),
      })
      .where(eq(marketPositions.id, position.id))

    await tx.insert(marketActions)
      .values({
        runId,
        marketId: freshMarket.id,
        fdaEventId: freshMarket.fdaEventId,
        modelId,
        runDate,
        action: side,
        usdAmount: spent,
        sharesDelta: trade.shares,
        priceBefore: trade.priceBefore,
        priceAfter: trade.priceAfter,
        explanation,
        status: 'ok',
      })
      .onConflictDoUpdate({
        target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
        set: {
          runId,
          action: side,
          usdAmount: spent,
          sharesDelta: trade.shares,
          priceBefore: trade.priceBefore,
          priceAfter: trade.priceAfter,
          explanation,
          status: 'ok',
          errorCode: null,
          errorDetails: null,
          error: null,
        },
      })

    return {
      spent,
      shares: trade.shares,
      priceBefore: trade.priceBefore,
      priceAfter: trade.priceAfter,
    }
  })
}

export async function runSellAction({
  runId,
  market,
  modelId,
  runDate,
  side,
  requestedUsd,
  explanation,
}: {
  runId?: string
  market: typeof predictionMarkets.$inferSelect
  modelId: ModelId
  runDate: Date
  side: SellMarketAction
  requestedUsd: number
  explanation: string
}): Promise<{
  proceeds: number
  shares: number
  priceBefore: number
  priceAfter: number
}> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 1
      FROM ${predictionMarkets}
      WHERE ${predictionMarkets.id} = ${market.id}
      FOR UPDATE
    `)
    await tx.execute(sql`
      SELECT 1
      FROM ${marketAccounts}
      WHERE ${marketAccounts.modelId} = ${modelId}
      FOR UPDATE
    `)
    await tx.execute(sql`
      SELECT 1
      FROM ${marketPositions}
      WHERE ${marketPositions.marketId} = ${market.id}
        AND ${marketPositions.modelId} = ${modelId}
      FOR UPDATE
    `)

    const freshMarket = await tx.query.predictionMarkets.findFirst({
      where: eq(predictionMarkets.id, market.id),
    })

    if (!freshMarket) {
      throw new NotFoundError(`Market ${market.id} not found`)
    }

    if (freshMarket.status !== 'OPEN') {
      throw new ConflictError(`Market ${freshMarket.id} is no longer open`)
    }

    const account = await tx.query.marketAccounts.findFirst({
      where: eq(marketAccounts.modelId, modelId),
    })

    if (!account) {
      throw new ConfigurationError(`Missing market account for model ${modelId}`)
    }

    const position = await tx.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, freshMarket.id),
        eq(marketPositions.modelId, modelId)
      ),
    })

    if (!position) {
      throw new ConfigurationError(`Missing position for model ${modelId} in market ${freshMarket.id}`)
    }

    const heldShares = side === 'SELL_YES' ? Math.max(0, position.yesShares) : Math.max(0, position.noShares)
    const requestedProceeds = Math.max(0, requestedUsd)
    const state = {
      qYes: freshMarket.qYes,
      qNo: freshMarket.qNo,
      b: freshMarket.b,
    }

    if (heldShares <= 0 || requestedProceeds <= 0) {
      await tx.insert(marketActions)
        .values({
          runId,
          marketId: freshMarket.id,
          fdaEventId: freshMarket.fdaEventId,
          modelId,
          runDate,
          action: 'HOLD',
          usdAmount: 0,
          sharesDelta: 0,
          priceBefore: freshMarket.priceYes,
          priceAfter: freshMarket.priceYes,
          explanation,
          status: 'ok',
        })
        .onConflictDoUpdate({
          target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
          set: {
            runId,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
            errorCode: null,
            errorDetails: null,
            error: null,
          },
        })

      return {
        proceeds: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
      }
    }

    const maxSale = executeLmsrShareSale(state, side, heldShares)
    const proceeds = Math.max(0, Math.min(requestedProceeds, maxSale.proceeds))

    if (proceeds <= 0) {
      await tx.insert(marketActions)
        .values({
          runId,
          marketId: freshMarket.id,
          fdaEventId: freshMarket.fdaEventId,
          modelId,
          runDate,
          action: 'HOLD',
          usdAmount: 0,
          sharesDelta: 0,
          priceBefore: freshMarket.priceYes,
          priceAfter: freshMarket.priceYes,
          explanation,
          status: 'ok',
        })
        .onConflictDoUpdate({
          target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
          set: {
            runId,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
            errorCode: null,
            errorDetails: null,
            error: null,
          },
        })

      return {
        proceeds: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
      }
    }

    const sale = solveConstrainedSaleForProceeds(state, side, heldShares, proceeds)

    const soldShares = Math.min(heldShares, Math.max(0, sale.shares))
    const saleProceeds = Math.max(0, sale.proceeds)

    if (soldShares <= 0 || saleProceeds <= 0) {
      await tx.insert(marketActions)
        .values({
          runId,
          marketId: freshMarket.id,
          fdaEventId: freshMarket.fdaEventId,
          modelId,
          runDate,
          action: 'HOLD',
          usdAmount: 0,
          sharesDelta: 0,
          priceBefore: freshMarket.priceYes,
          priceAfter: freshMarket.priceYes,
          explanation,
          status: 'ok',
        })
        .onConflictDoUpdate({
          target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
          set: {
            runId,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
            errorCode: null,
            errorDetails: null,
            error: null,
          },
        })

      return {
        proceeds: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
      }
    }

    await tx.update(predictionMarkets)
      .set({
        qYes: sale.qYes,
        qNo: sale.qNo,
        priceYes: sale.priceAfter,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, freshMarket.id))

    await tx.update(marketAccounts)
      .set({
        cashBalance: account.cashBalance + saleProceeds,
        updatedAt: new Date(),
      })
      .where(eq(marketAccounts.modelId, modelId))

    await tx.update(marketPositions)
      .set({
        yesShares: side === 'SELL_YES' ? Math.max(0, position.yesShares - soldShares) : position.yesShares,
        noShares: side === 'SELL_NO' ? Math.max(0, position.noShares - soldShares) : position.noShares,
        updatedAt: new Date(),
      })
      .where(eq(marketPositions.id, position.id))

    await tx.insert(marketActions)
      .values({
        runId,
        marketId: freshMarket.id,
        fdaEventId: freshMarket.fdaEventId,
        modelId,
        runDate,
        action: side,
        usdAmount: saleProceeds,
        sharesDelta: -soldShares,
        priceBefore: sale.priceBefore,
        priceAfter: sale.priceAfter,
        explanation,
        status: 'ok',
      })
      .onConflictDoUpdate({
        target: [marketActions.marketId, marketActions.modelId, marketActions.runDate],
        set: {
          runId,
          action: side,
          usdAmount: saleProceeds,
          sharesDelta: -soldShares,
          priceBefore: sale.priceBefore,
          priceAfter: sale.priceAfter,
          explanation,
          status: 'ok',
          errorCode: null,
          errorDetails: null,
          error: null,
        },
      })

    return {
      proceeds: saleProceeds,
      shares: soldShares,
      priceBefore: sale.priceBefore,
      priceAfter: sale.priceAfter,
    }
  })
}

export async function upsertDailySnapshots(runDate: Date): Promise<void> {
  const normalizedRunDate = normalizeRunDate(runDate)

  const openMarkets = await db.query.predictionMarkets.findMany({
    where: eq(predictionMarkets.status, 'OPEN'),
  })

  if (openMarkets.length > 0) {
    await db.insert(marketPriceSnapshots)
      .values(openMarkets.map((market) => ({
        marketId: market.id,
        snapshotDate: normalizedRunDate,
        priceYes: market.priceYes,
        qYes: market.qYes,
        qNo: market.qNo,
      })))
      .onConflictDoUpdate({
        target: [marketPriceSnapshots.marketId, marketPriceSnapshots.snapshotDate],
        set: {
          priceYes: sql`excluded.price_yes`,
          qYes: sql`excluded.q_yes`,
          qNo: sql`excluded.q_no`,
        },
      })
  }

  const marketIds = openMarkets.map((market) => market.id)

  const allPositions = marketIds.length > 0
    ? await db.query.marketPositions.findMany({
        where: inArray(marketPositions.marketId, marketIds),
      })
    : []

  const marketPriceById = new Map(openMarkets.map((market) => [market.id, market.priceYes]))
  const positionsByModel = new Map<string, typeof allPositions>()

  for (const position of allPositions) {
    const current = positionsByModel.get(position.modelId) || []
    current.push(position)
    positionsByModel.set(position.modelId, current)
  }

  const accounts = await db.query.marketAccounts.findMany()

  for (const account of accounts) {
    const positions = positionsByModel.get(account.modelId) || []

    let positionsValue = 0
    for (const position of positions) {
      const priceYes = marketPriceById.get(position.marketId)
      if (priceYes === undefined) continue

      positionsValue += (position.yesShares * priceYes) + (position.noShares * (1 - priceYes))
    }

    const totalEquity = account.cashBalance + positionsValue

    await db.insert(marketDailySnapshots)
      .values({
        snapshotDate: normalizedRunDate,
        modelId: account.modelId,
        cashBalance: account.cashBalance,
        positionsValue,
        totalEquity,
      })
      .onConflictDoUpdate({
        target: [marketDailySnapshots.modelId, marketDailySnapshots.snapshotDate],
        set: {
          cashBalance: account.cashBalance,
          positionsValue,
          totalEquity,
        },
      })
  }
}

export async function resolveMarketForEvent(fdaEventId: string, outcome: MarketOutcome): Promise<void> {
  const market = await db.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.fdaEventId, fdaEventId),
  })

  if (!market) return

  const positions = await db.query.marketPositions.findMany({
    where: eq(marketPositions.marketId, market.id),
  })

  // If already resolved to a different outcome, rebalance payouts instead of throwing.
  if (market.status === 'RESOLVED' && market.resolvedOutcome && market.resolvedOutcome !== outcome) {
    for (const position of positions) {
      const previousPayout = market.resolvedOutcome === 'Approved' ? position.yesShares : position.noShares
      const nextPayout = outcome === 'Approved' ? position.yesShares : position.noShares
      const delta = nextPayout - previousPayout
      if (delta === 0) continue

      await db.update(marketAccounts)
        .set({
          cashBalance: sql`${marketAccounts.cashBalance} + ${delta}`,
          updatedAt: new Date(),
        })
        .where(eq(marketAccounts.modelId, position.modelId))
    }

    await db.update(predictionMarkets)
      .set({
        resolvedOutcome: outcome,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, market.id))

    await upsertDailySnapshots(new Date())
    return
  }

  if (market.status === 'RESOLVED') {
    return
  }

  for (const position of positions) {
    const payout = outcome === 'Approved' ? position.yesShares : position.noShares
    if (payout <= 0) continue

    await db.update(marketAccounts)
      .set({
        cashBalance: sql`${marketAccounts.cashBalance} + ${payout}`,
        updatedAt: new Date(),
      })
      .where(eq(marketAccounts.modelId, position.modelId))
  }

  await db.update(predictionMarkets)
    .set({
      status: 'RESOLVED',
      resolvedOutcome: outcome,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(predictionMarkets.id, market.id))

  await upsertDailySnapshots(new Date())
}

export async function reopenMarketForEvent(fdaEventId: string): Promise<void> {
  const market = await db.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.fdaEventId, fdaEventId),
  })

  if (!market || market.status !== 'RESOLVED' || !market.resolvedOutcome) {
    return
  }

  const positions = await db.query.marketPositions.findMany({
    where: eq(marketPositions.marketId, market.id),
  })

  // Undo prior settlement payout when outcome is moved back to Pending.
  for (const position of positions) {
    const previousPayout = market.resolvedOutcome === 'Approved' ? position.yesShares : position.noShares
    if (previousPayout <= 0) continue

    await db.update(marketAccounts)
      .set({
        cashBalance: sql`${marketAccounts.cashBalance} - ${previousPayout}`,
        updatedAt: new Date(),
      })
      .where(eq(marketAccounts.modelId, position.modelId))
  }

  await db.update(predictionMarkets)
    .set({
      status: 'OPEN',
      resolvedOutcome: null,
      resolvedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(predictionMarkets.id, market.id))

  await upsertDailySnapshots(new Date())
}
