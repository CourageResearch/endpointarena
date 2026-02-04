import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { buildFDAPredictionPrompt, parseFDAPredictionResponse } from '@/lib/predictions/fda-prompt'

// Streaming prediction generator with progress events
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { fdaEventId, modelId, useReasoning = true } = body

  if (!fdaEventId || !modelId) {
    return new Response(JSON.stringify({ error: 'fdaEventId and modelId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get the FDA event
  const event = await db.query.fdaCalendarEvents.findFirst({
    where: eq(fdaCalendarEvents.id, fdaEventId),
  })

  if (!event) {
    return new Response(JSON.stringify({ error: 'FDA event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if prediction already exists
  const existing = await db.query.fdaPredictions.findFirst({
    where: and(
      eq(fdaPredictions.fdaEventId, fdaEventId),
      eq(fdaPredictions.predictorType, 'model'),
      eq(fdaPredictions.predictorId, modelId)
    ),
  })

  if (existing) {
    return new Response(JSON.stringify({ status: 'exists', prediction: existing }), {
      headers: { 'Content-Type': 'application/json' },
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
  })

  // Create a streaming response
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const startTime = Date.now()
      let fullResponse = ''

      try {
        if (modelId === 'claude-opus') {
          await streamClaude(prompt, send, (text) => { fullResponse = text }, useReasoning)
        } else if (modelId === 'gpt-5.2') {
          await streamGPT(prompt, send, (text) => { fullResponse = text }, useReasoning)
        } else if (modelId === 'grok-4') {
          await streamGrok(prompt, send, (text) => { fullResponse = text }, useReasoning)
        } else {
          throw new Error(`Unknown model: ${modelId}`)
        }

        // Parse the final response
        const parsed = parseFDAPredictionResponse(fullResponse)
        const durationMs = Date.now() - startTime

        // Save to database
        const [saved] = await db.insert(fdaPredictions).values({
          fdaEventId,
          predictorType: 'model',
          predictorId: modelId,
          prediction: parsed.prediction,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
          durationMs,
        }).returning()

        send({ type: 'complete', prediction: saved, durationMs })
      } catch (error) {
        const durationMs = Date.now() - startTime
        send({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
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
      'Connection': 'keep-alive',
    },
  })
}

// Stream Claude with extended thinking
async function streamClaude(
  prompt: string,
  send: (data: any) => void,
  setFinalText: (text: string) => void,
  useReasoning: boolean = true
) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  send({ type: 'status', status: useReasoning ? 'Starting Claude with extended thinking...' : 'Starting Claude (fast mode)...' })

  // Build request options conditionally
  const requestOptions: any = {
    model: 'claude-opus-4-5-20251101',
    max_tokens: useReasoning ? 16000 : 4096,
    messages: [{ role: 'user', content: prompt }],
  }

  // Only add thinking when reasoning is enabled
  if (useReasoning) {
    requestOptions.thinking = {
      type: 'enabled',
      budget_tokens: 10000,
    }
  }

  const stream = client.messages.stream(requestOptions)

  let thinkingText = ''
  let responseText = ''
  let lastThinkingUpdate = Date.now()

  // Use 'as any' to handle event type flexibility across SDK versions
  ;(stream as any).on('contentBlockDelta', (event: any) => {
    const delta = event.delta
    if (delta?.type === 'thinking_delta') {
      thinkingText += delta.thinking || ''
      // Throttle thinking updates to every 500ms
      if (Date.now() - lastThinkingUpdate > 500) {
        send({
          type: 'thinking',
          thinking: thinkingText.slice(-200), // Last 200 chars
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
      send({ type: 'status', status: 'Deep reasoning in progress...' })
    } else if (block?.type === 'text') {
      send({ type: 'status', status: 'Generating response...' })
    }
  })

  const finalMessage = await stream.finalMessage()

  // Log full response structure for debugging
  console.log('[Claude] Final message stop_reason:', finalMessage.stop_reason)
  console.log('[Claude] Final message content blocks:', finalMessage.content?.length)
  for (const block of finalMessage.content || []) {
    console.log('[Claude] Block type:', block.type, 'length:', block.type === 'text' ? block.text?.length : (block.type === 'thinking' ? (block as any).thinking?.length : 'N/A'))
  }

  // Extract text from final message content blocks
  let extractedText = ''
  for (const block of finalMessage.content || []) {
    if (block.type === 'text') {
      extractedText += block.text
    }
  }

  // Use extracted text if stream didn't capture it
  if (!responseText && extractedText) {
    responseText = extractedText
    console.log('[Claude] Used text from finalMessage content blocks')
  }

  if (!responseText) {
    console.error('[Claude] EMPTY RESPONSE. Full finalMessage:', JSON.stringify(finalMessage, null, 2))
    throw new Error(`Claude returned empty response. stop_reason: ${finalMessage.stop_reason}, content_blocks: ${finalMessage.content?.length}`)
  }

  console.log('[Claude] Final response length:', responseText.length)
  setFinalText(responseText)
}

// Stream GPT-5.2
async function streamGPT(
  prompt: string,
  send: (data: any) => void,
  setFinalText: (text: string) => void,
  useReasoning: boolean = true
) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  send({ type: 'status', status: useReasoning ? 'Starting GPT-5.2 with high reasoning effort...' : 'Starting GPT-5.2 (fast mode)...' })

  // Build request options conditionally
  const requestOptions: any = {
    model: 'gpt-5.2',
    input: prompt,
    stream: true,
  }

  if (useReasoning) {
    requestOptions.tools = [{ type: 'web_search' }]
    requestOptions.reasoning = { effort: 'high' }
  } else {
    requestOptions.reasoning = { effort: 'low' }
  }

  // GPT-5.2 Responses API with streaming
  const response = await (client as any).responses.create(requestOptions)

  let responseText = ''
  let reasoningTokens = 0
  let eventCount = 0
  const eventTypes: string[] = []

  for await (const event of response) {
    eventCount++
    if (!eventTypes.includes(event.type)) {
      eventTypes.push(event.type)
      console.log('[GPT-5.2] New event type:', event.type, 'Sample:', JSON.stringify(event).substring(0, 300))
    }

    if (event.type === 'response.reasoning.delta') {
      reasoningTokens++
      if (reasoningTokens % 50 === 0) {
        send({ type: 'thinking', thinkingTokens: reasoningTokens, thinking: 'Reasoning...' })
      }
    } else if (event.type === 'response.output.delta') {
      responseText += event.delta?.text || ''
      send({ type: 'text', text: responseText.slice(-100) })
    } else if (event.type === 'response.output_text.delta') {
      // Alternative event type for text
      responseText += event.delta || ''
      send({ type: 'text', text: responseText.slice(-100) })
    } else if (event.type === 'response.content_part.delta') {
      // Another possible event type
      responseText += event.delta?.text || event.text || ''
      send({ type: 'text', text: responseText.slice(-100) })
    } else if (event.type === 'response.tool.call') {
      if (event.tool === 'web_search') {
        send({ type: 'status', status: `Searching: ${event.arguments?.query || 'web'}` })
      }
    } else if (event.type === 'response.created') {
      send({ type: 'status', status: 'GPT-5.2 is analyzing...' })
    } else if (event.type === 'response.completed' || event.type === 'response.done') {
      // Try to extract text from completed event
      if (event.response?.output) {
        for (const output of event.response.output) {
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

  console.log('[GPT-5.2] Total events:', eventCount, 'Event types seen:', eventTypes.join(', '))
  console.log('[GPT-5.2] Final response length:', responseText.length)

  if (!responseText) {
    throw new Error(`GPT-5.2 returned empty response. Events: ${eventCount}, Types: ${eventTypes.join(', ')}`)
  }

  setFinalText(responseText)
}

// Stream Grok with DeepSearch
async function streamGrok(
  prompt: string,
  send: (data: any) => void,
  setFinalText: (text: string) => void,
  useReasoning: boolean = true
) {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  })

  send({ type: 'status', status: useReasoning ? 'Starting Grok 4.1 with fast reasoning + search...' : 'Starting Grok 4.1 (fast mode)...' })

  // Use chat completions with streaming for Grok 4.1 fast reasoning + live search
  const stream = await client.chat.completions.create({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 16000,
    stream: true,
    search_mode: 'auto', // Enable live web search
  } as any)

  let responseText = ''

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      responseText += delta
      // Send progress every few characters
      if (responseText.length % 50 === 0 || delta.includes('.')) {
        send({ type: 'text', text: responseText.slice(-100) })
      }
    }
  }

  // Send final text
  send({ type: 'text', text: responseText.slice(-100) })

  console.log('[Grok] Final response length:', responseText.length)
  if (!responseText) {
    throw new Error('Grok returned empty response')
  }

  setFinalText(responseText)
}
