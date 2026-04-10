import { MODEL_IDS, type ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { buildModelDecisionPrompt, type ModelDecisionInput } from '@/lib/predictions/model-decision-prompt'

interface ModelPricing {
  inputUsdPer1MTokens: number
  outputUsdPer1MTokens: number
  searchUsdPerRequest?: number
  assumedSearchContentInputTokens?: number
  outputReasoningMultiplier?: number
}

export interface AdminAiRowEstimate {
  inputTokens: number
  outputTokens: number
  searchRequests: number
  estimatedCostUsd: number
}

export type AdminAiRowEstimateMap = Partial<Record<ModelId, AdminAiRowEstimate>>

interface AdminAiEstimateInput {
  marketId: string
  trialId: string
  trialQuestionId: string
  questionPrompt: string
  marketPriceYes: number | null
  trial: {
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
}

const TOKENS_PER_MILLION = 1_000_000
const APPROX_CHARS_PER_TOKEN = 4
const BASE_INPUT_OVERHEAD_TOKENS = 110
const BASE_OUTPUT_OVERHEAD_TOKENS = 45
const DEFAULT_SEARCH_REQUESTS = 1

// Current public API list prices as of April 2, 2026.
// We intentionally keep this admin estimator separate from historical snapshot costing.
const CURRENT_MODEL_PRICING: Record<ModelId, ModelPricing> = {
  'claude-opus': {
    inputUsdPer1MTokens: 5,
    outputUsdPer1MTokens: 25,
    searchUsdPerRequest: 0.01,
    assumedSearchContentInputTokens: 1200,
    outputReasoningMultiplier: 1.2,
  },
  'gpt-5.4': {
    inputUsdPer1MTokens: 2.5,
    outputUsdPer1MTokens: 15,
    searchUsdPerRequest: 0.01,
    assumedSearchContentInputTokens: 1200,
    outputReasoningMultiplier: 2.4,
  },
  'grok-4.1': {
    inputUsdPer1MTokens: 0.2,
    outputUsdPer1MTokens: 0.5,
    searchUsdPerRequest: 0.005,
    assumedSearchContentInputTokens: 900,
    outputReasoningMultiplier: 1.4,
  },
  // Our legacy `gemini-3-pro` slot currently uses the Gemini 3.1 Pro Preview price tier.
  'gemini-3-pro': {
    inputUsdPer1MTokens: 2,
    outputUsdPer1MTokens: 12,
    searchUsdPerRequest: 0.014,
    assumedSearchContentInputTokens: 1000,
    outputReasoningMultiplier: 2.2,
  },
  'deepseek-v3.2': {
    inputUsdPer1MTokens: 0.56,
    outputUsdPer1MTokens: 1.68,
    outputReasoningMultiplier: 1,
  },
  'glm-5': {
    inputUsdPer1MTokens: 1,
    outputUsdPer1MTokens: 3.2,
    outputReasoningMultiplier: 1,
  },
  'llama-4-scout': {
    inputUsdPer1MTokens: 0.15,
    outputUsdPer1MTokens: 0.6,
    outputReasoningMultiplier: 1,
  },
  'kimi-k2.5': {
    inputUsdPer1MTokens: 0.6,
    outputUsdPer1MTokens: 3,
    outputReasoningMultiplier: 1,
  },
  'minimax-m2.5': {
    inputUsdPer1MTokens: 0.3,
    outputUsdPer1MTokens: 1.2,
    outputReasoningMultiplier: 1.1,
  },
}

const SAMPLE_REASONING = [
  'The setup points to a mixed but still actionable readout profile.',
  'The endpoint is clinically relevant and the program appears operationally credible,',
  'but the evidence package is not clean enough to justify very high conviction.',
  'Prior data may support biological activity, yet translation into a definitive primary',
  'endpoint outcome can still fail because of patient heterogeneity, effect-size decay,',
  'dropout, protocol noise, or timing issues around follow-up.',
  'I would also weigh whether the endpoint is objective, whether the enrolled population',
  'matches earlier responders, and whether management has guided conservatively around the',
  'readout window.',
  'Those factors leave a real path to success, but there is still enough design, execution,',
  'and disclosure risk that the intrinsic odds should stay meaningfully below a best-case view.',
].join(' ')

const SAMPLE_RESPONSE_TEXT = JSON.stringify({
  forecast: {
    yesProbability: 0.47,
    binaryCall: 'no',
    confidence: 68,
    reasoning: SAMPLE_REASONING,
  },
  action: {
    type: 'HOLD',
    amountUsd: 0,
    explanation: 'Market price is close enough to intrinsic odds that waiting preserves optionality.',
  },
}, null, 2)

function estimateTokenCount(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0
  return Math.max(1, Math.round(normalized.length / APPROX_CHARS_PER_TOKEN))
}

function buildPromptInput(args: AdminAiEstimateInput, modelId: ModelId): ModelDecisionInput {
  const yesPrice = typeof args.marketPriceYes === 'number' && Number.isFinite(args.marketPriceYes)
    ? Math.max(0, Math.min(1, args.marketPriceYes))
    : 0.5

  return {
    meta: {
      eventId: args.trialId,
      trialQuestionId: args.trialQuestionId,
      marketId: args.marketId,
      modelId,
      asOf: args.trial.estPrimaryCompletionDate.toISOString(),
      runDateIso: new Date().toISOString(),
    },
    trial: {
      shortTitle: args.trial.shortTitle,
      sponsorName: args.trial.sponsorName,
      sponsorTicker: args.trial.sponsorTicker,
      exactPhase: args.trial.exactPhase,
      estPrimaryCompletionDate: args.trial.estPrimaryCompletionDate.toISOString(),
      daysToPrimaryCompletion: getDaysUntilUtc(args.trial.estPrimaryCompletionDate),
      indication: args.trial.indication,
      intervention: args.trial.intervention,
      primaryEndpoint: args.trial.primaryEndpoint,
      currentStatus: args.trial.currentStatus,
      briefSummary: args.trial.briefSummary,
      nctNumber: args.trial.nctNumber,
      questionPrompt: args.questionPrompt,
    },
    market: {
      yesPrice,
      noPrice: Math.max(0, Math.min(1, 1 - yesPrice)),
    },
    portfolio: {
      cashAvailable: 1000,
      yesSharesHeld: 0,
      noSharesHeld: 0,
      maxBuyUsd: 50,
      maxSellYesUsd: 25,
      maxSellNoUsd: 25,
    },
    constraints: {
      allowedActions: ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
      explanationMaxChars: 220,
    },
  }
}

function estimateAdminAiRowCost(
  modelId: ModelId,
  args: AdminAiEstimateInput,
): AdminAiRowEstimate {
  const pricing = CURRENT_MODEL_PRICING[modelId]
  const promptText = buildModelDecisionPrompt(buildPromptInput(args, modelId))
  const baseInputTokens = estimateTokenCount(promptText) + BASE_INPUT_OVERHEAD_TOKENS
  const searchRequests = pricing.searchUsdPerRequest ? DEFAULT_SEARCH_REQUESTS : 0
  const searchContentTokens = searchRequests * (pricing.assumedSearchContentInputTokens ?? 0)
  const inputTokens = baseInputTokens + searchContentTokens

  const visibleOutputTokens = estimateTokenCount(SAMPLE_RESPONSE_TEXT) + BASE_OUTPUT_OVERHEAD_TOKENS
  const outputTokens = Math.max(
    visibleOutputTokens,
    Math.round(visibleOutputTokens * (pricing.outputReasoningMultiplier ?? 1)),
  )

  const estimatedCostUsd =
    ((inputTokens / TOKENS_PER_MILLION) * pricing.inputUsdPer1MTokens) +
    ((outputTokens / TOKENS_PER_MILLION) * pricing.outputUsdPer1MTokens) +
    (searchRequests * (pricing.searchUsdPerRequest ?? 0))

  return {
    inputTokens,
    outputTokens,
    searchRequests,
    estimatedCostUsd,
  }
}

export function estimateAdminAiRowCosts(args: AdminAiEstimateInput): AdminAiRowEstimateMap {
  return MODEL_IDS.reduce<AdminAiRowEstimateMap>((acc, modelId) => {
    acc[modelId] = estimateAdminAiRowCost(modelId, args)
    return acc
  }, {})
}
