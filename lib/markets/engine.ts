import {
  db,
  marketAccounts,
  marketActions,
  marketDailySnapshots,
  marketPositions,
  marketPriceSnapshots,
  predictionMarkets,
  trialQuestions,
} from '@/lib/db'
import { MODEL_IDS, type ModelId } from '@/lib/constants'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DEFAULT_BINARY_MARKET_BASELINE, DEFAULT_LMSR_B, MARKET_STARTING_CASH, type MarketActionType, type MarketOutcome } from './constants'
import { ConfigurationError, ConflictError, NotFoundError } from '@/lib/errors'
import { getMarketRuntimeConfig, type MarketRuntimeConfig } from './runtime-config'
import { getModelActorIds } from '@/lib/market-actors'

const OPENING_PROBABILITY_FLOOR = 0.05
const OPENING_PROBABILITY_CEIL = 0.95
const DAY_MS = 24 * 60 * 60 * 1000

type MarketState = {
  qYes: number
  qNo: number
  b: number
}

type TradeCapConfig = Pick<
  MarketRuntimeConfig,
  'warmupRunCount' |
  'warmupMaxTradeUsd' |
  'warmupBuyCashFraction' |
  'steadyMaxTradeUsd' |
  'steadyBuyCashFraction' |
  'maxPositionPerSideShares'
>

type BuyMarketAction = Extract<MarketActionType, 'BUY_YES' | 'BUY_NO'>
type SellMarketAction = Extract<MarketActionType, 'SELL_YES' | 'SELL_NO'>
type MarketActionSource = 'cycle' | 'human'
type ExecutableTradeCaps = {
  maxBuyUsd: number
  maxBuyYesUsd: number
  maxBuyNoUsd: number
  maxSellYesUsd: number
  maxSellNoUsd: number
  maxTradeUsd: number
  inWarmupWindow: boolean
}

type PersistedMarketAction = typeof marketActions.$inferSelect
type MarketDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type PersistMarketActionInput = {
  runId?: string | null
  marketId: string
  trialQuestionId?: string | null
  actorId: string
  runDate: Date
  actionSource: MarketActionSource
  action: MarketActionType
  usdAmount: number
  sharesDelta: number
  priceBefore: number
  priceAfter: number
  explanation: string
  status: 'ok' | 'error' | 'skipped'
  errorCode?: string | null
  errorDetails?: string | null
  error?: string | null
}

export function normalizeRunDate(input: Date = new Date()): Date {
  const normalized = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
  return normalized
}

export function rotateModelOrder(runDate: Date): ModelId[] {
  const dayNumber = Math.floor(normalizeRunDate(runDate).getTime() / (1000 * 60 * 60 * 24))
  const offset = ((dayNumber % MODEL_IDS.length) + MODEL_IDS.length) % MODEL_IDS.length
  return MODEL_IDS.map((_, i) => MODEL_IDS[(i + offset) % MODEL_IDS.length])
}

function resolveActionSource(runId: string | undefined, actionSource?: MarketActionSource): MarketActionSource {
  if (actionSource) return actionSource
  return runId ? 'cycle' : 'human'
}

function getMarketAgeInRuns(openedAt: Date, runDate: Date): number {
  const normalizedOpenedAt = normalizeRunDate(openedAt)
  const normalizedRunDate = normalizeRunDate(runDate)
  return Math.floor((normalizedRunDate.getTime() - normalizedOpenedAt.getTime()) / DAY_MS)
}

async function persistMarketAction(
  client: MarketDbClient,
  input: PersistMarketActionInput,
): Promise<PersistedMarketAction> {
  const runDate = normalizeRunDate(input.runDate)
  const baseValues = {
    runId: input.actionSource === 'cycle' ? input.runId ?? null : null,
    marketId: input.marketId,
    trialQuestionId: input.trialQuestionId ?? null,
    actorId: input.actorId,
    runDate,
    actionSource: input.actionSource,
    action: input.action,
    usdAmount: input.usdAmount,
    sharesDelta: input.sharesDelta,
    priceBefore: input.priceBefore,
    priceAfter: input.priceAfter,
    explanation: input.explanation,
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorDetails: input.errorDetails ?? null,
    error: input.error ?? null,
  } as const

  if (input.actionSource === 'cycle') {
    if (!input.runId) {
      throw new ConfigurationError('Cycle market actions require a runId')
    }

    const [actionRecord] = await client.insert(marketActions)
      .values(baseValues)
      .onConflictDoUpdate({
        target: [marketActions.marketId, marketActions.actorId, marketActions.runDate],
        targetWhere: sql`${marketActions.actionSource} = 'cycle'`,
        set: {
          runId: input.runId,
          actionSource: 'cycle',
          action: input.action,
          usdAmount: input.usdAmount,
          sharesDelta: input.sharesDelta,
          priceBefore: input.priceBefore,
          priceAfter: input.priceAfter,
          explanation: input.explanation,
          status: input.status,
          errorCode: input.errorCode ?? null,
          errorDetails: input.errorDetails ?? null,
          error: input.error ?? null,
        },
      })
      .returning()

    return actionRecord
  }

  const [actionRecord] = await client.insert(marketActions)
    .values(baseValues)
    .returning()

  return actionRecord
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

function lmsrCost({ qYes, qNo, b }: MarketState): number {
  return b * logSumExp(qYes / b, qNo / b)
}

function lmsrPriceYes({ qYes, qNo, b }: MarketState): number {
  const z = (qNo - qYes) / b
  if (z > 40) return 0
  if (z < -40) return 1
  return 1 / (1 + Math.exp(z))
}

function createInitialMarketState(openingProbability: number, b: number = DEFAULT_LMSR_B): MarketState {
  const p = clampProbability(openingProbability)
  const delta = b * Math.log(p / (1 - p))
  return {
    qYes: delta / 2,
    qNo: -delta / 2,
    b,
  }
}

function executeLmsrBudgetTrade(
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

function buyCostForShares(
  state: MarketState,
  side: BuyMarketAction,
  sharesToBuy: number
): number {
  const shares = Math.max(0, sharesToBuy)
  if (shares <= 0) return 0

  const nextQYes = side === 'BUY_YES' ? state.qYes + shares : state.qYes
  const nextQNo = side === 'BUY_NO' ? state.qNo + shares : state.qNo

  return Math.max(0, lmsrCost({ qYes: nextQYes, qNo: nextQNo, b: state.b }) - lmsrCost(state))
}

export function calculateExecutableTradeCaps(args: {
  state: MarketState
  accountCash: number
  yesSharesHeld: number
  noSharesHeld: number
  marketOpenedAt: Date | null | undefined
  runDate: Date
  config: TradeCapConfig
}): ExecutableTradeCaps {
  const openedAt = args.marketOpenedAt ?? args.runDate
  const runAge = getMarketAgeInRuns(openedAt, args.runDate)
  const inWarmupWindow = args.config.warmupRunCount > 0 && runAge >= 0 && runAge < args.config.warmupRunCount
  const maxTradeUsd = inWarmupWindow ? args.config.warmupMaxTradeUsd : args.config.steadyMaxTradeUsd
  const buyCashFraction = inWarmupWindow ? args.config.warmupBuyCashFraction : args.config.steadyBuyCashFraction
  const cashCapUsd = Math.max(0, Math.min(args.accountCash, maxTradeUsd, args.accountCash * buyCashFraction))
  const yesSharesHeld = Math.max(0, args.yesSharesHeld)
  const noSharesHeld = Math.max(0, args.noSharesHeld)
  const remainingYesCapacity = Math.max(0, args.config.maxPositionPerSideShares - yesSharesHeld)
  const remainingNoCapacity = Math.max(0, args.config.maxPositionPerSideShares - noSharesHeld)
  const maxBuyYesUsd = Math.max(0, Math.min(cashCapUsd, buyCostForShares(args.state, 'BUY_YES', remainingYesCapacity)))
  const maxBuyNoUsd = Math.max(0, Math.min(cashCapUsd, buyCostForShares(args.state, 'BUY_NO', remainingNoCapacity)))
  const maxSellYesUsd = Math.max(0, Math.min(maxTradeUsd, executeLmsrShareSale(args.state, 'SELL_YES', yesSharesHeld).proceeds))
  const maxSellNoUsd = Math.max(0, Math.min(maxTradeUsd, executeLmsrShareSale(args.state, 'SELL_NO', noSharesHeld).proceeds))

  return {
    maxBuyUsd: Math.max(maxBuyYesUsd, maxBuyNoUsd),
    maxBuyYesUsd,
    maxBuyNoUsd,
    maxSellYesUsd,
    maxSellNoUsd,
    maxTradeUsd,
    inWarmupWindow,
  }
}

function executeLmsrShareSale(
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

async function calculateHistoricalApprovalRate(): Promise<number> {
  return clampProbability(DEFAULT_BINARY_MARKET_BASELINE)
}

export async function ensureMarketAccounts(dbClient: MarketDbClient = db): Promise<void> {
  const actorIdByModelId = await getModelActorIds(MODEL_IDS, dbClient)
  for (const modelId of MODEL_IDS) {
    const actorId = actorIdByModelId.get(modelId)
    if (!actorId) continue
    await dbClient.insert(marketAccounts)
      .values({
        actorId,
        startingCash: MARKET_STARTING_CASH,
        cashBalance: MARKET_STARTING_CASH,
      })
      .onConflictDoNothing({ target: marketAccounts.actorId })
  }
}

export async function ensureMarketPositions(marketId: string, dbClient: MarketDbClient = db): Promise<void> {
  const actorIdByModelId = await getModelActorIds(MODEL_IDS, dbClient)
  for (const modelId of MODEL_IDS) {
    const actorId = actorIdByModelId.get(modelId)
    if (!actorId) continue
    await dbClient.insert(marketPositions)
      .values({
        marketId,
        actorId,
      })
      .onConflictDoNothing({ target: [marketPositions.marketId, marketPositions.actorId] })
  }
}

export async function openMarketForTrialQuestion(
  trialQuestionId: string,
  dbClient: MarketDbClient = db,
) {
  await ensureMarketAccounts(dbClient)

  const question = await dbClient.query.trialQuestions.findFirst({
    where: eq(trialQuestions.id, trialQuestionId),
    with: {
      trial: true,
    },
  })

  if (!question) {
    throw new NotFoundError('Trial question not found')
  }

  if (question.status !== 'live' || !question.isBettable) {
    throw new ConflictError('Cannot open a market for a non-live question')
  }

  if (question.outcome !== 'Pending') {
    throw new ConflictError('Cannot open a market for a question that already has a final outcome')
  }

  const existing = await dbClient.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.trialQuestionId, trialQuestionId),
  })

  if (existing) {
    if (existing.status === 'OPEN') {
      await ensureMarketPositions(existing.id, dbClient)
      return existing
    }
    throw new ConflictError('Market already exists and is resolved')
  }

  const [openingProbability, runtimeConfig] = await Promise.all([
    calculateHistoricalApprovalRate(),
    getMarketRuntimeConfig(dbClient),
  ])

  const initialLiquidityB = Math.max(1, runtimeConfig.openingLmsrB)
  const initialState = createInitialMarketState(openingProbability, initialLiquidityB)

  const [market] = await dbClient.insert(predictionMarkets)
    .values({
      trialQuestionId,
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

  await ensureMarketPositions(market.id, dbClient)
  const runDate = normalizeRunDate(new Date())

  await dbClient.insert(marketPriceSnapshots)
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

async function getOpenMarkets() {
  return db.query.predictionMarkets.findMany({
    where: eq(predictionMarkets.status, 'OPEN'),
  })
}

export async function runHoldAction({
  runId,
  marketId,
  trialQuestionId,
  actorId,
  runDate,
  explanation,
  priceYes,
  actionSource,
}: {
  runId?: string
  marketId: string
  trialQuestionId?: string | null
  actorId: string
  runDate: Date
  explanation: string
  priceYes: number
  actionSource?: MarketActionSource
}): Promise<PersistedMarketAction> {
  return persistMarketAction(db, {
    runId,
    marketId,
    trialQuestionId,
    actorId,
    runDate,
    actionSource: resolveActionSource(runId, actionSource),
    action: 'HOLD',
    usdAmount: 0,
    sharesDelta: 0,
    priceBefore: priceYes,
    priceAfter: priceYes,
    explanation,
    status: 'ok',
  })
}

export async function recordMarketActionError({
  runId,
  marketId,
  trialQuestionId,
  actorId,
  runDate,
  priceYes,
  message,
  code,
  details,
  actionSource,
}: {
  runId?: string
  marketId: string
  trialQuestionId?: string | null
  actorId: string
  runDate: Date
  priceYes: number
  message: string
  code?: string
  details?: string
  actionSource?: MarketActionSource
}): Promise<PersistedMarketAction> {
  return persistMarketAction(db, {
    runId,
    marketId,
    trialQuestionId,
    actorId,
    runDate,
    actionSource: resolveActionSource(runId, actionSource),
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
}

export async function runBuyAction({
  runId,
  market,
  actorId,
  runDate,
  side,
  requestedUsd,
  explanation,
  maxPositionPerSideShares,
  actionSource,
}: {
  runId?: string
  market: typeof predictionMarkets.$inferSelect
  actorId: string
  runDate: Date
  side: Extract<MarketActionType, 'BUY_YES' | 'BUY_NO'>
  requestedUsd: number
  explanation: string
  maxPositionPerSideShares?: number
  actionSource?: MarketActionSource
}): Promise<{
  spent: number
  shares: number
  priceBefore: number
  priceAfter: number
  actionId: string | null
}> {
  const configuredMaxPositionPerSideShares = Number.isFinite(maxPositionPerSideShares)
    ? Math.max(0, Number(maxPositionPerSideShares))
    : (await getMarketRuntimeConfig()).maxPositionPerSideShares
  const resolvedActionSource = resolveActionSource(runId, actionSource)

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
      WHERE ${marketAccounts.actorId} = ${actorId}
      FOR UPDATE
    `)
    await tx.execute(sql`
      SELECT 1
      FROM ${marketPositions}
      WHERE ${marketPositions.marketId} = ${market.id}
        AND ${marketPositions.actorId} = ${actorId}
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
      where: eq(marketAccounts.actorId, actorId),
    })

    if (!account) {
      throw new ConfigurationError(`Missing market account for actor ${actorId}`)
    }

    const position = await tx.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, freshMarket.id),
        eq(marketPositions.actorId, actorId)
      ),
    })

    if (!position) {
      throw new ConfigurationError(`Missing position for actor ${actorId} in market ${freshMarket.id}`)
    }

    const requestedSpend = Math.max(0, requestedUsd)
    const state = {
      qYes: freshMarket.qYes,
      qNo: freshMarket.qNo,
      b: freshMarket.b,
    }
    const heldSideShares = side === 'BUY_YES' ? Math.max(0, position.yesShares) : Math.max(0, position.noShares)
    const remainingShareCapacity = Math.max(0, configuredMaxPositionPerSideShares - heldSideShares)
    const maxSpendByPositionCap = buyCostForShares(state, side, remainingShareCapacity)
    const uncappedSpend = Math.max(0, Math.min(requestedSpend, account.cashBalance))
    const spent = Math.max(0, Math.min(uncappedSpend, maxSpendByPositionCap))
    const positionCapApplied = maxSpendByPositionCap < uncappedSpend - 1e-9
    const resolvedExplanation = positionCapApplied
      ? `${explanation} Position cap reduced buy size.`
      : explanation

    if (spent <= 0) {
      const actionRecord = resolvedActionSource === 'cycle'
        ? await persistMarketAction(tx, {
            runId,
            marketId: freshMarket.id,
            trialQuestionId: freshMarket.trialQuestionId,
            actorId,
            runDate,
            actionSource: resolvedActionSource,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation: resolvedExplanation,
            status: 'ok',
          })
        : null

      return {
        spent: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
        actionId: actionRecord?.id ?? null,
      }
    }

    const trade = executeLmsrBudgetTrade(
      state,
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
      .where(eq(marketAccounts.actorId, actorId))

    await tx.update(marketPositions)
      .set({
        yesShares: side === 'BUY_YES' ? position.yesShares + trade.shares : position.yesShares,
        noShares: side === 'BUY_NO' ? position.noShares + trade.shares : position.noShares,
        updatedAt: new Date(),
      })
      .where(eq(marketPositions.id, position.id))

    const actionRecord = await persistMarketAction(tx, {
      runId,
      marketId: freshMarket.id,
      trialQuestionId: freshMarket.trialQuestionId,
      actorId,
      runDate,
      actionSource: resolvedActionSource,
      action: side,
      usdAmount: spent,
      sharesDelta: trade.shares,
      priceBefore: trade.priceBefore,
      priceAfter: trade.priceAfter,
      explanation: resolvedExplanation,
      status: 'ok',
    })

    return {
      spent,
      shares: trade.shares,
      priceBefore: trade.priceBefore,
      priceAfter: trade.priceAfter,
      actionId: actionRecord.id,
    }
  })
}

export async function runSellAction({
  runId,
  market,
  actorId,
  runDate,
  side,
  requestedUsd,
  explanation,
  actionSource,
}: {
  runId?: string
  market: typeof predictionMarkets.$inferSelect
  actorId: string
  runDate: Date
  side: SellMarketAction
  requestedUsd: number
  explanation: string
  actionSource?: MarketActionSource
}): Promise<{
  proceeds: number
  shares: number
  priceBefore: number
  priceAfter: number
  actionId: string | null
}> {
  const resolvedActionSource = resolveActionSource(runId, actionSource)

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
      WHERE ${marketAccounts.actorId} = ${actorId}
      FOR UPDATE
    `)
    await tx.execute(sql`
      SELECT 1
      FROM ${marketPositions}
      WHERE ${marketPositions.marketId} = ${market.id}
        AND ${marketPositions.actorId} = ${actorId}
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
      where: eq(marketAccounts.actorId, actorId),
    })

    if (!account) {
      throw new ConfigurationError(`Missing market account for actor ${actorId}`)
    }

    const position = await tx.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, freshMarket.id),
        eq(marketPositions.actorId, actorId)
      ),
    })

    if (!position) {
      throw new ConfigurationError(`Missing position for actor ${actorId} in market ${freshMarket.id}`)
    }

    const heldShares = side === 'SELL_YES' ? Math.max(0, position.yesShares) : Math.max(0, position.noShares)
    const requestedProceeds = Math.max(0, requestedUsd)
    const state = {
      qYes: freshMarket.qYes,
      qNo: freshMarket.qNo,
      b: freshMarket.b,
    }

    if (heldShares <= 0 || requestedProceeds <= 0) {
      const actionRecord = resolvedActionSource === 'cycle'
        ? await persistMarketAction(tx, {
            runId,
            marketId: freshMarket.id,
            trialQuestionId: freshMarket.trialQuestionId,
            actorId,
            runDate,
            actionSource: resolvedActionSource,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
          })
        : null

      return {
        proceeds: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
        actionId: actionRecord?.id ?? null,
      }
    }

    const maxSale = executeLmsrShareSale(state, side, heldShares)
    const proceeds = Math.max(0, Math.min(requestedProceeds, maxSale.proceeds))

    if (proceeds <= 0) {
      const actionRecord = resolvedActionSource === 'cycle'
        ? await persistMarketAction(tx, {
            runId,
            marketId: freshMarket.id,
            trialQuestionId: freshMarket.trialQuestionId,
            actorId,
            runDate,
            actionSource: resolvedActionSource,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
          })
        : null

      return {
        proceeds: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
        actionId: actionRecord?.id ?? null,
      }
    }

    const sale = solveConstrainedSaleForProceeds(state, side, heldShares, proceeds)

    const soldShares = Math.min(heldShares, Math.max(0, sale.shares))
    const saleProceeds = Math.max(0, sale.proceeds)

    if (soldShares <= 0 || saleProceeds <= 0) {
      const actionRecord = resolvedActionSource === 'cycle'
        ? await persistMarketAction(tx, {
            runId,
            marketId: freshMarket.id,
            trialQuestionId: freshMarket.trialQuestionId,
            actorId,
            runDate,
            actionSource: resolvedActionSource,
            action: 'HOLD',
            usdAmount: 0,
            sharesDelta: 0,
            priceBefore: freshMarket.priceYes,
            priceAfter: freshMarket.priceYes,
            explanation,
            status: 'ok',
          })
        : null

      return {
        proceeds: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
        actionId: actionRecord?.id ?? null,
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
      .where(eq(marketAccounts.actorId, actorId))

    await tx.update(marketPositions)
      .set({
        yesShares: side === 'SELL_YES' ? Math.max(0, position.yesShares - soldShares) : position.yesShares,
        noShares: side === 'SELL_NO' ? Math.max(0, position.noShares - soldShares) : position.noShares,
        updatedAt: new Date(),
      })
      .where(eq(marketPositions.id, position.id))

    const actionRecord = await persistMarketAction(tx, {
      runId,
      marketId: freshMarket.id,
      trialQuestionId: freshMarket.trialQuestionId,
      actorId,
      runDate,
      actionSource: resolvedActionSource,
      action: side,
      usdAmount: saleProceeds,
      sharesDelta: -soldShares,
      priceBefore: sale.priceBefore,
      priceAfter: sale.priceAfter,
      explanation,
      status: 'ok',
    })

    return {
      proceeds: saleProceeds,
      shares: soldShares,
      priceBefore: sale.priceBefore,
      priceAfter: sale.priceAfter,
      actionId: actionRecord.id,
    }
  })
}

export async function upsertDailySnapshots(runDate: Date, dbClient: MarketDbClient = db): Promise<void> {
  const normalizedRunDate = normalizeRunDate(runDate)

  const openMarkets = await dbClient.query.predictionMarkets.findMany({
    where: eq(predictionMarkets.status, 'OPEN'),
  })

  if (openMarkets.length > 0) {
    await dbClient.insert(marketPriceSnapshots)
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
    ? await dbClient.query.marketPositions.findMany({
        where: inArray(marketPositions.marketId, marketIds),
      })
    : []

  const marketPriceById = new Map(openMarkets.map((market) => [market.id, market.priceYes]))
  const positionsByActor = new Map<string, typeof allPositions>()

  for (const position of allPositions) {
    const current = positionsByActor.get(position.actorId) || []
    current.push(position)
    positionsByActor.set(position.actorId, current)
  }

  const accounts = await dbClient.query.marketAccounts.findMany()

  for (const account of accounts) {
    const positions = positionsByActor.get(account.actorId) || []

    let positionsValue = 0
    for (const position of positions) {
      const priceYes = marketPriceById.get(position.marketId)
      if (priceYes === undefined) continue

      positionsValue += (position.yesShares * priceYes) + (position.noShares * (1 - priceYes))
    }

    const totalEquity = account.cashBalance + positionsValue

    await dbClient.insert(marketDailySnapshots)
      .values({
        snapshotDate: normalizedRunDate,
        actorId: account.actorId,
        cashBalance: account.cashBalance,
        positionsValue,
        totalEquity,
      })
      .onConflictDoUpdate({
        target: [marketDailySnapshots.actorId, marketDailySnapshots.snapshotDate],
        set: {
          cashBalance: account.cashBalance,
          positionsValue,
          totalEquity,
        },
      })
  }
}

function isYesResolvingOutcome(outcome: MarketOutcome): boolean {
  return outcome === 'Approved' || outcome === 'YES'
}

async function resolveMarketByWhere(where: any, outcome: MarketOutcome, dbClient: MarketDbClient = db): Promise<void> {
  const market = await dbClient.query.predictionMarkets.findFirst({ where })

  if (!market) return

  const positions = await dbClient.query.marketPositions.findMany({
    where: eq(marketPositions.marketId, market.id),
  })

  // If already resolved to a different outcome, rebalance payouts instead of throwing.
  if (market.status === 'RESOLVED' && market.resolvedOutcome && market.resolvedOutcome !== outcome) {
    for (const position of positions) {
      const previousPayout = isYesResolvingOutcome(market.resolvedOutcome as MarketOutcome) ? position.yesShares : position.noShares
      const nextPayout = isYesResolvingOutcome(outcome) ? position.yesShares : position.noShares
      const delta = nextPayout - previousPayout
      if (delta === 0) continue

      await dbClient.update(marketAccounts)
        .set({
          cashBalance: sql`${marketAccounts.cashBalance} + ${delta}`,
          updatedAt: new Date(),
        })
        .where(eq(marketAccounts.actorId, position.actorId))
    }

    await dbClient.update(predictionMarkets)
      .set({
        resolvedOutcome: outcome,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, market.id))

    await upsertDailySnapshots(new Date(), dbClient)
    return
  }

  if (market.status === 'RESOLVED') {
    return
  }

  for (const position of positions) {
    const payout = isYesResolvingOutcome(outcome) ? position.yesShares : position.noShares
    if (payout <= 0) continue

    await dbClient.update(marketAccounts)
      .set({
        cashBalance: sql`${marketAccounts.cashBalance} + ${payout}`,
        updatedAt: new Date(),
      })
      .where(eq(marketAccounts.actorId, position.actorId))
  }

  await dbClient.update(predictionMarkets)
    .set({
      status: 'RESOLVED',
      resolvedOutcome: outcome,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(predictionMarkets.id, market.id))

  await upsertDailySnapshots(new Date(), dbClient)
}

export async function resolveMarketForTrialQuestion(
  trialQuestionId: string,
  outcome: Extract<MarketOutcome, 'YES' | 'NO'>,
  dbClient: MarketDbClient = db,
): Promise<void> {
  await resolveMarketByWhere(eq(predictionMarkets.trialQuestionId, trialQuestionId), outcome, dbClient)
}

export async function reopenMarketForTrialQuestion(
  trialQuestionId: string,
  dbClient: MarketDbClient = db,
): Promise<void> {
  const market = await dbClient.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.trialQuestionId, trialQuestionId),
  })

  if (!market || market.status !== 'RESOLVED' || !market.resolvedOutcome) {
    return
  }

  const positions = await dbClient.query.marketPositions.findMany({
    where: eq(marketPositions.marketId, market.id),
  })

  for (const position of positions) {
    const previousPayout = isYesResolvingOutcome(market.resolvedOutcome as MarketOutcome) ? position.yesShares : position.noShares
    if (previousPayout <= 0) continue

    await dbClient.update(marketAccounts)
      .set({
        cashBalance: sql`${marketAccounts.cashBalance} - ${previousPayout}`,
        updatedAt: new Date(),
      })
      .where(eq(marketAccounts.actorId, position.actorId))
  }

  await dbClient.update(predictionMarkets)
    .set({
      status: 'OPEN',
      resolvedOutcome: null,
      resolvedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(predictionMarkets.id, market.id))

  await upsertDailySnapshots(new Date(), dbClient)
}
