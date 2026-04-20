import {
  db,
  marketAccounts,
  marketActions,
  marketDailySnapshots,
  marketPositions,
  marketPriceSnapshots,
  trials,
  predictionMarkets,
  trialQuestions,
} from '@/lib/db'
import { MODEL_IDS, type ModelId } from '@/lib/constants'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  DEFAULT_BINARY_MARKET_BASELINE,
  DEFAULT_MARKET_LIQUIDITY_B,
  MARKET_STARTING_CASH,
  OPENING_PROBABILITY_CEIL,
  OPENING_PROBABILITY_FLOOR,
  type MarketActionType,
  type MarketOutcome,
} from './constants'
import { ConfigurationError, ConflictError, NotFoundError } from '@/lib/errors'
import { getMarketRuntimeConfig } from './runtime-config'
import { getModelActorIds } from '@/lib/market-actors'
import { getDaysUntilUtc } from '@/lib/date'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import { getMarketModelResponseTimeoutMs } from '@/lib/markets/run-health'
import { MODEL_DECISION_GENERATORS, getModelDecisionGeneratorDisabledReason } from '@/lib/predictions/model-decision-generators'
import type { ModelDecisionInput } from '@/lib/predictions/model-decision-prompt'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

const HOUSE_OPENING_MODEL_ID: ModelId = 'gpt-5.4'
export type HouseOpeningProbabilitySource = 'house_model' | 'fallback_default'
export type HouseOpeningProbabilityResult = {
  probability: number
  source: HouseOpeningProbabilitySource
}

type MarketState = {
  qYes: number
  qNo: number
  b: number
}

type BuyMarketAction = Extract<MarketActionType, 'BUY_YES' | 'BUY_NO'>
type SellMarketAction = Extract<MarketActionType, 'SELL_YES' | 'SELL_NO'>
type MarketActionSource = 'cycle' | 'human'
type ExecutableTradeCaps = {
  maxBuyUsd: number
  maxBuyYesUsd: number
  maxBuyNoUsd: number
  maxSellYesUsd: number
  maxSellNoUsd: number
}

export type OpeningLineSource = 'house_model' | 'admin_override'

type TrialQuestionWithTrial = typeof trialQuestions.$inferSelect & {
  trial: typeof trials.$inferSelect
}

type PersistedMarketAction = typeof marketActions.$inferSelect
type MarketDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type PersistMarketActionInput = {
  runId?: string | null
  marketId: string
  trialQuestionId: string
  actorId: string
  createdAt?: Date | null
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

async function persistMarketAction(
  client: MarketDbClient,
  input: PersistMarketActionInput,
): Promise<PersistedMarketAction> {
  const runDate = normalizeRunDate(input.runDate)
  const baseValues = {
    runId: input.actionSource === 'cycle' ? input.runId ?? null : null,
    marketId: input.marketId,
    trialQuestionId: input.trialQuestionId,
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
    createdAt: input.createdAt ?? undefined,
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

function qPlusBPriceYes({ qYes, qNo, b }: MarketState): number {
  if (![qYes, qNo, b].every(Number.isFinite) || b <= 0) {
    return 0.5
  }

  const denominator = qYes + qNo + (2 * b)
  if (denominator <= 0) {
    return 0.5
  }

  return clampProbability((qYes + b) / denominator)
}

function createInitialMarketState(openingProbability: number, b: number = DEFAULT_MARKET_LIQUIDITY_B): MarketState {
  const p = clampProbability(openingProbability)
  if (p === 0.5) {
    return {
      qYes: 0,
      qNo: 0,
      b,
    }
  }

  if (p > 0.5) {
    return {
      qYes: (b * ((2 * p) - 1)) / (1 - p),
      qNo: 0,
      b,
    }
  }

  return {
    qYes: 0,
    qNo: (b * (1 - (2 * p))) / p,
    b,
  }
}

function executeCollateralizedBudgetTrade(
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
  const priceBefore = qPlusBPriceYes(state)
  if (budget <= 0) {
    return {
      qYes: state.qYes,
      qNo: state.qNo,
      shares: 0,
      priceBefore,
      priceAfter: priceBefore,
    }
  }

  const shares = budget
  const nextQYes = side === 'BUY_YES' ? state.qYes + shares : state.qYes
  const nextQNo = side === 'BUY_NO' ? state.qNo + shares : state.qNo
  const priceAfter = qPlusBPriceYes({ qYes: nextQYes, qNo: nextQNo, b: state.b })

  return {
    qYes: nextQYes,
    qNo: nextQNo,
    shares,
    priceBefore,
    priceAfter,
  }
}

export function calculateExecutableTradeCaps(args: {
  state: MarketState
  accountCash: number
  yesSharesHeld: number
  noSharesHeld: number
}): ExecutableTradeCaps {
  const cashCapUsd = Math.max(0, args.accountCash)
  const yesSharesHeld = Math.max(0, args.yesSharesHeld)
  const noSharesHeld = Math.max(0, args.noSharesHeld)
  const maxBuyYesUsd = cashCapUsd
  const maxBuyNoUsd = cashCapUsd
  const maxSellYesUsd = Math.max(0, executeCollateralizedShareSale(args.state, 'SELL_YES', yesSharesHeld).proceeds)
  const maxSellNoUsd = Math.max(0, executeCollateralizedShareSale(args.state, 'SELL_NO', noSharesHeld).proceeds)

  return {
    maxBuyUsd: Math.max(maxBuyYesUsd, maxBuyNoUsd),
    maxBuyYesUsd,
    maxBuyNoUsd,
    maxSellYesUsd,
    maxSellNoUsd,
  }
}

export function previewTradeTransition(args: {
  state: MarketState
  accountCash: number
  yesSharesHeld: number
  noSharesHeld: number
  side: BuyMarketAction | SellMarketAction
  requestedUsd: number
}): {
  qYes: number
  qNo: number
  priceBefore: number
  priceAfter: number
  executedUsd: number
  sharesDelta: number
  cashAfter: number
  yesSharesAfter: number
  noSharesAfter: number
} {
  const accountCash = Math.max(0, args.accountCash)
  const yesSharesHeld = Math.max(0, args.yesSharesHeld)
  const noSharesHeld = Math.max(0, args.noSharesHeld)
  const requestedUsd = Math.max(0, args.requestedUsd)
  const priceBefore = qPlusBPriceYes(args.state)

  if (args.side === 'BUY_YES' || args.side === 'BUY_NO') {
    const executedUsd = Math.max(0, Math.min(requestedUsd, accountCash))
    const buy = executeCollateralizedBudgetTrade(args.state, args.side, executedUsd)

    return {
      qYes: buy.qYes,
      qNo: buy.qNo,
      priceBefore: buy.priceBefore,
      priceAfter: buy.priceAfter,
      executedUsd,
      sharesDelta: buy.shares,
      cashAfter: accountCash - executedUsd,
      yesSharesAfter: args.side === 'BUY_YES' ? yesSharesHeld + buy.shares : yesSharesHeld,
      noSharesAfter: args.side === 'BUY_NO' ? noSharesHeld + buy.shares : noSharesHeld,
    }
  }

  const heldShares = args.side === 'SELL_YES' ? yesSharesHeld : noSharesHeld
  const maxSale = executeCollateralizedShareSale(args.state, args.side, heldShares)
  const executedUsd = Math.max(0, Math.min(requestedUsd, maxSale.proceeds))
  const sale = solveConstrainedSaleForProceeds(args.state, args.side, heldShares, executedUsd)
  const soldShares = Math.min(heldShares, Math.max(0, sale.shares))
  const proceeds = Math.max(0, sale.proceeds)

  return {
    qYes: sale.qYes,
    qNo: sale.qNo,
    priceBefore: sale.priceBefore ?? priceBefore,
    priceAfter: sale.priceAfter ?? priceBefore,
    executedUsd: proceeds,
    sharesDelta: -soldShares,
    cashAfter: accountCash + proceeds,
    yesSharesAfter: args.side === 'SELL_YES' ? Math.max(0, yesSharesHeld - soldShares) : yesSharesHeld,
    noSharesAfter: args.side === 'SELL_NO' ? Math.max(0, noSharesHeld - soldShares) : noSharesHeld,
  }
}

function executeCollateralizedShareSale(
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
  const priceBefore = qPlusBPriceYes(state)

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
  const sidePrice = side === 'SELL_YES' ? priceBefore : 1 - priceBefore
  const proceeds = Math.max(0, shares * sidePrice)
  const priceAfter = qPlusBPriceYes(nextState)

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
  const zeroSale = executeCollateralizedShareSale(state, side, 0)

  if (maxShares <= 0 || targetProceeds <= 0) {
    return zeroSale
  }

  const maxSale = executeCollateralizedShareSale(state, side, maxShares)
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
    const midSale = executeCollateralizedShareSale(state, side, midShares)
    if (midSale.proceeds <= targetProceeds) {
      lowShares = midShares
      lowSale = midSale
    } else {
      highShares = midShares
    }
  }

  return lowSale
}

export function buildHouseOpeningDecisionInput(args: {
  trialQuestionId: string
  trial: typeof trials.$inferSelect
  questionPrompt: string
  asOf?: Date
}): ModelDecisionInput {
  const asOf = args.asOf ?? new Date()
  const normalizedPrompt = normalizeTrialQuestionPrompt(args.questionPrompt)

  return {
    meta: {
      eventId: args.trial.id,
      trialQuestionId: args.trialQuestionId,
      marketId: `bootstrap:${args.trialQuestionId}`,
      modelId: HOUSE_OPENING_MODEL_ID,
      asOf: asOf.toISOString(),
      runDateIso: normalizeRunDate(asOf).toISOString(),
    },
    trial: {
      shortTitle: args.trial.shortTitle,
      sponsorName: args.trial.sponsorName,
      sponsorTicker: args.trial.sponsorTicker ?? null,
      exactPhase: args.trial.exactPhase,
      estPrimaryCompletionDate: args.trial.estPrimaryCompletionDate.toISOString(),
      daysToPrimaryCompletion: getDaysUntilUtc(args.trial.estPrimaryCompletionDate, asOf),
      indication: args.trial.indication,
      intervention: args.trial.intervention,
      primaryEndpoint: args.trial.primaryEndpoint,
      currentStatus: args.trial.currentStatus,
      briefSummary: args.trial.briefSummary,
      nctNumber: args.trial.nctNumber,
      questionPrompt: normalizedPrompt,
    },
    market: {
      yesPrice: DEFAULT_BINARY_MARKET_BASELINE,
      noPrice: 1 - DEFAULT_BINARY_MARKET_BASELINE,
    },
    portfolio: {
      cashAvailable: 0,
      yesSharesHeld: 0,
      noSharesHeld: 0,
      maxBuyUsd: 0,
      maxSellYesUsd: 0,
      maxSellNoUsd: 0,
    },
    constraints: {
      allowedActions: ['HOLD'],
      explanationMaxChars: 220,
    },
  }
}

async function calculateHouseOpeningProbabilityWithSource(
  input: ModelDecisionInput,
): Promise<HouseOpeningProbabilityResult> {
  const generator = MODEL_DECISION_GENERATORS[HOUSE_OPENING_MODEL_ID]
  if (!generator?.enabled()) {
    console.warn(`[markets] Falling back to default opening line: ${getModelDecisionGeneratorDisabledReason(HOUSE_OPENING_MODEL_ID)}`)
    return {
      probability: clampProbability(DEFAULT_BINARY_MARKET_BASELINE),
      source: 'fallback_default',
    }
  }

  try {
    const generation = await generator.generator(input, {
      signal: AbortSignal.timeout(getMarketModelResponseTimeoutMs(HOUSE_OPENING_MODEL_ID)),
    })
    const probability = generation.result.forecast.yesProbability ?? generation.result.forecast.approvalProbability
    if (!Number.isFinite(probability)) {
      console.warn(`[markets] Falling back to default opening line for ${input.meta.trialQuestionId ?? input.meta.eventId}: model returned no usable probability`)
      return {
        probability: clampProbability(DEFAULT_BINARY_MARKET_BASELINE),
        source: 'fallback_default',
      }
    }
    return {
      probability: clampProbability(probability),
      source: 'house_model',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown opening-line bootstrap error'
    console.warn(`[markets] Falling back to default opening line for ${input.meta.trialQuestionId ?? input.meta.eventId}: ${message}`)
    return {
      probability: clampProbability(DEFAULT_BINARY_MARKET_BASELINE),
      source: 'fallback_default',
    }
  }
}

export async function calculateHouseOpeningProbability(input: ModelDecisionInput): Promise<number> {
  return (await calculateHouseOpeningProbabilityWithSource(input)).probability
}

async function calculateHistoricalTrialSuccessRate(question: TrialQuestionWithTrial): Promise<number> {
  return calculateHouseOpeningProbability(buildHouseOpeningDecisionInput({
    trialQuestionId: question.id,
    trial: question.trial,
    questionPrompt: question.prompt,
  }))
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
  input: string | {
    trialQuestionId: string
    houseOpeningProbability?: number | null
    openingProbabilityOverride?: number | null
    openedByUserId?: string | null
  },
  dbClient: MarketDbClient = db,
) {
  const trialQuestionId = typeof input === 'string' ? input : input.trialQuestionId
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

  if (!question.trial) {
    throw new ConfigurationError(`Missing trial for question ${trialQuestionId}`)
  }

  if (question.status !== 'live' || !question.isBettable) {
    throw new ConflictError('Cannot open a market for a non-live question')
  }

  if (question.outcome !== 'Pending') {
    throw new ConflictError('Cannot open a market for a question that already has a final outcome')
  }

  const existing = await dbClient.query.predictionMarkets.findFirst({
    columns: predictionMarketColumns,
    where: eq(predictionMarkets.trialQuestionId, trialQuestionId),
  })

  if (existing) {
    if (existing.status === 'OPEN') {
      await ensureMarketPositions(existing.id, dbClient)
      return existing
    }
    throw new ConflictError('Market already exists and is resolved')
  }

  const [suggestedHouseOpeningProbability, runtimeConfig] = await Promise.all([
    typeof input === 'string'
      ? calculateHistoricalTrialSuccessRate(question)
      : Promise.resolve(input.houseOpeningProbability ?? null).then((value) => (
        typeof value === 'number' && Number.isFinite(value)
          ? clampProbability(value)
          : calculateHistoricalTrialSuccessRate(question)
      )),
    getMarketRuntimeConfig(dbClient),
  ])

  const openingProbability = typeof input === 'string'
    ? suggestedHouseOpeningProbability
    : clampProbability(input.openingProbabilityOverride ?? suggestedHouseOpeningProbability)
  const openingLineSource: OpeningLineSource = Math.abs(openingProbability - suggestedHouseOpeningProbability) <= 0.000001
    ? 'house_model'
    : 'admin_override'
  const openedByUserId = typeof input === 'string'
    ? null
    : (input.openedByUserId ?? null)

  const initialLiquidityB = Math.max(1, runtimeConfig.season4MarketLiquidityBDisplay)
  const initialState = createInitialMarketState(openingProbability, initialLiquidityB)

  const [market] = await dbClient.insert(predictionMarkets)
    .values({
      trialQuestionId,
      status: 'OPEN',
      openingProbability,
      houseOpeningProbability: suggestedHouseOpeningProbability,
      openingLineSource,
      openedByUserId,
      b: initialLiquidityB,
      qYes: initialState.qYes,
      qNo: initialState.qNo,
      priceYes: qPlusBPriceYes(initialState),
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
    columns: predictionMarketColumns,
    where: eq(predictionMarkets.status, 'OPEN'),
  })
}

export async function runHoldAction({
  runId,
  marketId,
  trialQuestionId,
  actorId,
  createdAt,
  runDate,
  explanation,
  priceYes,
  actionSource,
}: {
  runId?: string
  marketId: string
  trialQuestionId: string
  actorId: string
  createdAt?: Date
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
    createdAt,
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
  createdAt,
  runDate,
  priceYes,
  message,
  code,
  details,
  actionSource,
}: {
  runId?: string
  marketId: string
  trialQuestionId: string
  actorId: string
  createdAt?: Date
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
    createdAt,
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
  createdAt,
  runDate,
  side,
  requestedUsd,
  explanation,
  actionSource,
}: {
  runId?: string
  market: typeof predictionMarkets.$inferSelect
  actorId: string
  createdAt?: Date
  runDate: Date
  side: Extract<MarketActionType, 'BUY_YES' | 'BUY_NO'>
  requestedUsd: number
  explanation: string
  actionSource?: MarketActionSource
}): Promise<{
  spent: number
  shares: number
  priceBefore: number
  priceAfter: number
  actionId: string | null
}> {
  const resolvedActionSource = resolveActionSource(runId, actionSource)
  const result = await db.transaction(async (tx) => {
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
      columns: predictionMarketColumns,
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
    const spent = Math.max(0, Math.min(requestedSpend, account.cashBalance))

    if (spent <= 0) {
      const actionRecord = resolvedActionSource === 'cycle'
        ? await persistMarketAction(tx, {
            runId,
            marketId: freshMarket.id,
            trialQuestionId: freshMarket.trialQuestionId,
            actorId,
            createdAt,
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
        spent: 0,
        shares: 0,
        priceBefore: freshMarket.priceYes,
        priceAfter: freshMarket.priceYes,
        actionId: actionRecord?.id ?? null,
      }
    }

    const trade = executeCollateralizedBudgetTrade(
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
      createdAt,
      runDate,
      actionSource: resolvedActionSource,
      action: side,
      usdAmount: spent,
      sharesDelta: trade.shares,
      priceBefore: trade.priceBefore,
      priceAfter: trade.priceAfter,
      explanation,
      status: 'ok',
    })

    await upsertDailySnapshots(createdAt ?? runDate, tx)

    return {
      spent,
      shares: trade.shares,
      priceBefore: trade.priceBefore,
      priceAfter: trade.priceAfter,
      actionId: actionRecord.id,
    }
  })
  return result
}

export async function runSellAction({
  runId,
  market,
  actorId,
  createdAt,
  runDate,
  side,
  requestedUsd,
  explanation,
  actionSource,
}: {
  runId?: string
  market: typeof predictionMarkets.$inferSelect
  actorId: string
  createdAt?: Date
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
  const result = await db.transaction(async (tx) => {
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
      columns: predictionMarketColumns,
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
            createdAt,
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

    const maxSale = executeCollateralizedShareSale(state, side, heldShares)
    const proceeds = Math.max(0, Math.min(requestedProceeds, maxSale.proceeds))

    if (proceeds <= 0) {
      const actionRecord = resolvedActionSource === 'cycle'
        ? await persistMarketAction(tx, {
            runId,
            marketId: freshMarket.id,
            trialQuestionId: freshMarket.trialQuestionId,
            actorId,
            createdAt,
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
            createdAt,
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
      createdAt,
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

    await upsertDailySnapshots(createdAt ?? runDate, tx)

    return {
      proceeds: saleProceeds,
      shares: soldShares,
      priceBefore: sale.priceBefore,
      priceAfter: sale.priceAfter,
      actionId: actionRecord.id,
    }
  })
  return result
}

export async function upsertDailySnapshots(runDate: Date, dbClient: MarketDbClient = db): Promise<void> {
  const normalizedRunDate = normalizeRunDate(runDate)

  const openMarkets = await dbClient.query.predictionMarkets.findMany({
    columns: predictionMarketColumns,
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
  return outcome === 'YES'
}

async function resolveMarketByWhere(where: any, outcome: MarketOutcome, dbClient: MarketDbClient = db): Promise<void> {
  const market = await dbClient.query.predictionMarkets.findFirst({
    columns: predictionMarketColumns,
    where,
  })

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
    columns: predictionMarketColumns,
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
