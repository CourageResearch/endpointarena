import type { ModelId } from '@/lib/constants'

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

const MODEL_RUNTIME_METADATA: Record<ModelId, ModelRuntimeMetadata> = {
  'claude-opus': {
    providerModelId: 'claude-opus-4-6',
    method: {
      version: 'claude-opus-4-6',
      internet: true,
      internetDetail: 'Anthropic web_search_20250305 (max_uses: 7)',
      reasoning: 'Extended Thinking',
      reasoningDetail: 'Native thinking blocks + tool-assisted synthesis',
      maxTokens: '4,096 output',
    },
  },
  'gpt-5.4': {
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
  'grok-4.1': {
    providerModelId: 'grok-4-1-fast-reasoning',
    method: {
      version: 'grok-4-1-fast-reasoning',
      internet: true,
      internetDetail: 'search_mode: auto',
      reasoning: 'Fast Reasoning',
      reasoningDetail: 'Native fast reasoning mode',
      maxTokens: '16,000 output',
    },
  },
  'gemini-3-pro': {
    providerModelId: 'gemini-3-pro-preview',
    method: {
      version: 'gemini-3-pro-preview',
      internet: true,
      internetDetail: 'Google Search grounding',
      reasoning: 'Thinking',
      reasoningDetail: 'thinkingConfig.thinkingBudget = -1',
      maxTokens: '65,536 output',
    },
  },
  'deepseek-v3.2': {
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
  'glm-5': {
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
  'llama-4-scout': {
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
  'kimi-k2.5': {
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
  'minimax-m2.5': {
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
}

export const MODEL_METHOD_BINDINGS = Object.fromEntries(
  Object.entries(MODEL_RUNTIME_METADATA).map(([modelId, metadata]) => [modelId, metadata.method]),
) as Record<ModelId, ModelMethodBinding>

export const MODEL_PROVIDER_MODEL_IDS = Object.fromEntries(
  Object.entries(MODEL_RUNTIME_METADATA).map(([modelId, metadata]) => [modelId, metadata.providerModelId]),
) as Record<ModelId, string>
