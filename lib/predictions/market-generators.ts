import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { buildMarketDecisionPrompt, parseMarketDecisionResponse, type MarketDecisionInput, type MarketDecisionResult } from './market-prompt'

interface MarketGeneratorConfig {
  generator: (input: MarketDecisionInput) => Promise<MarketDecisionResult>
  enabled: () => boolean
}

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
    max_output_tokens: 4000,
    tools: [{ type: 'web_search' }],
    reasoning: { effort: 'medium' },
  } as any)

  const content = extractResponseText(response as any)
  if (!content) {
    const status = (response as any)?.status || 'unknown'
    throw new Error(`No content in GPT-5.2 response (status: ${status})`)
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

  const content = completion.choices[0]?.message?.content
  if (!content) {
    throw new Error('No content in Grok 4.1 response')
  }

  return parseMarketDecisionResponse(content, input.accountCash)
}

async function generateGeminiMarketDecision(input: MarketDecisionInput): Promise<MarketDecisionResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  const prompt = buildMarketDecisionPrompt(input)

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  })

  const content = response.text
  if (!content) {
    throw new Error('No content in Gemini 2.5 Pro response')
  }

  return parseMarketDecisionResponse(content, input.accountCash)
}

export const MARKET_DECISION_GENERATORS: Record<string, MarketGeneratorConfig> = {
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
    generator: generateGeminiMarketDecision,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
}
