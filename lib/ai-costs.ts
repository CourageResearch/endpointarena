import type { ModelId } from '@/lib/constants'
import {
  getModelFallbackUsageEstimate,
  getModelProviderPricingEstimate,
  type ModelCostEstimationProfile,
} from '@/lib/model-registry'

export const AI_COST_SOURCES = ['provider', 'estimated', 'subscription'] as const
export type AICostSource = (typeof AI_COST_SOURCES)[number]
export type AICostEstimationProfile = ModelCostEstimationProfile

const TOKENS_PER_MILLION = 1_000_000
const CLAUDE_CACHE_WRITE_5M_MULTIPLIER = 1.25
const CLAUDE_CACHE_WRITE_1H_MULTIPLIER = 2
const CLAUDE_CACHE_READ_MULTIPLIER = 0.1
const CLAUDE_US_INFERENCE_TOKEN_MULTIPLIER = 1.1

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
  return getModelFallbackUsageEstimate(modelId).profile
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
  const pricing = getModelProviderPricingEstimate(args.modelId)
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

  const useClaudeLongContextPricing = pricing.longContextInputTokenThreshold != null
    ? allInputTokens > pricing.longContextInputTokenThreshold
    : false
  const inputUsdPer1MTokens = useClaudeLongContextPricing
    ? (pricing.longContextInputUsdPer1MTokens ?? pricing.inputUsdPer1MTokens)
    : pricing.inputUsdPer1MTokens
  const outputUsdPer1MTokens = useClaudeLongContextPricing
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
  const webSearchCostUsd = webSearchRequests * (pricing.webSearchUsdPerRequest ?? 0)

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
  const fallbackUsage = getModelFallbackUsageEstimate(args.modelId)
  const activeProfile = args.profile ?? fallbackUsage.profile

  if (activeProfile === fallbackUsage.profile) {
    inputTokens += fallbackUsage.extraInputTokens
    outputTokens += fallbackUsage.extraOutputTokens
    webSearchRequests = fallbackUsage.webSearchRequests
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
