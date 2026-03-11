import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import type { ModelId } from '@/lib/constants'
import { buildModelDecisionPrompt, parseModelDecisionResponse, type ModelDecisionInput, type ModelDecisionResult } from './model-decision-prompt'

interface ProviderUsageSnapshot {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  cacheCreationInputTokens5m: number | null
  cacheCreationInputTokens1h: number | null
  cacheReadInputTokens: number | null
  webSearchRequests: number | null
  inferenceGeo: string | null
}

export interface ModelDecisionGeneration {
  result: ModelDecisionResult
  rawResponse: string
  usage: ProviderUsageSnapshot | null
}

interface ModelDecisionGeneratorConfig {
  generator: (input: ModelDecisionInput) => Promise<ModelDecisionGeneration>
  enabled: () => boolean
}

const BASETEN_BASE_URL = 'https://inference.baseten.co/v1'
const DEEPSEEK_MODEL = 'deepseek-ai/DeepSeek-V3.1'
const GLM_MODEL = 'zai-org/GLM-5'
const LLAMA_4_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const KIMI_MODEL = 'moonshotai/Kimi-K2.5'
const MINIMAX_MODEL = 'MiniMax-M2.5'
const DEFAULT_USAGE: ProviderUsageSnapshot = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
  cacheCreationInputTokens5m: null,
  cacheCreationInputTokens1h: null,
  cacheReadInputTokens: null,
  webSearchRequests: null,
  inferenceGeo: null,
}

function extractClaudeResponseText(message: any): string {
  const textBlocks = (message?.content || [])
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text.trim())
    .filter((text: string) => text.length > 0)

  if (textBlocks.length === 0) {
    return ''
  }

  const jsonLikeBlock = [...textBlocks].reverse().find((text) => text.includes('{') && text.includes('}'))
  return (jsonLikeBlock || textBlocks.join('\n')).trim()
}

function extractResponseText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim()
  }

  const messages = (response?.output || []).filter((item: any) => item?.type === 'message')
  const parts: string[] = []

  for (const message of messages) {
    for (const content of message?.content || []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') {
        const text = content.text.trim()
        if (text.length > 0) {
          parts.push(text)
        }
      }
    }
  }

  return parts.join('\n').trim()
}

function extractChatCompletionText(completion: any): string {
  const content = completion?.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === 'string') return item.text
        if (typeof item === 'string') return item
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

function parseUsageFromOpenAIResponse(response: any, webSearchRequests: number): ProviderUsageSnapshot | null {
  const usage = response?.usage
  if (!usage || typeof usage !== 'object') {
    return DEFAULT_USAGE
  }

  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : null
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : null
  const totalTokens = typeof usage.total_tokens === 'number'
    ? usage.total_tokens
    : (typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : null)
  const reasoningTokens = typeof usage.output_tokens_details?.reasoning_tokens === 'number'
    ? usage.output_tokens_details.reasoning_tokens
    : null
  const cacheReadInputTokens = typeof usage.input_tokens_details?.cached_tokens === 'number'
    ? usage.input_tokens_details.cached_tokens
    : null

  return {
    ...DEFAULT_USAGE,
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cacheReadInputTokens,
    webSearchRequests,
  }
}

function parseUsageFromClaudeMessage(message: any, webSearchRequests: number): ProviderUsageSnapshot | null {
  const usage = message?.usage
  if (!usage || typeof usage !== 'object') {
    return DEFAULT_USAGE
  }

  return {
    ...DEFAULT_USAGE,
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
    totalTokens:
      typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
        ? usage.input_tokens + usage.output_tokens
        : null,
    cacheCreationInputTokens5m: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : null,
    cacheReadInputTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : null,
    webSearchRequests,
    inferenceGeo: typeof usage.service_tier === 'string' ? usage.service_tier : null,
    reasoningTokens: null,
    cacheCreationInputTokens1h: null,
  }
}

function buildOutput(rawResponse: string, input: ModelDecisionInput, usage: ProviderUsageSnapshot | null = DEFAULT_USAGE): ModelDecisionGeneration {
  return {
    rawResponse,
    usage,
    result: parseModelDecisionResponse(rawResponse, input.constraints.allowedActions, input.constraints.explanationMaxChars),
  }
}

async function generateClaudeDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt = buildModelDecisionPrompt(input)
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 7 }],
  } as any)

  const content = extractClaudeResponseText(message)
  if (!content) {
    throw new Error('No text content in Claude Opus 4.6 response')
  }

  const toolUseCount = Array.isArray(message?.content)
    ? message.content.filter((block: any) => block?.type === 'server_tool_use').length
    : 0

  return buildOutput(content, input, parseUsageFromClaudeMessage(message, toolUseCount))
}

async function generateGptDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = buildModelDecisionPrompt(input)
  const response = await client.responses.create({
    model: 'gpt-5.2',
    input: prompt,
    max_output_tokens: 8000,
    tools: [{ type: 'web_search' }],
    reasoning: { effort: 'high' },
  } as any)

  const content = extractResponseText(response)
  if (!content) {
    throw new Error('No content in GPT-5.2 response')
  }

  return buildOutput(content, input, parseUsageFromOpenAIResponse(response, 1))
}

async function generateGrokDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  })

  const prompt = buildModelDecisionPrompt(input)
  const completion = await client.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    search_mode: 'auto',
  } as any)

  const content = extractChatCompletionText(completion)
  if (!content) {
    throw new Error('No content in Grok 4.1 response')
  }

  return buildOutput(content, input)
}

async function generateGeminiDecision(input: ModelDecisionInput, model: string): Promise<ModelDecisionGeneration> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  const prompt = buildModelDecisionPrompt(input)
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: 16000,
      thinkingConfig: {
        thinkingBudget: -1,
      },
      tools: [{ googleSearch: {} }],
    },
  })

  const content = response.text
  if (!content) {
    throw new Error(`No content in ${model} response`)
  }

  return buildOutput(content, input)
}

async function generateGemini25Decision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateGeminiDecision(input, 'gemini-2.5-pro')
}

async function generateGemini3Decision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateGeminiDecision(input, 'gemini-3-pro-preview')
}

async function generateOpenAICompatibleDecision(args: {
  apiKey: string | undefined
  baseURL: string
  model: string
  input: ModelDecisionInput
  errorLabel: string
  maxTokens?: number
  temperature?: number
  extraBody?: Record<string, unknown>
}): Promise<ModelDecisionGeneration> {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
  })

  const prompt = buildModelDecisionPrompt(args.input)
  const completionRequest: any = {
    model: args.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: args.maxTokens ?? 8192,
    temperature: args.temperature ?? 0.6,
  }

  if (args.extraBody && Object.keys(args.extraBody).length > 0) {
    completionRequest.extra_body = args.extraBody
  }

  const completion = await client.chat.completions.create(completionRequest)
  const content = extractChatCompletionText(completion)
  if (!content) {
    throw new Error(`No content in ${args.errorLabel} response`)
  }

  return buildOutput(content, args.input)
}

async function generateDeepSeekDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateOpenAICompatibleDecision({
    apiKey: process.env.BASETEN_DEEPSEEK_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: DEEPSEEK_MODEL,
    input,
    errorLabel: 'DeepSeek V3.1',
    maxTokens: 8192,
    temperature: 0.6,
    extraBody: { reasoning_effort: 'high' },
  })
}

async function generateLlama4Decision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateOpenAICompatibleDecision({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: LLAMA_4_MODEL,
    input,
    errorLabel: 'Llama 4 Scout',
    maxTokens: 8192,
    temperature: 0.4,
  })
}

async function generateGlm5Decision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateOpenAICompatibleDecision({
    apiKey: process.env.BASETEN_GLM_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: GLM_MODEL,
    input,
    errorLabel: 'GLM 5',
    maxTokens: 16000,
    temperature: 0.6,
  })
}

async function generateKimiDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateOpenAICompatibleDecision({
    apiKey: process.env.BASETEN_KIMI_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: KIMI_MODEL,
    input,
    errorLabel: 'Kimi K2.5 Thinking',
    maxTokens: 16000,
    temperature: 1.0,
    extraBody: { chat_template_args: { enable_thinking: true } },
  })
}

async function generateMiniMaxDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateOpenAICompatibleDecision({
    apiKey: process.env.MINIMAX_API_KEY,
    baseURL: 'https://api.minimax.io/v1',
    model: MINIMAX_MODEL,
    input,
    errorLabel: 'MiniMax M2.5',
    maxTokens: 8192,
    temperature: 0.7,
  })
}

export const MODEL_DECISION_GENERATORS: Record<ModelId, ModelDecisionGeneratorConfig> = {
  'claude-opus': {
    generator: generateClaudeDecision,
    enabled: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'gpt-5.2': {
    generator: generateGptDecision,
    enabled: () => !!process.env.OPENAI_API_KEY,
  },
  'grok-4': {
    generator: generateGrokDecision,
    enabled: () => !!process.env.XAI_API_KEY,
  },
  'gemini-2.5': {
    generator: generateGemini25Decision,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'gemini-3-pro': {
    generator: generateGemini3Decision,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'deepseek-v3.2': {
    generator: generateDeepSeekDecision,
    enabled: () => !!process.env.BASETEN_DEEPSEEK_API_KEY,
  },
  'glm-5': {
    generator: generateGlm5Decision,
    enabled: () => !!process.env.BASETEN_GLM_API_KEY,
  },
  'llama-4': {
    generator: generateLlama4Decision,
    enabled: () => !!process.env.GROQ_API_KEY,
  },
  'kimi-k2.5': {
    generator: generateKimiDecision,
    enabled: () => !!process.env.BASETEN_KIMI_API_KEY,
  },
  'minimax-m2.5': {
    generator: generateMiniMaxDecision,
    enabled: () => !!process.env.MINIMAX_API_KEY,
  },
}
