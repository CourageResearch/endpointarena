import { getDaysUntilUtc } from '@/lib/date'
import type { ModelId } from '@/lib/constants'
import { ExternalServiceError } from '@/lib/errors'
import { MARKET_ACTIONS, type MarketActionType } from '@/lib/markets/constants'
import { getMarketModelResponseTimeoutMs } from '@/lib/markets/run-health'
import {
  MODEL_DECISION_GENERATORS,
  getModelDecisionGeneratorDisabledReason,
  type ModelDecisionGeneration,
} from '@/lib/predictions/model-decision-generators'
import type { ModelDecisionInput, ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

const COLLATERAL_DECIMALS = 6
const DISPLAY_DECIMALS = 1_000_000

export type Season4DecisionTrialFacts = {
  trialQuestionId: string
  questionPrompt: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  exactPhase: string
  estPrimaryCompletionDate: Date
  indication: string
  intervention: string
  primaryEndpoint: string
  currentStatus: string
  briefSummary: string
  nctNumber: string | null
}

export type Season4TrialFactsBuildResult =
  | {
      ok: true
      trial: Season4DecisionTrialFacts
    }
  | {
      ok: false
      missingFields: string[]
    }

export type Season4ModelDecisionContext = {
  marketId: string
  marketSlug: string
  onchainMarketId: string
  title: string
  metadataUri: string | null
  closeTime: Date | null
  qYesDisplay: number
  qNoDisplay: number
  liquidityBDisplay: number
  priceYes: number
  portfolio: {
    collateralBalanceDisplay: number
    yesSharesHeld: number
    noSharesHeld: number
  }
  maxTradeUsd: number
  asOf: Date
  trial: Season4DecisionTrialFacts
}

export type Season4TradeCaps = {
  maxBuyUsd: number
  maxBuyYesUsd: number
  maxBuyNoUsd: number
  maxSellYesUsd: number
  maxSellNoUsd: number
  allowedActions: MarketActionType[]
}

export type Season4CappedTradeDecision = {
  requestedActionType: MarketActionType
  actionType: MarketActionType
  requestedAmountUsd: number
  executedAmountUsd: number
  explanation: string
  reasoning: string
  confidencePercent: number
  binaryCall: 'yes' | 'no'
}

export type Season4TradeExecution = {
  contractFunctionName: 'buyYes' | 'buyNo' | 'sellYes' | 'sellNo'
  amountAtomic: bigint
  shareAmountDisplay: number
}

export function season4AtomicToDisplay(value: bigint): number {
  return Number(value) / DISPLAY_DECIMALS
}

function clampMoney(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * DISPLAY_DECIMALS) / DISPLAY_DECIMALS
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

export function calculateSeason4PriceYes(args: {
  qYesDisplay: number
  qNoDisplay: number
  liquidityBDisplay: number
}): number {
  const qYes = Math.max(0, args.qYesDisplay)
  const qNo = Math.max(0, args.qNoDisplay)
  const liquidityB = Math.max(0, args.liquidityBDisplay)
  const denominator = qYes + qNo + (2 * liquidityB)
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0.5
  }

  return clampProbability((qYes + liquidityB) / denominator)
}

export function buildSeason4TrialFacts(args: {
  marketSlug: string
  marketTitle: string
  metadataUri: string | null
  closeTime: Date | null
  linkedTrialQuestionId?: string | null
  linkedQuestionPrompt?: string | null
  linkedTrialShortTitle?: string | null
  linkedSponsorName?: string | null
  linkedSponsorTicker?: string | null
  linkedExactPhase?: string | null
  linkedEstPrimaryCompletionDate?: Date | null
  linkedIndication?: string | null
  linkedIntervention?: string | null
  linkedPrimaryEndpoint?: string | null
  linkedCurrentStatus?: string | null
  linkedBriefSummary?: string | null
  linkedNctNumber?: string | null
}): Season4TrialFactsBuildResult {
  const missingFields: string[] = []
  const trialQuestionId = normalizeRequiredTrialField(args.linkedTrialQuestionId, 'trialQuestionId', missingFields)
  const rawQuestionPrompt = normalizeRequiredTrialField(args.linkedQuestionPrompt, 'questionPrompt', missingFields)
  const shortTitle = normalizeRequiredTrialField(args.linkedTrialShortTitle, 'shortTitle', missingFields)
  const sponsorName = normalizeRequiredTrialField(args.linkedSponsorName, 'sponsorName', missingFields)
  const exactPhase = normalizeRequiredTrialField(args.linkedExactPhase, 'exactPhase', missingFields)
  const indication = normalizeRequiredTrialField(args.linkedIndication, 'indication', missingFields)
  const intervention = normalizeRequiredTrialField(args.linkedIntervention, 'intervention', missingFields)
  const primaryEndpoint = normalizeRequiredTrialField(args.linkedPrimaryEndpoint, 'primaryEndpoint', missingFields)
  const currentStatus = normalizeRequiredTrialField(args.linkedCurrentStatus, 'currentStatus', missingFields)
  const briefSummary = normalizeRequiredTrialField(args.linkedBriefSummary, 'briefSummary', missingFields)
  const estPrimaryCompletionDate = normalizeRequiredTrialDate(
    args.linkedEstPrimaryCompletionDate,
    'estPrimaryCompletionDate',
    missingFields,
  )

  if (missingFields.length > 0) {
    return {
      ok: false,
      missingFields,
    }
  }

  return {
    ok: true,
    trial: {
      trialQuestionId,
      questionPrompt: normalizeTrialQuestionPrompt(rawQuestionPrompt),
      shortTitle,
      sponsorName,
      sponsorTicker: normalizeOptionalTrialField(args.linkedSponsorTicker),
      exactPhase,
      estPrimaryCompletionDate,
      indication,
      intervention,
      primaryEndpoint,
      currentStatus,
      briefSummary,
      nctNumber: normalizeOptionalTrialField(args.linkedNctNumber),
    },
  }
}

function normalizeRequiredTrialField(
  value: string | null | undefined,
  fieldName: string,
  missingFields: string[],
): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    missingFields.push(fieldName)
  }

  return normalized
}

function normalizeOptionalTrialField(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

function normalizeRequiredTrialDate(
  value: Date | null | undefined,
  fieldName: string,
  missingFields: string[],
): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    missingFields.push(fieldName)
    return new Date(0)
  }

  return value
}

export function calculateSeason4TradeCaps(args: {
  cashAvailable: number
  yesSharesHeld: number
  noSharesHeld: number
  priceYes: number
  maxTradeUsd: number
}): Season4TradeCaps {
  const cashAvailable = Math.max(0, args.cashAvailable)
  const yesSharesHeld = Math.max(0, args.yesSharesHeld)
  const noSharesHeld = Math.max(0, args.noSharesHeld)
  const priceYes = clampProbability(args.priceYes)
  const priceNo = clampProbability(1 - priceYes)
  const maxTradeUsd = Math.max(0, args.maxTradeUsd)

  const maxBuyYesUsd = clampMoney(Math.min(cashAvailable, maxTradeUsd))
  const maxBuyNoUsd = clampMoney(Math.min(cashAvailable, maxTradeUsd))
  const maxSellYesUsd = clampMoney(Math.min(yesSharesHeld * priceYes, maxTradeUsd))
  const maxSellNoUsd = clampMoney(Math.min(noSharesHeld * priceNo, maxTradeUsd))

  const allowedActions: MarketActionType[] = ['HOLD']
  if (maxBuyYesUsd > 0 && priceYes > 0) allowedActions.unshift('BUY_YES')
  if (maxBuyNoUsd > 0 && priceNo > 0) allowedActions.unshift('BUY_NO')
  if (maxSellYesUsd > 0 && priceYes > 0) allowedActions.unshift('SELL_YES')
  if (maxSellNoUsd > 0 && priceNo > 0) allowedActions.unshift('SELL_NO')

  return {
    maxBuyUsd: Math.max(maxBuyYesUsd, maxBuyNoUsd),
    maxBuyYesUsd,
    maxBuyNoUsd,
    maxSellYesUsd,
    maxSellNoUsd,
    allowedActions: Array.from(new Set(allowedActions.filter((action) => MARKET_ACTIONS.includes(action)))),
  }
}

export function buildSeason4ModelDecisionInput(context: Season4ModelDecisionContext): {
  input: ModelDecisionInput
  tradeCaps: Season4TradeCaps
} {
  const tradeCaps = calculateSeason4TradeCaps({
    cashAvailable: context.portfolio.collateralBalanceDisplay,
    yesSharesHeld: context.portfolio.yesSharesHeld,
    noSharesHeld: context.portfolio.noSharesHeld,
    priceYes: context.priceYes,
    maxTradeUsd: context.maxTradeUsd,
  })

  const input: ModelDecisionInput = {
    meta: {
      eventId: context.trial.nctNumber ?? context.marketSlug,
      trialQuestionId: context.trial.trialQuestionId,
      marketId: context.marketId,
      modelId: '',
      asOf: context.asOf.toISOString(),
      runDateIso: context.asOf.toISOString(),
    },
    trial: {
      shortTitle: context.trial.shortTitle,
      sponsorName: context.trial.sponsorName,
      sponsorTicker: context.trial.sponsorTicker,
      exactPhase: context.trial.exactPhase,
      estPrimaryCompletionDate: context.trial.estPrimaryCompletionDate.toISOString(),
      daysToPrimaryCompletion: getDaysUntilUtc(context.trial.estPrimaryCompletionDate, context.asOf),
      indication: context.trial.indication,
      intervention: context.trial.intervention,
      primaryEndpoint: context.trial.primaryEndpoint,
      currentStatus: context.trial.currentStatus,
      briefSummary: context.trial.briefSummary,
      nctNumber: context.trial.nctNumber,
      questionPrompt: context.trial.questionPrompt,
    },
    market: {
      yesPrice: context.priceYes,
      noPrice: clampProbability(1 - context.priceYes),
    },
    portfolio: {
      cashAvailable: clampMoney(context.portfolio.collateralBalanceDisplay),
      yesSharesHeld: clampMoney(context.portfolio.yesSharesHeld),
      noSharesHeld: clampMoney(context.portfolio.noSharesHeld),
      maxBuyUsd: tradeCaps.maxBuyUsd,
      maxSellYesUsd: tradeCaps.maxSellYesUsd,
      maxSellNoUsd: tradeCaps.maxSellNoUsd,
    },
    constraints: {
      allowedActions: tradeCaps.allowedActions,
      explanationMaxChars: 220,
    },
  }

  return {
    input,
    tradeCaps,
  }
}

export async function generateSeason4ModelDecision(args: {
  modelId: ModelId
  context: Season4ModelDecisionContext
}): Promise<{
  input: ModelDecisionInput
  tradeCaps: Season4TradeCaps
  generation: ModelDecisionGeneration
}> {
  const generator = MODEL_DECISION_GENERATORS[args.modelId]
  if (!generator?.enabled()) {
    throw new ExternalServiceError(getModelDecisionGeneratorDisabledReason(args.modelId))
  }

  const { input, tradeCaps } = buildSeason4ModelDecisionInput(args.context)
  input.meta.modelId = args.modelId
  const signal = AbortSignal.timeout(getMarketModelResponseTimeoutMs(args.modelId))

  try {
    const generation = await generator.generator(input, { signal })

    return {
      input,
      tradeCaps,
      generation,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ExternalServiceError(`Season 4 model decision failed for ${args.modelId}: ${message}`, {
      cause: error,
      expose: true,
    })
  }
}

export function capSeason4TradeDecision(args: {
  decision: ModelDecisionResult
  tradeCaps: Season4TradeCaps
}): Season4CappedTradeDecision {
  const requestedActionType = args.decision.action.type
  const requestedAmountUsd = clampMoney(args.decision.action.amountUsd)

  const limit = requestedActionType === 'BUY_YES'
    ? args.tradeCaps.maxBuyYesUsd
    : requestedActionType === 'BUY_NO'
      ? args.tradeCaps.maxBuyNoUsd
      : requestedActionType === 'SELL_YES'
        ? args.tradeCaps.maxSellYesUsd
        : requestedActionType === 'SELL_NO'
          ? args.tradeCaps.maxSellNoUsd
          : 0

  const executable = requestedActionType === 'HOLD'
    ? 0
    : clampMoney(Math.min(requestedAmountUsd, limit))
  const actionType = requestedActionType === 'HOLD' || executable <= 0
    ? 'HOLD'
    : requestedActionType

  return {
    requestedActionType,
    actionType,
    requestedAmountUsd,
    executedAmountUsd: actionType === 'HOLD' ? 0 : executable,
    explanation: args.decision.action.explanation,
    reasoning: args.decision.forecast.reasoning,
    confidencePercent: args.decision.forecast.confidence,
    binaryCall: args.decision.forecast.binaryCall,
  }
}

export function buildSeason4TradeExecution(args: {
  actionType: MarketActionType
  executedAmountUsd: number
  priceYes: number
}): Season4TradeExecution | null {
  const executedAmountUsd = clampMoney(args.executedAmountUsd)
  const priceYes = clampProbability(args.priceYes)
  const priceNo = clampProbability(1 - priceYes)

  if (args.actionType === 'HOLD' || executedAmountUsd <= 0) {
    return null
  }

  if (args.actionType === 'BUY_YES') {
    return {
      contractFunctionName: 'buyYes',
      amountAtomic: parseDisplayToAtomic(executedAmountUsd),
      shareAmountDisplay: clampMoney(executedAmountUsd / Math.max(priceYes, Number.EPSILON)),
    }
  }

  if (args.actionType === 'BUY_NO') {
    return {
      contractFunctionName: 'buyNo',
      amountAtomic: parseDisplayToAtomic(executedAmountUsd),
      shareAmountDisplay: clampMoney(executedAmountUsd / Math.max(priceNo, Number.EPSILON)),
    }
  }

  if (args.actionType === 'SELL_YES') {
    const shareAmountDisplay = clampMoney(executedAmountUsd / Math.max(priceYes, Number.EPSILON))
    return {
      contractFunctionName: 'sellYes',
      amountAtomic: parseDisplayToAtomic(shareAmountDisplay),
      shareAmountDisplay,
    }
  }

  const shareAmountDisplay = clampMoney(executedAmountUsd / Math.max(priceNo, Number.EPSILON))
  return {
    contractFunctionName: 'sellNo',
    amountAtomic: parseDisplayToAtomic(shareAmountDisplay),
    shareAmountDisplay,
  }
}

export function applySeason4TradeToState(args: {
  qYesDisplay: number
  qNoDisplay: number
  liquidityBDisplay: number
  collateralBalanceDisplay: number
  yesSharesHeld: number
  noSharesHeld: number
  actionType: MarketActionType
  executedAmountUsd: number
  shareAmountDisplay: number
}): {
  qYesDisplay: number
  qNoDisplay: number
  priceYes: number
  collateralBalanceDisplay: number
  yesSharesHeld: number
  noSharesHeld: number
} {
  let qYesDisplay = Math.max(0, args.qYesDisplay)
  let qNoDisplay = Math.max(0, args.qNoDisplay)
  let collateralBalanceDisplay = Math.max(0, args.collateralBalanceDisplay)
  let yesSharesHeld = Math.max(0, args.yesSharesHeld)
  let noSharesHeld = Math.max(0, args.noSharesHeld)
  const executedAmountUsd = clampMoney(args.executedAmountUsd)
  const shareAmountDisplay = clampMoney(args.shareAmountDisplay)

  switch (args.actionType) {
    case 'BUY_YES':
      qYesDisplay += shareAmountDisplay
      yesSharesHeld += shareAmountDisplay
      collateralBalanceDisplay = Math.max(0, collateralBalanceDisplay - executedAmountUsd)
      break
    case 'BUY_NO':
      qNoDisplay += shareAmountDisplay
      noSharesHeld += shareAmountDisplay
      collateralBalanceDisplay = Math.max(0, collateralBalanceDisplay - executedAmountUsd)
      break
    case 'SELL_YES':
      qYesDisplay = Math.max(0, qYesDisplay - shareAmountDisplay)
      yesSharesHeld = Math.max(0, yesSharesHeld - shareAmountDisplay)
      collateralBalanceDisplay += executedAmountUsd
      break
    case 'SELL_NO':
      qNoDisplay = Math.max(0, qNoDisplay - shareAmountDisplay)
      noSharesHeld = Math.max(0, noSharesHeld - shareAmountDisplay)
      collateralBalanceDisplay += executedAmountUsd
      break
    case 'HOLD':
      break
  }

  return {
    qYesDisplay: clampMoney(qYesDisplay),
    qNoDisplay: clampMoney(qNoDisplay),
    priceYes: calculateSeason4PriceYes({
      qYesDisplay,
      qNoDisplay,
      liquidityBDisplay: args.liquidityBDisplay,
    }),
    collateralBalanceDisplay: clampMoney(collateralBalanceDisplay),
    yesSharesHeld: clampMoney(yesSharesHeld),
    noSharesHeld: clampMoney(noSharesHeld),
  }
}

function parseDisplayToAtomic(value: number): bigint {
  const normalized = clampMoney(value)
  return BigInt(Math.round(normalized * DISPLAY_DECIMALS))
}
