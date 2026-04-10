import type { ModelId } from '@/lib/constants'

interface ModelPricingEstimate {
  inputUsdPer1MTokens: number
  outputUsdPer1MTokens: number
  longContextInputTokenThreshold?: number
  longContextInputUsdPer1MTokens?: number
  longContextOutputUsdPer1MTokens?: number
  cachedInputUsdPer1MTokens?: number
  webSearchUsdPerRequest?: number
}

export const AI_COST_SOURCES = ['provider', 'estimated', 'subscription'] as const
export type AICostSource = (typeof AI_COST_SOURCES)[number]
type AICostEstimationProfile =
  | 'default'
  | 'claude-deep-research'
  | 'gpt-deep-research'
  | 'grok-deep-research'
  | 'gemini3-deep-research'
  | 'deepseek-reasoning'
  | 'glm-reasoning'
  | 'llama4-reasoning'
  | 'kimi-thinking'
  | 'minimax-reasoning'

const TOKENS_PER_MILLION = 1_000_000
const CLAUDE_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 200_000
const GROK_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 128_000
const GEMINI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 200_000
const CLAUDE_CACHE_WRITE_5M_MULTIPLIER = 1.25
const CLAUDE_CACHE_WRITE_1H_MULTIPLIER = 2
const CLAUDE_CACHE_READ_MULTIPLIER = 0.1
const CLAUDE_US_INFERENCE_TOKEN_MULTIPLIER = 1.1
const GPT_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000
const CLAUDE_WEB_SEARCH_USD_PER_REQUEST = 0.01
const GPT_WEB_SEARCH_MEDIUM_CONTEXT_USD_PER_REQUEST = 0.025
const GROK_WEB_SEARCH_USD_PER_REQUEST = 0.005
const GEMINI_GROUNDING_WEB_SEARCH_USD_PER_REQUEST = 0.035

// Fallback profile for historical rows that predate provider usage capture.
// This mirrors our Claude run settings: deep thinking budget + multi-search workflow.
const CLAUDE_DEEP_RESEARCH_ESTIMATED_HIDDEN_OUTPUT_TOKENS = 10_000
const CLAUDE_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS = 4
const CLAUDE_DEEP_RESEARCH_ESTIMATED_INPUT_TOKENS_PER_SEARCH = 1_500
const GPT_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS = 1
const GROK_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS = 1
const GEMINI3_DEEP_RESEARCH_ESTIMATED_GROUNDED_PROMPTS = 1
const DEEPSEEK_ESTIMATED_SEARCH_REQUESTS = 0
const GLM_ESTIMATED_SEARCH_REQUESTS = 0
const LLAMA4_ESTIMATED_SEARCH_REQUESTS = 0
const KIMI_ESTIMATED_SEARCH_REQUESTS = 0
const MINIMAX_ESTIMATED_SEARCH_REQUESTS = 0

// Approximate public model pricing in USD per 1M tokens.
// Keep this updated if provider pricing changes.
const MODEL_PRICING_ESTIMATES_USD_PER_1M_TOKENS: Record<ModelId, ModelPricingEstimate> = {
  'claude-opus': {
    inputUsdPer1MTokens: 5,
    outputUsdPer1MTokens: 25,
    longContextInputTokenThreshold: CLAUDE_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
    longContextInputUsdPer1MTokens: 10,
    longContextOutputUsdPer1MTokens: 37.5,
    webSearchUsdPerRequest: CLAUDE_WEB_SEARCH_USD_PER_REQUEST,
  },
  'gpt-5.4': {
    inputUsdPer1MTokens: 2.5,
    outputUsdPer1MTokens: 15,
    longContextInputTokenThreshold: GPT_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
    longContextInputUsdPer1MTokens: 5,
    longContextOutputUsdPer1MTokens: 22.5,
    cachedInputUsdPer1MTokens: 0.25,
    webSearchUsdPerRequest: GPT_WEB_SEARCH_MEDIUM_CONTEXT_USD_PER_REQUEST,
  },
  'grok-4.1': {
    inputUsdPer1MTokens: 0.2,
    outputUsdPer1MTokens: 0.5,
    longContextInputTokenThreshold: GROK_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
    longContextInputUsdPer1MTokens: 0.4,
    longContextOutputUsdPer1MTokens: 1,
    cachedInputUsdPer1MTokens: 0.05,
    webSearchUsdPerRequest: GROK_WEB_SEARCH_USD_PER_REQUEST,
  },
  'gemini-3-pro': {
    inputUsdPer1MTokens: 2,
    outputUsdPer1MTokens: 15,
    longContextInputTokenThreshold: GEMINI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
    longContextInputUsdPer1MTokens: 3,
    longContextOutputUsdPer1MTokens: 18,
    webSearchUsdPerRequest: GEMINI_GROUNDING_WEB_SEARCH_USD_PER_REQUEST,
  },
  'deepseek-v3.2': {
    inputUsdPer1MTokens: 0.55,
    outputUsdPer1MTokens: 1.68,
  },
  'glm-5': {
    inputUsdPer1MTokens: 1,
    outputUsdPer1MTokens: 4,
  },
  'llama-4-scout': {
    inputUsdPer1MTokens: 0.15,
    outputUsdPer1MTokens: 0.6,
  },
  'kimi-k2.5': {
    inputUsdPer1MTokens: 2,
    outputUsdPer1MTokens: 8,
  },
  'minimax-m2.5': {
    inputUsdPer1MTokens: 1,
    outputUsdPer1MTokens: 4,
  },
}

const APPROX_CHARS_PER_TOKEN = 4
const INPUT_OVERHEAD_TOKENS = 140
const OUTPUT_OVERHEAD_TOKENS = 40

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.round(value))
}

function isUSOnlyInferenceGeo(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === 'us' || normalized === 'usa' || normalized === 'united_states' || normalized === 'united-states'
}

function estimateTokenCount(text: string): number {
  const normalized = text.trim()
  if (!normalized) {
    return 0
  }

  return Math.max(1, Math.round(normalized.length / APPROX_CHARS_PER_TOKEN))
}

export function getCostEstimationProfileForModel(modelId: ModelId): AICostEstimationProfile {
  if (modelId === 'claude-opus') {
    return 'claude-deep-research'
  }
  if (modelId === 'gpt-5.4') {
    return 'gpt-deep-research'
  }
  if (modelId === 'grok-4.1') {
    return 'grok-deep-research'
  }
  if (modelId === 'gemini-3-pro') {
    return 'gemini3-deep-research'
  }
  if (modelId === 'deepseek-v3.2') {
    return 'deepseek-reasoning'
  }
  if (modelId === 'glm-5') {
    return 'glm-reasoning'
  }
  if (modelId === 'llama-4-scout') {
    return 'llama4-reasoning'
  }
  if (modelId === 'kimi-k2.5') {
    return 'kimi-thinking'
  }
  if (modelId === 'minimax-m2.5') {
    return 'minimax-reasoning'
  }
  return 'default'
}

export function estimateCostFromTokenUsage(args: {
  modelId: ModelId
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens5m?: number | null
  cacheCreationInputTokens1h?: number | null
  cacheReadInputTokens?: number | null
  webSearchRequests?: number | null
  inferenceGeo?: string | null
}): number {
  const pricing = MODEL_PRICING_ESTIMATES_USD_PER_1M_TOKENS[args.modelId]
  const safeInputTokens = toNonNegativeInt(args.inputTokens)
  const safeOutputTokens = toNonNegativeInt(args.outputTokens)
  const cacheReadInputTokens = toNonNegativeInt(args.cacheReadInputTokens ?? 0)
  const webSearchRequests = toNonNegativeInt(args.webSearchRequests ?? 0)

  if (args.modelId !== 'claude-opus') {
    const useLongContextPricing = pricing.longContextInputTokenThreshold != null
      ? safeInputTokens > pricing.longContextInputTokenThreshold
      : false

    const inputUsdPer1MTokens = useLongContextPricing
      ? (pricing.longContextInputUsdPer1MTokens ?? pricing.inputUsdPer1MTokens)
      : pricing.inputUsdPer1MTokens
    const outputUsdPer1MTokens = useLongContextPricing
      ? (pricing.longContextOutputUsdPer1MTokens ?? pricing.outputUsdPer1MTokens)
      : pricing.outputUsdPer1MTokens

    let inputCostUsd = 0
    if (pricing.cachedInputUsdPer1MTokens != null) {
      const cachedInputTokens = Math.min(safeInputTokens, cacheReadInputTokens)
      const baseInputTokens = Math.max(0, safeInputTokens - cachedInputTokens)
      inputCostUsd =
        ((baseInputTokens / TOKENS_PER_MILLION) * inputUsdPer1MTokens) +
        ((cachedInputTokens / TOKENS_PER_MILLION) * pricing.cachedInputUsdPer1MTokens)
    } else {
      inputCostUsd = (safeInputTokens / TOKENS_PER_MILLION) * inputUsdPer1MTokens
    }

    const outputCostUsd = (safeOutputTokens / TOKENS_PER_MILLION) * outputUsdPer1MTokens
    const webSearchCostUsd = webSearchRequests * (pricing.webSearchUsdPerRequest ?? 0)

    return inputCostUsd + outputCostUsd + webSearchCostUsd
  }

  const cacheCreationInputTokens5m = toNonNegativeInt(args.cacheCreationInputTokens5m ?? 0)
  const cacheCreationInputTokens1h = toNonNegativeInt(args.cacheCreationInputTokens1h ?? 0)
  const billedInputTokens =
    cacheCreationInputTokens5m + cacheCreationInputTokens1h + cacheReadInputTokens
  const baseInputTokens = Math.max(0, safeInputTokens - billedInputTokens)
  const allInputTokens = baseInputTokens + billedInputTokens
  const useLongContextPricing = allInputTokens > (pricing.longContextInputTokenThreshold ?? CLAUDE_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD)

  const inputUsdPer1MTokens = useLongContextPricing
    ? (pricing.longContextInputUsdPer1MTokens ?? pricing.inputUsdPer1MTokens)
    : pricing.inputUsdPer1MTokens
  const outputUsdPer1MTokens = useLongContextPricing
    ? (pricing.longContextOutputUsdPer1MTokens ?? pricing.outputUsdPer1MTokens)
    : pricing.outputUsdPer1MTokens

  const inputCostUsd =
    ((baseInputTokens / TOKENS_PER_MILLION) * inputUsdPer1MTokens) +
    ((cacheCreationInputTokens5m / TOKENS_PER_MILLION) * inputUsdPer1MTokens * CLAUDE_CACHE_WRITE_5M_MULTIPLIER) +
    ((cacheCreationInputTokens1h / TOKENS_PER_MILLION) * inputUsdPer1MTokens * CLAUDE_CACHE_WRITE_1H_MULTIPLIER) +
    ((cacheReadInputTokens / TOKENS_PER_MILLION) * inputUsdPer1MTokens * CLAUDE_CACHE_READ_MULTIPLIER)
  const outputCostUsd = (safeOutputTokens / TOKENS_PER_MILLION) * outputUsdPer1MTokens

  const tokenCostMultiplier = isUSOnlyInferenceGeo(args.inferenceGeo)
    ? CLAUDE_US_INFERENCE_TOKEN_MULTIPLIER
    : 1
  const tokenCostUsd = (inputCostUsd + outputCostUsd) * tokenCostMultiplier
  const webSearchCostUsd = webSearchRequests * (pricing.webSearchUsdPerRequest ?? CLAUDE_WEB_SEARCH_USD_PER_REQUEST)

  return tokenCostUsd + webSearchCostUsd
}

export function estimateTextGenerationCost(args: {
  modelId: ModelId
  promptText: string
  responseText: string
  profile?: AICostEstimationProfile
}): {
  inputTokens: number
  outputTokens: number
  webSearchRequests: number
  estimatedCostUsd: number
} {
  let inputTokens = estimateTokenCount(args.promptText) + INPUT_OVERHEAD_TOKENS
  let outputTokens = estimateTokenCount(args.responseText) + OUTPUT_OVERHEAD_TOKENS
  let webSearchRequests = 0

  if (args.profile === 'claude-deep-research' && args.modelId === 'claude-opus') {
    inputTokens += CLAUDE_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS * CLAUDE_DEEP_RESEARCH_ESTIMATED_INPUT_TOKENS_PER_SEARCH
    outputTokens += CLAUDE_DEEP_RESEARCH_ESTIMATED_HIDDEN_OUTPUT_TOKENS
    webSearchRequests = CLAUDE_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'gpt-deep-research' && args.modelId === 'gpt-5.4') {
    webSearchRequests = GPT_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'grok-deep-research' && args.modelId === 'grok-4.1') {
    webSearchRequests = GROK_DEEP_RESEARCH_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'gemini3-deep-research' && args.modelId === 'gemini-3-pro') {
    webSearchRequests = GEMINI3_DEEP_RESEARCH_ESTIMATED_GROUNDED_PROMPTS
  } else if (args.profile === 'deepseek-reasoning' && args.modelId === 'deepseek-v3.2') {
    webSearchRequests = DEEPSEEK_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'glm-reasoning' && args.modelId === 'glm-5') {
    webSearchRequests = GLM_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'llama4-reasoning' && args.modelId === 'llama-4-scout') {
    webSearchRequests = LLAMA4_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'kimi-thinking' && args.modelId === 'kimi-k2.5') {
    webSearchRequests = KIMI_ESTIMATED_SEARCH_REQUESTS
  } else if (args.profile === 'minimax-reasoning' && args.modelId === 'minimax-m2.5') {
    webSearchRequests = MINIMAX_ESTIMATED_SEARCH_REQUESTS
  }

  return {
    inputTokens,
    outputTokens,
    webSearchRequests,
    estimatedCostUsd: estimateCostFromTokenUsage({
      modelId: args.modelId,
      inputTokens,
      outputTokens,
      webSearchRequests,
    }),
  }
}
