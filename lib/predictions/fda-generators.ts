import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { buildFDAPredictionPrompt, parseFDAPredictionResponse, type FDAPredictionResult } from './fda-prompt'
import type { ModelId } from '@/lib/constants'

const CLAUDE_MODEL = 'claude-opus-4-6'
const GPT_MODEL = 'gpt-5.2'
const GROK_MODEL = 'grok-4-1-fast-reasoning'
const GEMINI_25_MODEL = 'gemini-2.5-pro'
const GEMINI_3_MODEL = 'gemini-3-pro-preview'
const BASETEN_BASE_URL = 'https://inference.baseten.co/v1'
const DEEPSEEK_MODEL = 'deepseek-ai/DeepSeek-V3.1'
const LLAMA_4_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const KIMI_MODEL = 'moonshotai/Kimi-K2-Thinking'
const MINIMAX_MODEL = 'MiniMax-M2.5'
const CLAUDE_MAX_OUTPUT_TOKENS = 4_096
const CLAUDE_WEB_SEARCH_MAX_USES = 7

interface FDAEventInfo {
  drugName: string
  companyName: string
  applicationType: string
  therapeuticArea: string | null
  eventDescription: string
  drugStatus: string | null
  rivalDrugs: string | null
  marketPotential: string | null
  otherApprovals: string | null
  source: string | null
}

function extractTextFromOpenAIResponse(response: any): string {
  const fromOutputText = typeof response?.output_text === 'string' ? response.output_text.trim() : ''
  if (fromOutputText.length > 0) {
    return fromOutputText
  }

  const output = Array.isArray(response?.output) ? response.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (item?.type !== 'message') continue
    const content = Array.isArray(item?.content) ? item.content : []
    for (const part of content) {
      if ((part?.type === 'output_text' || part?.type === 'text') && typeof part?.text === 'string') {
        const text = part.text.trim()
        if (text.length > 0) {
          chunks.push(text)
        }
      }
    }
  }

  return chunks.join('\n').trim()
}

function extractTextFromChatCompletion(completion: any): string {
  const text = completion?.choices?.[0]?.message?.content
  if (typeof text === 'string') {
    return text.trim()
  }

  if (Array.isArray(text)) {
    const joined = text
      .map((part) => {
        if (typeof part?.text === 'string') return part.text
        if (typeof part === 'string') return part
        return ''
      })
      .join('\n')
      .trim()
    if (joined.length > 0) {
      return joined
    }
  }

  return ''
}

// Claude prediction with reasoning + limited web search
export async function generateClaudeFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const prompt = buildFDAPredictionPrompt(event)

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: CLAUDE_WEB_SEARCH_MAX_USES }],
  } as any)

  // Extract text from response (may include thinking blocks)
  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Claude Opus 4.6 response')
  }

  return parseFDAPredictionResponse(textContent.text)
}

// GPT-5.2 Deep Research prediction with agentic web search
export async function generateOpenAIFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const prompt = buildFDAPredictionPrompt(event)

  const requestOptions: any = {
    model: GPT_MODEL,
    input: prompt,
    max_output_tokens: 16_000,
    reasoning: {
      effort: 'high',
    },
    tools: [{ type: 'web_search' }],
  }

  const response = await client.responses.create(requestOptions)
  const content = extractTextFromOpenAIResponse(response)

  if (!content) {
    throw new Error('No content in GPT-5.2 response')
  }

  return parseFDAPredictionResponse(content)
}

// Grok 4.1 prediction (via xAI) with fast reasoning + live search
export async function generateGrokFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  })

  const prompt = buildFDAPredictionPrompt(event)

  const completion = await client.chat.completions.create({
    model: GROK_MODEL,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: 16_000,
    search_mode: 'auto',
  } as any)

  const content = extractTextFromChatCompletion(completion)
  if (!content) {
    throw new Error('No content in Grok 4.1 response')
  }

  return parseFDAPredictionResponse(content)
}

// Gemini prediction with Google Search grounding + thinking
async function generateGeminiFDAPrediction(event: FDAEventInfo, model: string): Promise<FDAPredictionResult> {
  const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY,
  })

  const prompt = buildFDAPredictionPrompt(event)

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: 65_536,
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

  return parseFDAPredictionResponse(content)
}

export async function generateGemini25FDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  return generateGeminiFDAPrediction(event, GEMINI_25_MODEL)
}

export async function generateGemini3FDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  return generateGeminiFDAPrediction(event, GEMINI_3_MODEL)
}

async function generateOpenAICompatibleFDAPrediction(args: {
  apiKey: string | undefined
  baseURL: string
  model: string
  event: FDAEventInfo
  errorLabel: string
  maxTokens?: number
  temperature?: number
  extraBody?: Record<string, unknown>
}): Promise<FDAPredictionResult> {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
  })

  const prompt = buildFDAPredictionPrompt(args.event)

  const completionRequest: any = {
    model: args.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: args.maxTokens ?? 16_000,
    temperature: args.temperature ?? 0.7,
  }

  if (args.extraBody && Object.keys(args.extraBody).length > 0) {
    completionRequest.extra_body = args.extraBody
  }

  const completion = await client.chat.completions.create(completionRequest)

  const content = extractTextFromChatCompletion(completion)
  if (!content) {
    throw new Error(`No content in ${args.errorLabel} response`)
  }

  return parseFDAPredictionResponse(content)
}

export async function generateDeepSeekFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  return generateOpenAICompatibleFDAPrediction({
    apiKey: process.env.BASETEN_DEEPSEEK_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: DEEPSEEK_MODEL,
    event,
    errorLabel: 'DeepSeek V3.1',
    maxTokens: 16_000,
    temperature: 0.6,
    extraBody: { reasoning_effort: 'high' },
  })
}

export async function generateLlama4FDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  return generateOpenAICompatibleFDAPrediction({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: LLAMA_4_MODEL,
    event,
    errorLabel: 'Llama 4 Scout',
    maxTokens: 8_192,
    temperature: 0.4,
  })
}

export async function generateKimiK2FDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  return generateOpenAICompatibleFDAPrediction({
    apiKey: process.env.BASETEN_KIMI_API_KEY,
    baseURL: BASETEN_BASE_URL,
    model: KIMI_MODEL,
    event,
    errorLabel: 'Kimi K2 Thinking',
    maxTokens: 16_000,
    temperature: 1.0,
    extraBody: { reasoning_effort: 'high' },
  })
}

export async function generateMiniMaxFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  return generateOpenAICompatibleFDAPrediction({
    apiKey: process.env.MINIMAX_API_KEY,
    baseURL: 'https://api.minimax.io/v1',
    model: MINIMAX_MODEL,
    event,
    errorLabel: 'MiniMax M2.5',
    maxTokens: 16_000,
    temperature: 0.7,
  })
}

// Generate meta-analysis comparing all model predictions
interface PredictionSummary {
  modelId: string
  modelName: string
  prediction: string
  confidence: number
  reasoning: string
}

export async function generateMetaAnalysis(
  event: FDAEventInfo,
  predictions: PredictionSummary[]
): Promise<string> {
  // Need at least 2 predictions to compare
  if (predictions.length < 2) {
    return ''
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const predictionsText = predictions
    .map((p) => `### ${p.modelName}\n**Prediction:** ${p.prediction.toUpperCase()} (${p.confidence}% confidence)\n**Reasoning:** ${p.reasoning}`)
    .join('\n\n')

  const prompt = `You are analyzing FDA drug approval predictions from multiple AI models. Compare their reasoning approaches and identify key differences.

## Drug Information
- **Drug:** ${event.drugName}
- **Company:** ${event.companyName}
- **Application Type:** ${event.applicationType}
- **Therapeutic Area:** ${event.therapeuticArea || 'Not specified'}

## Model Predictions
${predictionsText}

## Your Task
Write a concise meta-analysis (2-3 paragraphs) that:
1. Identifies the key factors each model emphasized differently
2. Explains why models may have reached different conclusions (if they disagree)
3. Highlights any blind spots or unique insights from specific models
4. Notes the confidence spread and what it suggests about prediction difficulty

Be specific and reference actual reasoning from each model. Focus on analytical differences, not just restating predictions. Keep it under 300 words.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in meta-analysis response')
  }

  return textContent.text
}

type GeneratorConfig = {
  generator: (event: FDAEventInfo) => Promise<FDAPredictionResult>
  enabled: () => boolean
}

// Map model IDs to generators
export const FDA_GENERATORS: Record<ModelId, GeneratorConfig> = {
  'claude-opus': {
    generator: generateClaudeFDAPrediction,
    enabled: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'gpt-5.2': {
    generator: generateOpenAIFDAPrediction,
    enabled: () => !!process.env.OPENAI_API_KEY,
  },
  'grok-4': {
    generator: generateGrokFDAPrediction,
    enabled: () => !!process.env.XAI_API_KEY,
  },
  'gemini-2.5': {
    generator: generateGemini25FDAPrediction,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'gemini-3-pro': {
    generator: generateGemini3FDAPrediction,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
  'deepseek-v3.2': {
    generator: generateDeepSeekFDAPrediction,
    enabled: () => !!process.env.BASETEN_DEEPSEEK_API_KEY,
  },
  'llama-4': {
    generator: generateLlama4FDAPrediction,
    enabled: () => !!process.env.GROQ_API_KEY,
  },
  'kimi-k2': {
    generator: generateKimiK2FDAPrediction,
    enabled: () => !!process.env.BASETEN_KIMI_API_KEY,
  },
  'minimax-m2.5': {
    generator: generateMiniMaxFDAPrediction,
    enabled: () => !!process.env.MINIMAX_API_KEY,
  },
}
