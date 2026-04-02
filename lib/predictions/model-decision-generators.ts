import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import type { ModelId } from '@/lib/constants'
import { askClaudeWeb } from './claude-web-runner'
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
  billingMode?: 'metered' | 'subscription'
}

interface ModelDecisionGeneratorConfig {
  generator: (input: ModelDecisionInput, options?: ModelDecisionGeneratorOptions) => Promise<ModelDecisionGeneration>
  enabled: (options?: ModelDecisionGeneratorOptions) => boolean
}

export interface ModelDecisionGeneratorOptions {
  claudeProvider?: 'api' | 'web'
}

interface OpenAICompatibleResponseFormat {
  type: 'json_object' | 'json_schema'
  json_schema?: Record<string, unknown>
}

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1'
const OPENAI_GPT_MODEL = 'gpt-5.4'
const DEEPSEEK_MODEL = 'accounts/fireworks/models/deepseek-v3p2'
const GLM_MODEL = 'accounts/fireworks/models/glm-5'
const LLAMA_4_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const KIMI_MODEL = 'accounts/fireworks/models/kimi-k2p5'
const MINIMAX_MODEL = 'accounts/fireworks/models/minimax-m2p5'
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

function parseUsageFromChatCompletion(completion: any): ProviderUsageSnapshot | null {
  const usage = completion?.usage
  if (!usage || typeof usage !== 'object') {
    return DEFAULT_USAGE
  }

  const inputTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null
  const outputTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null
  const totalTokens = typeof usage.total_tokens === 'number'
    ? usage.total_tokens
    : (typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : null)

  return {
    ...DEFAULT_USAGE,
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens: typeof usage.completion_tokens_details?.reasoning_tokens === 'number'
      ? usage.completion_tokens_details.reasoning_tokens
      : null,
    cacheReadInputTokens: typeof usage.prompt_tokens_details?.cached_tokens === 'number'
      ? usage.prompt_tokens_details.cached_tokens
      : null,
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

function buildOutput(
  rawResponse: string,
  input: ModelDecisionInput,
  usage: ProviderUsageSnapshot | null = DEFAULT_USAGE,
  billingMode: 'metered' | 'subscription' = 'metered',
): ModelDecisionGeneration {
  return {
    rawResponse,
    usage,
    billingMode,
    result: parseModelDecisionResponse(rawResponse, input.constraints.allowedActions, input.constraints.explanationMaxChars),
  }
}

function buildClaudeWebDecisionPrompt(input: ModelDecisionInput): string {
  return [
    'Use Claude web search before answering.',
    'Search the live public web for recent, decision-relevant information about this trial, sponsor, indication, endpoint, and timeline.',
    'After searching, follow the instructions below exactly and return valid JSON only.',
    '',
    buildModelDecisionPrompt(input),
  ].join('\n')
}

async function generateClaudeApiDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
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

async function generateClaudeWebDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  const content = await askClaudeWeb(buildClaudeWebDecisionPrompt(input))
  return buildOutput(content, input, null, 'subscription')
}

async function generateClaudeDecision(
  input: ModelDecisionInput,
  options: ModelDecisionGeneratorOptions = {},
): Promise<ModelDecisionGeneration> {
  if (options.claudeProvider === 'web') {
    return generateClaudeWebDecision(input)
  }

  return generateClaudeApiDecision(input)
}

async function generateGptDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = buildModelDecisionPrompt(input)
  const response = await client.responses.create({
    model: OPENAI_GPT_MODEL,
    input: prompt,
    max_output_tokens: 8000,
    tools: [{ type: 'web_search' }],
    reasoning: { effort: 'high' },
  } as any)

  const content = extractResponseText(response)
  if (!content) {
    throw new Error('No content in GPT-5.4 response')
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

async function generateGemini3Decision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateGeminiDecision(input, 'gemini-3-pro-preview')
}

async function generateFireworksDecision(args: {
  model: string
  input: ModelDecisionInput
  errorLabel: string
  maxTokens?: number
  temperature?: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  responseFormat?: OpenAICompatibleResponseFormat
}): Promise<ModelDecisionGeneration> {
  const apiKey = process.env.FIREWORKS_API_KEY
  if (!apiKey) {
    throw new Error('FIREWORKS_API_KEY is not configured')
  }

  const prompt = buildModelDecisionPrompt(args.input)
  const requestBody: Record<string, unknown> = {
    model: args.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: args.maxTokens ?? 8192,
    temperature: args.temperature ?? 0.6,
  }

  if (args.reasoningEffort) {
    requestBody.reasoning_effort = args.reasoningEffort
  }

  if (args.responseFormat) {
    requestBody.response_format = args.responseFormat
  }

  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  const rawPayload = await response.text()
  if (!response.ok) {
    throw new Error(`Fireworks ${args.errorLabel} request failed (${response.status}): ${rawPayload.slice(0, 400)}`)
  }

  const completion = JSON.parse(rawPayload)
  const content = extractChatCompletionText(completion)
  if (!content) {
    throw new Error(`No content in ${args.errorLabel} response`)
  }

  return buildOutput(content, args.input, parseUsageFromChatCompletion(completion))
}

async function generateOpenAICompatibleDecision(args: {
  apiKey: string | undefined
  baseURL: string
  model: string
  input: ModelDecisionInput
  errorLabel: string
  maxTokens?: number
  temperature?: number
  requestOverrides?: Record<string, unknown>
  responseFormat?: OpenAICompatibleResponseFormat
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

  if (args.requestOverrides && Object.keys(args.requestOverrides).length > 0) {
    Object.assign(completionRequest, args.requestOverrides)
  }

  if (args.responseFormat) {
    completionRequest.response_format = args.responseFormat
  }

  const completion = await client.chat.completions.create(completionRequest)
  const content = extractChatCompletionText(completion)
  if (!content) {
    throw new Error(`No content in ${args.errorLabel} response`)
  }

  return buildOutput(content, args.input, parseUsageFromChatCompletion(completion))
}

async function generateDeepSeekDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateFireworksDecision({
    model: DEEPSEEK_MODEL,
    input,
    errorLabel: 'DeepSeek V3.2',
    maxTokens: 4096,
    temperature: 0.6,
    reasoningEffort: 'none',
    responseFormat: { type: 'json_object' },
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
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
  })
}

async function generateGlm5Decision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateFireworksDecision({
    model: GLM_MODEL,
    input,
    errorLabel: 'GLM 5',
    maxTokens: 4096,
    temperature: 0.6,
    reasoningEffort: 'none',
    responseFormat: { type: 'json_object' },
  })
}

async function generateKimiDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateFireworksDecision({
    model: KIMI_MODEL,
    input,
    errorLabel: 'Kimi K2.5',
    maxTokens: 4096,
    temperature: 0.6,
    responseFormat: { type: 'json_object' },
  })
}

async function generateMiniMaxDecision(input: ModelDecisionInput): Promise<ModelDecisionGeneration> {
  return generateFireworksDecision({
    model: MINIMAX_MODEL,
    input,
    errorLabel: 'MiniMax M2.5',
    maxTokens: 4096,
    temperature: 0.7,
    reasoningEffort: 'low',
    responseFormat: { type: 'json_object' },
  })
}

export function getModelDecisionGeneratorDisabledReason(
  modelId: ModelId,
  options: ModelDecisionGeneratorOptions = {},
): string {
  if (modelId === 'claude-opus' && options.claudeProvider === 'web') {
    return 'claude-opus web generator is only supported in local development'
  }

  return `${modelId} generator is disabled because its API key is not configured`
}

export const MODEL_DECISION_GENERATORS: Record<ModelId, ModelDecisionGeneratorConfig> = {
  'claude-opus': {
    generator: generateClaudeDecision,
    enabled: (options) => options?.claudeProvider === 'web'
      ? process.env.NODE_ENV !== 'production'
      : !!process.env.ANTHROPIC_API_KEY,
  },
  'gpt-5.2': {
    generator: generateGptDecision,
    enabled: () => !!process.env.OPENAI_API_KEY,
  },
  'grok-4': {
    generator: generateGrokDecision,
    enabled: () => !!process.env.XAI_API_KEY,
  },
  'gemini-3-pro': {
    generator: generateGemini3Decision,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'deepseek-v3.2': {
    generator: generateDeepSeekDecision,
    enabled: () => !!process.env.FIREWORKS_API_KEY,
  },
  'glm-5': {
    generator: generateGlm5Decision,
    enabled: () => !!process.env.FIREWORKS_API_KEY,
  },
  'llama-4': {
    generator: generateLlama4Decision,
    enabled: () => !!process.env.GROQ_API_KEY,
  },
  'kimi-k2.5': {
    generator: generateKimiDecision,
    enabled: () => !!process.env.FIREWORKS_API_KEY,
  },
  'minimax-m2.5': {
    generator: generateMiniMaxDecision,
    enabled: () => !!process.env.FIREWORKS_API_KEY,
  },
}
