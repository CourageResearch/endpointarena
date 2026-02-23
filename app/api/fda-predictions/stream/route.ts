import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { MODEL_IDS, type ModelId } from '@/lib/constants'
import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { buildFDAPredictionPrompt, parseFDAPredictionResponse } from '@/lib/predictions/fda-prompt'
import {
  estimateCostFromTokenUsage,
  estimateTextGenerationCost,
  getCostEstimationProfileForModel,
  type AICostSource,
} from '@/lib/ai-costs'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ConfigurationError, NotFoundError, ValidationError } from '@/lib/errors'

const CLAUDE_MODEL = 'claude-opus-4-6'
const GPT_MODEL = 'gpt-5.2'
const GROK_MODEL = 'grok-4-1-fast-reasoning'
const GEMINI_MODEL = 'gemini-2.5-pro'

type StreamRequestBody = {
  fdaEventId?: string
  modelId?: ModelId
  useReasoning?: boolean
}

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

type ProviderTokenUsage = {
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

type PersistedRunUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens: number | null
  estimatedCostUsd: number
  costSource: AICostSource
  cacheCreationInputTokens5m: number | null
  cacheCreationInputTokens1h: number | null
  cacheReadInputTokens: number | null
  webSearchRequests: number | null
  inferenceGeo: string | null
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.round(value))
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function extractWebSearchRequestCount(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const usageRecord = usage as Record<string, unknown>
  const directCandidates = [
    usageRecord.webSearchRequests,
    usageRecord.web_search_requests,
    usageRecord.webSearchCalls,
    usageRecord.web_search_calls,
    usageRecord.searchCalls,
    usageRecord.search_calls,
    usageRecord.searchCount,
    usageRecord.search_count,
    usageRecord.toolCallCount,
    usageRecord.tool_call_count,
  ]

  for (const candidate of directCandidates) {
    const numeric = toNonNegativeInt(candidate)
    if (numeric != null) {
      return numeric
    }
  }

  const toolCalls = usageRecord.toolCalls ?? usageRecord.tool_calls
  if (Array.isArray(toolCalls)) {
    return toNonNegativeInt(toolCalls.length)
  }

  return null
}

function extractGeminiGroundedPromptCount(groundingMetadata: unknown): number | null {
  if (!groundingMetadata || typeof groundingMetadata !== 'object') {
    return null
  }

  const metadata = groundingMetadata as Record<string, unknown>
  const webSearchQueries = Array.isArray(metadata.webSearchQueries) ? metadata.webSearchQueries.length : 0
  const retrievalQueries = Array.isArray(metadata.retrievalQueries) ? metadata.retrievalQueries.length : 0
  const groundingChunks = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks.length : 0
  const hasSearchEntryPoint = metadata.searchEntryPoint != null

  if (webSearchQueries > 0 || retrievalQueries > 0 || groundingChunks > 0 || hasSearchEntryPoint) {
    return 1
  }

  return 0
}

function resolveUsageForStorage(args: {
  modelId: ModelId
  promptText: string
  responseText: string
  providerUsage: ProviderTokenUsage | null
}): PersistedRunUsage {
  const providerInput = toNonNegativeInt(args.providerUsage?.inputTokens ?? null)
  const providerOutput = toNonNegativeInt(args.providerUsage?.outputTokens ?? null)
  const providerTotal = toNonNegativeInt(args.providerUsage?.totalTokens ?? null)
  const providerReasoning = toNonNegativeInt(args.providerUsage?.reasoningTokens ?? null)
  const providerCacheCreation5m = toNonNegativeInt(args.providerUsage?.cacheCreationInputTokens5m ?? null)
  const providerCacheCreation1h = toNonNegativeInt(args.providerUsage?.cacheCreationInputTokens1h ?? null)
  const providerCacheRead = toNonNegativeInt(args.providerUsage?.cacheReadInputTokens ?? null)
  const providerWebSearchRequests = toNonNegativeInt(args.providerUsage?.webSearchRequests ?? null)
  const providerInferenceGeo = toNullableString(args.providerUsage?.inferenceGeo ?? null)

  if (providerInput != null && providerOutput != null) {
    return {
      inputTokens: providerInput,
      outputTokens: providerOutput,
      totalTokens: providerTotal ?? (providerInput + providerOutput),
      reasoningTokens: providerReasoning,
      estimatedCostUsd: estimateCostFromTokenUsage({
        modelId: args.modelId,
        inputTokens: providerInput,
        outputTokens: providerOutput,
        cacheCreationInputTokens5m: providerCacheCreation5m,
        cacheCreationInputTokens1h: providerCacheCreation1h,
        cacheReadInputTokens: providerCacheRead,
        webSearchRequests: providerWebSearchRequests,
        inferenceGeo: providerInferenceGeo,
      }),
      costSource: 'provider',
      cacheCreationInputTokens5m: providerCacheCreation5m,
      cacheCreationInputTokens1h: providerCacheCreation1h,
      cacheReadInputTokens: providerCacheRead,
      webSearchRequests: providerWebSearchRequests,
      inferenceGeo: providerInferenceGeo,
    }
  }

  const estimated = estimateTextGenerationCost({
    modelId: args.modelId,
    promptText: args.promptText,
    responseText: args.responseText,
    profile: getCostEstimationProfileForModel(args.modelId),
  })

  return {
    inputTokens: estimated.inputTokens,
    outputTokens: estimated.outputTokens,
    totalTokens: estimated.inputTokens + estimated.outputTokens,
    reasoningTokens: null,
    estimatedCostUsd: estimated.estimatedCostUsd,
    costSource: 'estimated',
    cacheCreationInputTokens5m: null,
    cacheCreationInputTokens1h: null,
    cacheReadInputTokens: null,
    webSearchRequests: estimated.webSearchRequests,
    inferenceGeo: null,
  }
}

function assertProviderConfigured(modelId: ModelId): void {
  if (modelId === 'claude-opus' && !process.env.ANTHROPIC_API_KEY) {
    throw new ConfigurationError('ANTHROPIC_API_KEY is not configured')
  }
  if (modelId === 'gpt-5.2' && !process.env.OPENAI_API_KEY) {
    throw new ConfigurationError('OPENAI_API_KEY is not configured')
  }
  if (modelId === 'grok-4' && !process.env.XAI_API_KEY) {
    throw new ConfigurationError('XAI_API_KEY is not configured')
  }
  if (modelId === 'gemini-2.5' && !process.env.GOOGLE_API_KEY) {
    throw new ConfigurationError('GOOGLE_API_KEY is not configured')
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<StreamRequestBody>(request)
    const fdaEventId = typeof body.fdaEventId === 'string' ? body.fdaEventId : ''
    const modelId = body.modelId
    const useReasoning = body.useReasoning ?? true

    if (!fdaEventId || !modelId) {
      throw new ValidationError('fdaEventId and modelId are required')
    }

    if (!MODEL_ID_SET.has(modelId)) {
      throw new ValidationError(`Unknown modelId: ${modelId}`)
    }

    assertProviderConfigured(modelId)

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, fdaEventId),
    })

    if (!event) {
      throw new NotFoundError('FDA event not found')
    }

    const existing = await db.query.fdaPredictions.findFirst({
      where: and(
        eq(fdaPredictions.fdaEventId, fdaEventId),
        eq(fdaPredictions.predictorType, 'model'),
        eq(fdaPredictions.predictorId, modelId)
      ),
    })

    if (existing) {
      return successResponse({ status: 'exists', prediction: existing }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const prompt = buildFDAPredictionPrompt({
      drugName: event.drugName,
      companyName: event.companyName,
      applicationType: event.applicationType,
      therapeuticArea: event.therapeuticArea,
      eventDescription: event.eventDescription,
      drugStatus: event.drugStatus,
      rivalDrugs: event.rivalDrugs,
      marketPotential: event.marketPotential,
      otherApprovals: event.otherApprovals,
      source: event.source,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        const startedAt = Date.now()
        let fullResponse = ''
        let providerUsage: ProviderTokenUsage | null = null

        try {
          if (modelId === 'claude-opus') {
            await streamClaude(
              prompt,
              send,
              (text) => { fullResponse = text },
              (usage) => { providerUsage = usage },
              useReasoning
            )
          } else if (modelId === 'gpt-5.2') {
            await streamGPT(
              prompt,
              send,
              (text) => { fullResponse = text },
              (usage) => { providerUsage = usage },
              useReasoning
            )
          } else if (modelId === 'grok-4') {
            await streamGrok(
              prompt,
              send,
              (text) => { fullResponse = text },
              (usage) => { providerUsage = usage },
              useReasoning
            )
          } else {
            await streamGemini(
              prompt,
              send,
              (text) => { fullResponse = text },
              (usage) => { providerUsage = usage },
              useReasoning
            )
          }

          const parsed = parseFDAPredictionResponse(fullResponse)
          const durationMs = Date.now() - startedAt
          const usageForStorage = resolveUsageForStorage({
            modelId,
            promptText: prompt,
            responseText: parsed.reasoning,
            providerUsage,
          })

          const isDecided = event.outcome === 'Approved' || event.outcome === 'Rejected'
          const correct = isDecided
            ? (parsed.prediction === 'approved' && event.outcome === 'Approved') ||
              (parsed.prediction === 'rejected' && event.outcome === 'Rejected')
            : null

          const [saved] = await db.insert(fdaPredictions).values({
            fdaEventId,
            predictorType: 'model',
            predictorId: modelId,
            prediction: parsed.prediction,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            durationMs,
            inputTokens: usageForStorage.inputTokens,
            outputTokens: usageForStorage.outputTokens,
            totalTokens: usageForStorage.totalTokens,
            reasoningTokens: usageForStorage.reasoningTokens,
            estimatedCostUsd: usageForStorage.estimatedCostUsd,
            costSource: usageForStorage.costSource,
            cacheCreationInputTokens5m: usageForStorage.cacheCreationInputTokens5m,
            cacheCreationInputTokens1h: usageForStorage.cacheCreationInputTokens1h,
            cacheReadInputTokens: usageForStorage.cacheReadInputTokens,
            webSearchRequests: usageForStorage.webSearchRequests,
            inferenceGeo: usageForStorage.inferenceGeo,
            correct,
          }).returning()

          send({
            type: 'complete',
            prediction: saved,
            durationMs,
            estimatedCostUsd: usageForStorage.estimatedCostUsd,
            costSource: usageForStorage.costSource,
          })
        } catch (error) {
          const durationMs = Date.now() - startedAt
          const message = error instanceof Error ? error.message : 'Unknown error'
          send({
            type: 'error',
            error: `${message} (request ${requestId})`,
            durationMs,
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to start streaming prediction')
  }
}

async function streamClaude(
  prompt: string,
  send: (data: Record<string, unknown>) => void,
  setFinalText: (text: string) => void,
  setUsage: (usage: ProviderTokenUsage | null) => void,
  useReasoning: boolean
) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  send({ type: 'status', status: useReasoning ? 'Starting Claude Opus 4.6 with deep reasoning...' : 'Starting Claude Opus 4.6...' })

  const requestOptions: any = {
    model: CLAUDE_MODEL,
    max_tokens: useReasoning ? 16_000 : 4_096,
    messages: [{ role: 'user', content: prompt }],
  }

  if (useReasoning) {
    requestOptions.thinking = { type: 'enabled', budget_tokens: 10_000 }
    requestOptions.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  const stream = client.messages.stream(requestOptions)
  let thinkingText = ''
  let responseText = ''
  let lastThinkingUpdate = Date.now()

  ;(stream as any).on('contentBlockDelta', (event: any) => {
    const delta = event.delta
    if (delta?.type === 'thinking_delta') {
      thinkingText += delta.thinking || ''
      if (Date.now() - lastThinkingUpdate > 500) {
        send({
          type: 'thinking',
          thinking: thinkingText.slice(-200),
          thinkingTokens: thinkingText.length,
        })
        lastThinkingUpdate = Date.now()
      }
    } else if (delta?.type === 'text_delta') {
      responseText += delta.text || ''
      send({ type: 'text', text: responseText.slice(-100) })
    }
  })

  ;(stream as any).on('contentBlockStart', (event: any) => {
    const block = event.contentBlock
    if (block?.type === 'thinking') {
      send({ type: 'status', status: 'Claude deep reasoning in progress...' })
    } else if (block?.type === 'server_tool_use' && block?.name === 'web_search') {
      send({ type: 'status', status: 'Claude searching the web...' })
    } else if (block?.type === 'text') {
      send({ type: 'status', status: 'Claude generating response...' })
    }
  })

  const finalMessage = await stream.finalMessage()
  let extractedText = ''
  for (const block of finalMessage.content || []) {
    if (block.type === 'text') {
      extractedText += block.text
    }
  }

  if (!responseText && extractedText) {
    responseText = extractedText
  }

  if (!responseText) {
    throw new Error(`Claude returned empty response. stop_reason: ${finalMessage.stop_reason}`)
  }

  const usage = (finalMessage as any).usage
  const baseInputTokens = toNonNegativeInt(usage?.input_tokens)
  const cacheCreationInputTokens5m = toNonNegativeInt(usage?.cache_creation?.ephemeral_5m_input_tokens)
  const cacheCreationInputTokens1h = toNonNegativeInt(usage?.cache_creation?.ephemeral_1h_input_tokens)
  const cacheCreationInputTokens = toNonNegativeInt(usage?.cache_creation_input_tokens)
  const cacheReadInputTokens = toNonNegativeInt(usage?.cache_read_input_tokens) ?? 0
  const effectiveCacheCreation5m =
    cacheCreationInputTokens5m ??
    (cacheCreationInputTokens != null && cacheCreationInputTokens1h == null ? cacheCreationInputTokens : 0)
  const effectiveCacheCreation1h = cacheCreationInputTokens1h ?? 0
  const cacheCreationTotalInputTokens = effectiveCacheCreation5m + effectiveCacheCreation1h
  const webSearchRequests = toNonNegativeInt(usage?.server_tool_use?.web_search_requests)
  const inferenceGeo = toNullableString(usage?.inference_geo)
  const outputTokens = toNonNegativeInt(usage?.output_tokens)
  const inputTokens = baseInputTokens == null
    ? null
    : baseInputTokens + cacheCreationTotalInputTokens + cacheReadInputTokens
  setUsage({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null,
    reasoningTokens: null,
    cacheCreationInputTokens5m: effectiveCacheCreation5m,
    cacheCreationInputTokens1h: effectiveCacheCreation1h,
    cacheReadInputTokens,
    webSearchRequests,
    inferenceGeo,
  })

  setFinalText(responseText)
}

async function streamGPT(
  prompt: string,
  send: (data: Record<string, unknown>) => void,
  setFinalText: (text: string) => void,
  setUsage: (usage: ProviderTokenUsage | null) => void,
  useReasoning: boolean
) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  send({ type: 'status', status: useReasoning ? 'Starting GPT-5.2 with high reasoning effort...' : 'Starting GPT-5.2...' })

  const requestOptions: any = {
    model: GPT_MODEL,
    input: prompt,
    stream: true,
    max_output_tokens: useReasoning ? 16_000 : 4_096,
    reasoning: { effort: useReasoning ? 'high' : 'low' },
  }

  if (useReasoning) {
    requestOptions.tools = [{ type: 'web_search' }]
  }

  const response = await (client as any).responses.create(requestOptions)

  let responseText = ''
  let reasoningTokens = 0
  let eventCount = 0
  const eventTypes: string[] = []
  let finalUsage: any = null
  const webSearchCallIds = new Set<string>()

  for await (const event of response) {
    eventCount += 1
    if (!eventTypes.includes(event.type)) {
      eventTypes.push(event.type)
    }

    if (event.response?.usage) {
      finalUsage = event.response.usage
    }

    if (event.type === 'response.reasoning.delta') {
      reasoningTokens += 1
      if (reasoningTokens % 50 === 0) {
        send({ type: 'thinking', thinkingTokens: reasoningTokens, thinking: 'Reasoning...' })
      }
    } else if (event.type === 'response.output.delta') {
      responseText += event.delta?.text || ''
      send({ type: 'text', text: responseText.slice(-100) })
    } else if (event.type === 'response.output_text.delta') {
      responseText += event.delta || ''
      send({ type: 'text', text: responseText.slice(-100) })
    } else if (event.type === 'response.content_part.delta') {
      responseText += event.delta?.text || event.text || ''
      send({ type: 'text', text: responseText.slice(-100) })
    } else if (event.type === 'response.web_search_call.searching') {
      send({ type: 'status', status: 'GPT-5.2 searching the web...' })
    } else if (event.type === 'response.web_search_call.in_progress') {
      send({ type: 'status', status: 'GPT-5.2 reviewing search results...' })
    } else if (event.type === 'response.web_search_call.completed') {
      const callId = toNullableString((event as any).item_id) ?? `seq-${event.output_index}-${event.sequence_number}`
      webSearchCallIds.add(callId)
      send({ type: 'status', status: 'GPT-5.2 search complete, synthesizing answer...' })
    } else if (event.type === 'response.created') {
      send({ type: 'status', status: 'GPT-5.2 is analyzing...' })
    } else if (event.type === 'response.completed' || event.type === 'response.done') {
      if (event.response?.output) {
        for (const [outputIndex, output] of event.response.output.entries()) {
          if (output.type === 'web_search_call') {
            const callId = toNullableString((output as any).id) ?? `output-${outputIndex}`
            webSearchCallIds.add(callId)
          }
          if (output.type === 'message' && output.content) {
            for (const content of output.content) {
              if (content.type === 'output_text' || content.type === 'text') {
                responseText += content.text || ''
              }
            }
          }
        }
      }
    }
  }

  if (!responseText) {
    throw new Error(`GPT-5.2 returned empty response. Events: ${eventCount}, Types: ${eventTypes.join(', ')}`)
  }

  setUsage({
    inputTokens: toNonNegativeInt(finalUsage?.input_tokens),
    outputTokens: toNonNegativeInt(finalUsage?.output_tokens),
    totalTokens: toNonNegativeInt(finalUsage?.total_tokens),
    reasoningTokens: toNonNegativeInt(finalUsage?.output_tokens_details?.reasoning_tokens) ?? toNonNegativeInt(reasoningTokens),
    cacheCreationInputTokens5m: null,
    cacheCreationInputTokens1h: null,
    cacheReadInputTokens: toNonNegativeInt(finalUsage?.input_tokens_details?.cached_tokens),
    webSearchRequests: toNonNegativeInt(webSearchCallIds.size),
    inferenceGeo: null,
  })
  setFinalText(responseText)
}

async function streamGrok(
  prompt: string,
  send: (data: Record<string, unknown>) => void,
  setFinalText: (text: string) => void,
  setUsage: (usage: ProviderTokenUsage | null) => void,
  useReasoning: boolean
) {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  })

  send({ type: 'status', status: useReasoning ? 'Starting Grok 4.1 with reasoning + search...' : 'Starting Grok 4.1...' })

  const requestOptions: any = {
    model: GROK_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: useReasoning ? 16_000 : 4_096,
    stream: true,
    stream_options: { include_usage: true },
  }

  if (useReasoning) {
    requestOptions.search_mode = 'auto'
  }

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  try {
    stream = await client.chat.completions.create(requestOptions as any) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  } catch {
    // Some OpenAI-compatible providers may not support include_usage on streamed chunks.
    delete requestOptions.stream_options
    stream = await client.chat.completions.create(requestOptions as any) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  }
  let responseText = ''
  let finalUsage: any = null

  for await (const chunk of stream) {
    if ((chunk as any).usage) {
      finalUsage = (chunk as any).usage
    }

    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      responseText += delta
      if (responseText.length % 50 === 0 || delta.includes('.')) {
        send({ type: 'text', text: responseText.slice(-100) })
      }
    }
  }

  send({ type: 'text', text: responseText.slice(-100) })

  if (!responseText) {
    throw new Error('Grok 4.1 returned empty response')
  }

  setUsage({
    inputTokens: toNonNegativeInt(finalUsage?.prompt_tokens ?? finalUsage?.input_tokens),
    outputTokens: toNonNegativeInt(finalUsage?.completion_tokens ?? finalUsage?.output_tokens),
    totalTokens: toNonNegativeInt(finalUsage?.total_tokens),
    reasoningTokens: toNonNegativeInt(finalUsage?.completion_tokens_details?.reasoning_tokens),
    cacheCreationInputTokens5m: null,
    cacheCreationInputTokens1h: null,
    cacheReadInputTokens: toNonNegativeInt(
      finalUsage?.prompt_tokens_details?.cached_tokens ?? finalUsage?.input_tokens_details?.cached_tokens
    ),
    webSearchRequests: extractWebSearchRequestCount(finalUsage),
    inferenceGeo: null,
  })
  setFinalText(responseText)
}

async function streamGemini(
  prompt: string,
  send: (data: Record<string, unknown>) => void,
  setFinalText: (text: string) => void,
  setUsage: (usage: ProviderTokenUsage | null) => void,
  useReasoning: boolean
) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY,
  })

  send({ type: 'status', status: useReasoning ? 'Starting Gemini 2.5 Pro with search grounding...' : 'Starting Gemini 2.5 Pro...' })

  const response = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      maxOutputTokens: useReasoning ? 65_536 : 8_192,
      thinkingConfig: {
        thinkingBudget: useReasoning ? -1 : 0,
      },
      tools: useReasoning ? [{ googleSearch: {} }] : undefined,
    },
  })

  let responseText = ''
  let latestUsageMetadata: any = null
  let latestGroundingMetadata: any = null

  for await (const chunk of response) {
    if ((chunk as any).usageMetadata) {
      latestUsageMetadata = (chunk as any).usageMetadata
    }
    const chunkGroundingMetadata = (chunk as any).candidates?.[0]?.groundingMetadata
    if (chunkGroundingMetadata) {
      latestGroundingMetadata = chunkGroundingMetadata
    }

    const text = chunk.text
    if (text) {
      responseText += text
      if (responseText.length % 50 === 0 || text.includes('.')) {
        send({ type: 'text', text: responseText.slice(-100) })
      }
    }
  }

  send({ type: 'text', text: responseText.slice(-100) })

  if (!responseText) {
    throw new Error('Gemini 2.5 Pro returned empty response')
  }

  const hasUsage = latestUsageMetadata != null
  const inputTokens = hasUsage
    ? toNonNegativeInt(
      (latestUsageMetadata?.promptTokenCount ?? 0) +
      (latestUsageMetadata?.toolUsePromptTokenCount ?? 0)
    )
    : null
  const outputTokens = hasUsage
    ? toNonNegativeInt(
      (latestUsageMetadata?.candidatesTokenCount ?? 0) +
      (latestUsageMetadata?.thoughtsTokenCount ?? 0)
    )
    : null
  const webSearchRequests = extractGeminiGroundedPromptCount(latestGroundingMetadata)
  setUsage({
    inputTokens,
    outputTokens,
    totalTokens: hasUsage ? toNonNegativeInt(latestUsageMetadata?.totalTokenCount) : null,
    reasoningTokens: hasUsage ? toNonNegativeInt(latestUsageMetadata?.thoughtsTokenCount) : null,
    cacheCreationInputTokens5m: null,
    cacheCreationInputTokens1h: null,
    cacheReadInputTokens: null,
    webSearchRequests,
    inferenceGeo: null,
  })
  setFinalText(responseText)
}
