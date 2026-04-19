export const MODEL_REGISTRY_IDS = [
  'claude-opus',
  'gpt-5.4',
  'grok-4.20',
  'gemini-3-pro',
  'deepseek-v3.2',
  'glm-5',
  'llama-4-scout',
  'kimi-k2.5',
  'minimax-m2.5',
] as const

export type ModelRegistryId = (typeof MODEL_REGISTRY_IDS)[number]

export type ModelMethodBinding = {
  version: string
  internet: boolean
  internetDetail: string
  reasoning: string
  reasoningDetail: string
  maxTokens: string
}

export type ModelRuntimeMetadata = {
  providerModelId: string
  requestModelEnvVar?: string
  method: ModelMethodBinding
}

export type ModelVerifierProvider = 'openai' | 'xai' | 'google' | 'anthropic'
export type ModelVerifierEnvKey = 'OPENAI_API_KEY' | 'XAI_API_KEY' | 'GOOGLE_API_KEY' | 'ANTHROPIC_API_KEY'

export type ModelVerifierMetadata = {
  provider: ModelVerifierProvider
  providerLabel: string
  envKey: ModelVerifierEnvKey
  selectable?: boolean
}

export type ModelCostEstimationProfile =
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

export type ModelProviderPricingEstimate = {
  inputUsdPer1MTokens: number
  outputUsdPer1MTokens: number
  longContextInputTokenThreshold?: number
  longContextInputUsdPer1MTokens?: number
  longContextOutputUsdPer1MTokens?: number
  cachedInputUsdPer1MTokens?: number
  webSearchUsdPerRequest?: number
}

export type ModelAdminPricingEstimate = {
  inputUsdPer1MTokens: number
  outputUsdPer1MTokens: number
  searchUsdPerRequest?: number
  assumedSearchContentInputTokens?: number
  outputReasoningMultiplier?: number
}

export type ModelFallbackUsageEstimate = {
  profile: ModelCostEstimationProfile
  webSearchRequests: number
  extraInputTokens: number
  extraOutputTokens: number
}

export type ModelCostingMetadata = {
  providerEstimate: ModelProviderPricingEstimate
  adminEstimate: ModelAdminPricingEstimate
  fallbackUsageEstimate: ModelFallbackUsageEstimate
}

export type ModelRegistryEntry = {
  name: string
  fullName: string
  positionLabel?: string
  color: string
  provider: string
  features: string[]
  runtime: ModelRuntimeMetadata
  verifier?: ModelVerifierMetadata
  costing: ModelCostingMetadata
}

export const MODEL_REGISTRY = {
  'claude-opus': {
    name: 'Claude',
    fullName: 'Claude Opus 4.7',
    positionLabel: 'Claude 4.7',
    color: '#D4604A',
    provider: 'Anthropic',
    features: ['Web Search', 'Extended Thinking'],
    runtime: {
      providerModelId: 'claude-opus-4-7',
      method: {
        version: 'claude-opus-4-7',
        internet: true,
        internetDetail: 'Anthropic web_search_20250305 (max_uses: 7)',
        reasoning: 'Extended Thinking',
        reasoningDetail: 'Native thinking blocks + tool-assisted synthesis',
        maxTokens: '4,096 output',
      },
    },
    verifier: {
      provider: 'anthropic',
      providerLabel: 'Anthropic',
      envKey: 'ANTHROPIC_API_KEY',
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 5,
        outputUsdPer1MTokens: 25,
        longContextInputTokenThreshold: 200_000,
        longContextInputUsdPer1MTokens: 10,
        longContextOutputUsdPer1MTokens: 37.5,
        webSearchUsdPerRequest: 0.01,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 5,
        outputUsdPer1MTokens: 25,
        searchUsdPerRequest: 0.01,
        assumedSearchContentInputTokens: 1200,
        outputReasoningMultiplier: 1.2,
      },
      fallbackUsageEstimate: {
        profile: 'claude-deep-research',
        webSearchRequests: 4,
        extraInputTokens: 6_000,
        extraOutputTokens: 10_000,
      },
    },
  },
  'gpt-5.4': {
    name: 'GPT',
    fullName: 'GPT-5.4',
    color: '#C9A227',
    provider: 'OpenAI',
    features: ['Web Search', 'Reasoning'],
    runtime: {
      providerModelId: 'gpt-5.4',
      method: {
        version: 'gpt-5.4',
        internet: true,
        internetDetail: 'OpenAI web_search tool',
        reasoning: 'High Effort',
        reasoningDetail: 'reasoning.effort = high',
        maxTokens: '16,000 output',
      },
    },
    verifier: {
      provider: 'openai',
      providerLabel: 'OpenAI',
      envKey: 'OPENAI_API_KEY',
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 2.5,
        outputUsdPer1MTokens: 15,
        longContextInputTokenThreshold: 272_000,
        longContextInputUsdPer1MTokens: 5,
        longContextOutputUsdPer1MTokens: 22.5,
        cachedInputUsdPer1MTokens: 0.25,
        webSearchUsdPerRequest: 0.025,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 2.5,
        outputUsdPer1MTokens: 15,
        searchUsdPerRequest: 0.01,
        assumedSearchContentInputTokens: 1200,
        outputReasoningMultiplier: 2.4,
      },
      fallbackUsageEstimate: {
        profile: 'gpt-deep-research',
        webSearchRequests: 1,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'grok-4.20': {
    name: 'Grok',
    fullName: 'Grok 4.20',
    color: '#2D7CF6',
    provider: 'xAI',
    features: ['Reasoning', 'Web Search'],
    runtime: {
      providerModelId: 'grok-4.20-reasoning',
      method: {
        version: 'grok-4.20-reasoning',
        internet: true,
        internetDetail: 'Responses API web_search tool',
        reasoning: 'Reasoning',
        reasoningDetail: 'Responses API with native reasoning + web_search',
        maxTokens: '16,000 output',
      },
    },
    verifier: {
      provider: 'xai',
      providerLabel: 'xAI',
      envKey: 'XAI_API_KEY',
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 0.2,
        outputUsdPer1MTokens: 0.5,
        longContextInputTokenThreshold: 128_000,
        longContextInputUsdPer1MTokens: 0.4,
        longContextOutputUsdPer1MTokens: 1,
        cachedInputUsdPer1MTokens: 0.05,
        webSearchUsdPerRequest: 0.005,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 0.2,
        outputUsdPer1MTokens: 0.5,
        searchUsdPerRequest: 0.005,
        assumedSearchContentInputTokens: 900,
        outputReasoningMultiplier: 1.4,
      },
      fallbackUsageEstimate: {
        profile: 'grok-deep-research',
        webSearchRequests: 1,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'gemini-3-pro': {
    name: 'Gemini 3.1',
    fullName: 'Gemini 3.1 Pro',
    color: '#6A5AE0',
    provider: 'Google',
    features: ['Google Search Grounding', 'Thinking'],
    runtime: {
      providerModelId: 'gemini-3.1-pro-preview',
      method: {
        version: 'gemini-3.1-pro-preview',
        internet: true,
        internetDetail: 'Google Search grounding',
        reasoning: 'Thinking',
        reasoningDetail: 'thinkingConfig.thinkingBudget = -1',
        maxTokens: '65,536 output',
      },
    },
    verifier: {
      provider: 'google',
      providerLabel: 'Google',
      envKey: 'GOOGLE_API_KEY',
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 2,
        outputUsdPer1MTokens: 12,
        longContextInputTokenThreshold: 200_000,
        longContextInputUsdPer1MTokens: 4,
        longContextOutputUsdPer1MTokens: 18,
        webSearchUsdPerRequest: 0.014,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 2,
        outputUsdPer1MTokens: 12,
        searchUsdPerRequest: 0.014,
        assumedSearchContentInputTokens: 1000,
        outputReasoningMultiplier: 2.2,
      },
      fallbackUsageEstimate: {
        profile: 'gemini3-deep-research',
        webSearchRequests: 1,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'deepseek-v3.2': {
    name: 'DeepSeek',
    fullName: 'DeepSeek V3.2',
    color: '#3A86FF',
    provider: 'Fireworks',
    features: ['Reasoning', 'Structured Output'],
    runtime: {
      providerModelId: 'accounts/fireworks/models/deepseek-v3p2',
      method: {
        version: 'accounts/fireworks/models/deepseek-v3p2',
        internet: false,
        internetDetail: 'No web-search tool configured in the combined decision generator',
        reasoning: 'Reasoning mode',
        reasoningDetail: 'extra_body.reasoning_effort = high',
        maxTokens: '16,000 output',
      },
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 0.55,
        outputUsdPer1MTokens: 1.68,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 0.56,
        outputUsdPer1MTokens: 1.68,
        outputReasoningMultiplier: 1,
      },
      fallbackUsageEstimate: {
        profile: 'deepseek-reasoning',
        webSearchRequests: 0,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'glm-5': {
    name: 'GLM',
    fullName: 'GLM 5',
    color: '#0B9E6F',
    provider: 'Fireworks',
    features: ['Reasoning', 'Long Context'],
    runtime: {
      providerModelId: 'accounts/fireworks/models/glm-5',
      method: {
        version: 'accounts/fireworks/models/glm-5',
        internet: false,
        internetDetail: 'No web-search tool configured in the combined decision generator',
        reasoning: 'Provider default',
        reasoningDetail: 'No explicit reasoning parameter configured',
        maxTokens: '16,000 output',
      },
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 1,
        outputUsdPer1MTokens: 4,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 1,
        outputUsdPer1MTokens: 3.2,
        outputReasoningMultiplier: 1,
      },
      fallbackUsageEstimate: {
        profile: 'glm-reasoning',
        webSearchRequests: 0,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'llama-4-scout': {
    name: 'Llama',
    fullName: 'Llama 3.3 70B',
    color: '#2E7D32',
    provider: 'Fireworks',
    features: ['Reasoning', 'Long Context'],
    runtime: {
      providerModelId: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      method: {
        version: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
        internet: false,
        internetDetail: 'No web-search tool configured in the combined decision generator',
        reasoning: 'Provider default',
        reasoningDetail: 'No explicit reasoning parameter configured',
        maxTokens: '4,096 output',
      },
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 0.9,
        outputUsdPer1MTokens: 0.9,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 0.9,
        outputUsdPer1MTokens: 0.9,
        outputReasoningMultiplier: 1,
      },
      fallbackUsageEstimate: {
        profile: 'llama4-reasoning',
        webSearchRequests: 0,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'kimi-k2.5': {
    name: 'Kimi',
    fullName: 'Kimi K2.5',
    color: '#F28C28',
    provider: 'Fireworks',
    features: ['Reasoning', 'Long Context'],
    runtime: {
      providerModelId: 'accounts/fireworks/models/kimi-k2p5',
      method: {
        version: 'accounts/fireworks/models/kimi-k2p5',
        internet: false,
        internetDetail: 'No web-search tool configured in the combined decision generator',
        reasoning: 'Thinking',
        reasoningDetail: 'extra_body.chat_template_args.enable_thinking = true',
        maxTokens: '16,000 output',
      },
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 2,
        outputUsdPer1MTokens: 8,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 0.6,
        outputUsdPer1MTokens: 3,
        outputReasoningMultiplier: 1,
      },
      fallbackUsageEstimate: {
        profile: 'kimi-thinking',
        webSearchRequests: 0,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
  'minimax-m2.5': {
    name: 'MiniMax',
    fullName: 'MiniMax M2.5',
    color: '#0F766E',
    provider: 'Fireworks',
    features: ['Reasoning', 'Large Context'],
    runtime: {
      providerModelId: 'accounts/fireworks/models/minimax-m2p5',
      method: {
        version: 'accounts/fireworks/models/minimax-m2p5',
        internet: false,
        internetDetail: 'No web-search tool configured in the combined decision generator',
        reasoning: 'Provider default',
        reasoningDetail: 'No explicit reasoning parameter configured',
        maxTokens: '16,000 output',
      },
    },
    costing: {
      providerEstimate: {
        inputUsdPer1MTokens: 1,
        outputUsdPer1MTokens: 4,
      },
      adminEstimate: {
        inputUsdPer1MTokens: 0.3,
        outputUsdPer1MTokens: 1.2,
        outputReasoningMultiplier: 1.1,
      },
      fallbackUsageEstimate: {
        profile: 'minimax-reasoning',
        webSearchRequests: 0,
        extraInputTokens: 0,
        extraOutputTokens: 0,
      },
    },
  },
} as const satisfies Record<ModelRegistryId, ModelRegistryEntry>

export function getModelRegistryEntry(modelId: ModelRegistryId): ModelRegistryEntry {
  return MODEL_REGISTRY[modelId]
}

export function getModelPositionLabel(modelId: ModelRegistryId): string {
  const entry = MODEL_REGISTRY[modelId]
  return ('positionLabel' in entry ? entry.positionLabel : undefined) ?? entry.fullName
}

export function getModelProviderPricingEstimate(modelId: ModelRegistryId): ModelProviderPricingEstimate {
  return MODEL_REGISTRY[modelId].costing.providerEstimate
}

export function getModelAdminPricingEstimate(modelId: ModelRegistryId): ModelAdminPricingEstimate {
  return MODEL_REGISTRY[modelId].costing.adminEstimate
}

export function getModelFallbackUsageEstimate(modelId: ModelRegistryId): ModelFallbackUsageEstimate {
  return MODEL_REGISTRY[modelId].costing.fallbackUsageEstimate
}
