import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { buildMarketDecisionPrompt, parseMarketDecisionResponse, type MarketDecisionInput, type MarketDecisionResult } from './market-prompt'
import type { ModelId } from '@/lib/constants'

interface MarketGeneratorConfig {
  generator: (input: MarketDecisionInput) => Promise<MarketDecisionResult>
  enabled: () => boolean
}

const BASETEN_BASE_URL = 'https://inference.baseten.co/v1'
const DEEPSEEK_MODEL = 'deepseek-ai/DeepSeek-V3.1'
const LLAMA_4_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct'
const KIMI_MODEL = 'moonshotai/Kimi-K2-Thinking'
const MINIMAX_MODEL = 'MiniMax-M2.5'

function extractClaudeResponseText(message: any): string {
  const textBlocks = (message?.content || [])
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text.trim())
    .filter((text: string) => text.length > 0)

  if (textBlocks.length === 0) {
    return ''
  }

  // Claude with web search can emit multiple text blocks (e.g. a preamble plus final answer).
  // Prefer the last block that looks like it contains JSON, otherwise fall back to all text.
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

function extractOpenAIIncompleteReason(response: any): string {
  const details = response?.incomplete_details
  if (!details) return ''

  if (typeof details?.reason === 'string' && details.reason.trim().length > 0) {
    return details.reason.trim()
  }

  if (typeof details === 'string' && details.trim().length > 0) {
    return details.trim()
  }

  try {
    const serialized = JSON.stringify(details)
    return serialized === '{}' ? '' : serialized
  } catch {
    return ''
  }
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

async function generateClaudeMarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt = buildMarketDecisionPrompt(input)

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  } as any)

  const content = extractClaudeResponseText(message)
  if (!content) {
    throw new Error('No text content in Claude Opus 4.6 response')
  }

  return parseMarketDecisionResponse(content, input.accountCash)
}

async function generateGptMarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = buildMarketDecisionPrompt(input)

  const response = await client.responses.create({
    model: 'gpt-5.2',
    input: prompt,
    max_output_tokens: 8000,
    tools: [{ type: 'web_search' }],
    reasoning: { effort: 'medium' },
  } as any)

  const content = extractResponseText(response as any)
  if (!content) {
    const status = (response as any)?.status || 'unknown'
    const incompleteReason = extractOpenAIIncompleteReason(response as any)
    const reasonSuffix = incompleteReason ? `, reason: ${incompleteReason}` : ''
    throw new Error(`No content in GPT-5.2 response (status: ${status}${reasonSuffix})`)
  }

  return parseMarketDecisionResponse(content, input.accountCash)
}

async function generateGrokMarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  })

  const prompt = buildMarketDecisionPrompt(input)

  const completion = await client.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000,
    search_mode: 'auto',
  } as any)

  const content = extractChatCompletionText(completion)
  if (!content) {
    throw new Error('No content in Grok 4.1 response')
  }

  return parseMarketDecisionResponse(content, input.accountCash)
}

async function generateGeminiMarketDecision(input: MarketDecisionInput, model: string): Promise<MarketDecisionResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  const prompt = buildMarketDecisionPrompt(input)

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  })

  const content = response.text
  if (!content) {
    throw new Error(`No content in ${model} response`)
  }

  return parseMarketDecisionResponse(content, input.accountCash)
}

async function generateOpenAICompatibleMarketDecision(args: {
  apiKey: string | undefined
  baseURL: string
  model: string
  input: MarketDecisionInput
  errorLabel: string
  maxTokens?: number
  temperature?: number
  extraBody?: Record<string, unknown>
}): Promise<MarketDecisionResult> {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
  })

  const prompt = buildMarketDecisionPrompt(args.input)

  const completionRequest: any = {
    model: args.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: args.maxTokens ?? 8_192,
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

  return parseMarketDecisionResponse(content, args.input.accountCash)
}

async function generateGemini25MarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  return generateGeminiMarketDecision(input, 'gemini-2.5-pro')
}

async function generateGemini3MarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  return generateGeminiMarketDecision(input, 'gemini-3-pro-preview')
}

async function generateDeepSeekMarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  return generateOpenAICompatibleMarketDecision({
    apiKey: process.env.BASETEN_DEEPSEEK_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: DEEPSEEK_MODEL,
    input,
    errorLabel: 'DeepSeek V3.1',
    maxTokens: 8_192,
    temperature: 0.6,
    extraBody: { reasoning_effort: 'medium' },
  })
}

async function generateLlama4MarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  return generateOpenAICompatibleMarketDecision({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: LLAMA_4_MODEL,
    input,
    errorLabel: 'Llama 4 Maverick',
    maxTokens: 8_192,
    temperature: 0.4,
  })
}

async function generateKimiK2MarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  return generateOpenAICompatibleMarketDecision({
    apiKey: process.env.BASETEN_KIMI_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: KIMI_MODEL,
    input,
    errorLabel: 'Kimi K2 Thinking',
    maxTokens: 16_000,
    temperature: 1.0,
    extraBody: { reasoning_effort: 'medium' },
  })
}

async function generateMiniMaxMarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  return generateOpenAICompatibleMarketDecision({
    apiKey: process.env.MINIMAX_API_KEY,
    baseURL: 'https://api.minimax.io/v1',
    model: MINIMAX_MODEL,
    input,
    errorLabel: 'MiniMax M2.5',
    maxTokens: 8_192,
    temperature: 0.7,
  })
}

export const MARKET_DECISION_GENERATORS: Record<ModelId, MarketGeneratorConfig> = {
  'claude-opus': {
    generator: generateClaudeMarketDecision,
    enabled: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'gpt-5.2': {
    generator: generateGptMarketDecision,
    enabled: () => !!process.env.OPENAI_API_KEY,
  },
  'grok-4': {
    generator: generateGrokMarketDecision,
    enabled: () => !!process.env.XAI_API_KEY,
  },
  'gemini-2.5': {
    generator: generateGemini25MarketDecision,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'gemini-3-pro': {
    generator: generateGemini3MarketDecision,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'deepseek-v3.2': {
    generator: generateDeepSeekMarketDecision,
    enabled: () => !!process.env.BASETEN_DEEPSEEK_API_KEY,
  },
  'llama-4': {
    generator: generateLlama4MarketDecision,
    enabled: () => !!process.env.GROQ_API_KEY,
  },
  'kimi-k2': {
    generator: generateKimiK2MarketDecision,
    enabled: () => !!process.env.BASETEN_KIMI_API_KEY,
  },
  'minimax-m2.5': {
    generator: generateMiniMaxMarketDecision,
    enabled: () => !!process.env.MINIMAX_API_KEY,
  },
}
