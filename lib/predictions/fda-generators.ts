import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { buildFDAPredictionPrompt, parseFDAPredictionResponse, type FDAPredictionResult } from './fda-prompt'

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
}

// Claude prediction with extended thinking (Deep Research)
export async function generateClaudeFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const prompt = buildFDAPredictionPrompt(event)

  // Use extended thinking for deep reasoning
  const message = await client.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 16000,
    thinking: {
      type: 'enabled',
      budget_tokens: 10000, // Allow deep reasoning
    },
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  // Extract text from response (may include thinking blocks)
  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Claude response')
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
  const response = await client.responses.create({
    model: 'gpt-5.2',
    input: prompt,
    tools: [
      { type: 'web_search' },
    ],
    reasoning: {
      effort: 'high', // Use high reasoning effort for thorough analysis
    },
  } as any) // Type assertion for newer API features

  // Extract text from response
  const textOutput = response.output?.find((o: any) => o.type === 'message') as any
  const content = textOutput?.content?.[0]?.text || (response as any).output_text

  if (!content) {
    throw new Error('No content in GPT-5.2 response')
  }

  return parseFDAPredictionResponse(content)
}

// Grok 4 prediction (via xAI) with live web search
export async function generateGrokFDAPrediction(event: FDAEventInfo): Promise<FDAPredictionResult> {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  })

  const prompt = buildFDAPredictionPrompt(event)

  // Use Grok 4 with live web search enabled
  const completion = await client.chat.completions.create({
    model: 'grok-4',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: 4096,
    search_mode: 'auto', // Enable live web search
  } as any)

  const content = completion.choices[0]?.message?.content
  if (!content) {
    throw new Error('No content in Grok response')
  }

  return parseFDAPredictionResponse(content)
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
}
