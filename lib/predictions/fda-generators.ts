import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { buildFDAPredictionPrompt, parseFDAPredictionResponse, type FDAPredictionResult } from './fda-prompt'

const CLAUDE_MODEL = 'claude-opus-4-6'
const GPT_MODEL = 'gpt-5.2'
const GROK_MODEL = 'grok-4-1-fast-reasoning'
const GEMINI_MODEL = 'gemini-2.5-pro'
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

  // Use GPT-5.2 with agentic web search for deep research
  // Model actively manages search process, analyzes results, and decides whether to keep searching
  const requestOptions: any = {
    model: GPT_MODEL,
    input: prompt,
    max_output_tokens: 16000,
    reasoning: {
      effort: 'high', // Use high reasoning effort for thorough analysis
    },
  }

  requestOptions.tools = [{ type: 'web_search' }]

  const response = await client.responses.create(requestOptions)

  // Extract text from response
  const textOutput = (response as any).output?.find((o: any) => o.type === 'message') as any
  const content = textOutput?.content?.[0]?.text || (response as any).output_text

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

  // Use Grok 4.1 with fast reasoning + live web search
  const completion = await client.chat.completions.create({
    model: GROK_MODEL,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: 16000,
    search_mode: 'auto', // Enable live web search
  } as any)

  const content = completion.choices[0]?.message?.content
  if (!content) {
    throw new Error('No content in Grok 4.1 response')
  }

  return parseFDAPredictionResponse(content)
}

// Gemini 2.5 Pro prediction with Google Search grounding + thinking
export async function generateGeminiFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY,
  })

  const prompt = buildFDAPredictionPrompt(event)

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      maxOutputTokens: 65536,
      thinkingConfig: {
        thinkingBudget: -1, // -1 = automatic thinking budget
      },
      tools: [{ googleSearch: {} }],
    },
  })

  const content = response.text
  if (!content) {
    throw new Error('No content in Gemini 2.5 Pro response')
  }

  return parseFDAPredictionResponse(content)
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
    .map(p => `### ${p.modelName}
**Prediction:** ${p.prediction.toUpperCase()} (${p.confidence}% confidence)
**Reasoning:** ${p.reasoning}`)
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

// Map model IDs to generators
export const FDA_GENERATORS: Record<string, {
  generator: (event: FDAEventInfo) => Promise<FDAPredictionResult>
  enabled: () => boolean
}> = {
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
    generator: generateGeminiFDAPrediction,
    enabled: () => !!process.env.GOOGLE_API_KEY,
  },
}
