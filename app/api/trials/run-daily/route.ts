import { NextRequest, NextResponse } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { errorResponse, parseOptionalJsonBody, createRequestId, successResponse } from '@/lib/api-response'
import { DEPRECATED_MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { ValidationError } from '@/lib/errors'
import { executeDailyRun } from '@/lib/markets/daily-run'
import { normalizeRunDate } from '@/lib/markets/engine'
import type { DailyRunStreamEvent } from '@/lib/markets/types'
import { DAILY_RUN_STOPPED_REASON, isDailyRunStoppedError } from '@/lib/markets/run-control'

const NDJSON_ENCODER = new TextEncoder()

function serializeNdjsonLine(payload: DailyRunStreamEvent): Uint8Array {
  return NDJSON_ENCODER.encode(`${JSON.stringify(payload)}\n`)
}

function resolveRunDate(input?: string): Date {
  const parsed = input ? new Date(input) : new Date()
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('runDate must be a valid ISO date string')
  }
  return normalizeRunDate(parsed)
}

function resolveScopedNctNumber(input: unknown): string | undefined {
  if (input == null || input === '') {
    return undefined
  }

  if (typeof input !== 'string') {
    throw new ValidationError('nctNumber must be a string')
  }

  const normalized = input.trim().toUpperCase()
  if (!/^NCT\d{8}$/.test(normalized)) {
    throw new ValidationError('nctNumber must look like NCT12345678')
  }

  return normalized
}

function resolveModelIds(input: unknown): ModelId[] | undefined {
  if (input == null) {
    return undefined
  }

  if (!Array.isArray(input)) {
    throw new ValidationError('modelIds must be an array of model ids')
  }

  const normalized = Array.from(new Set(
    input.map((value) => {
      if (typeof value !== 'string') {
        throw new ValidationError('modelIds must contain strings only')
      }

      const modelId = value.trim()
      if (DEPRECATED_MODEL_IDS.includes(modelId as (typeof DEPRECATED_MODEL_IDS)[number])) {
        throw new ValidationError(`Model ${modelId} is deprecated and cannot be run`)
      }
      if (!isModelId(modelId)) {
        throw new ValidationError(`Unknown modelId: ${modelId}`)
      }

      return modelId
    }),
  ))

  return normalized.length > 0 ? normalized : undefined
}

function resolveClaudeProvider(input: unknown): 'api' | 'web' | undefined {
  if (input == null || input === '') {
    return undefined
  }

  if (input === 'api' || input === 'web') {
    return input
  }

  throw new ValidationError('claudeProvider must be either "api" or "web"')
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()
  const streamMode = new URL(request.url).searchParams.get('stream') === '1'

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<{
      runDate?: string
      nctNumber?: string
      modelIds?: string[]
      claudeProvider?: 'api' | 'web'
    }>(request, {})
    const runDate = resolveRunDate(body.runDate)
    const nctNumber = resolveScopedNctNumber(body.nctNumber)
    const modelIds = resolveModelIds(body.modelIds)
    const claudeProvider = resolveClaudeProvider(body.claudeProvider)

    if (claudeProvider === 'web' && process.env.NODE_ENV === 'production') {
      throw new ValidationError('claudeProvider="web" is currently only supported in local development')
    }

    if (streamMode) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let streamClosed = false
          const writeEvent = (event: DailyRunStreamEvent): void => {
            if (streamClosed) return
            try {
              controller.enqueue(serializeNdjsonLine(event))
            } catch (error) {
              streamClosed = true
              const message = error instanceof Error ? error.message : String(error)
              console.warn('Trial run stream disconnected while run is active:', message)
            }
          }

          try {
            const payload = await executeDailyRun(runDate, {
              nctNumber,
              modelIds,
              claudeProvider,
              hooks: {
                onStart: (start) => {
                  writeEvent({ type: 'start', ...start })
                },
                onActivity: ({ completedActions, totalActions, message, marketId, trialQuestionId, actorId, modelId, phase }) => {
                  writeEvent({
                    type: 'activity',
                    completedActions,
                    totalActions,
                    message,
                    marketId,
                    trialQuestionId,
                    actorId,
                    modelId,
                    phase,
                  })
                },
                onProgress: ({ completedActions, totalActions, result }) => {
                  writeEvent({
                    type: 'progress',
                    completedActions,
                    totalActions,
                    result,
                  })
                },
              },
            })

            writeEvent({
              type: 'done',
              payload,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : `Failed to run daily trial cycle (request ${requestId})`
            const stoppedByAdmin = isDailyRunStoppedError(error) || message === DAILY_RUN_STOPPED_REASON

            if (stoppedByAdmin) {
              writeEvent({
                type: 'cancelled',
                message,
              })
            } else {
              writeEvent({
                type: 'error',
                message,
              })
            }
          } finally {
            if (!streamClosed) {
              try {
                controller.close()
              } catch {
                streamClosed = true
              }
            }
          }
        },
        cancel() {
          // Keep run execution alive even if the UI disconnects.
        },
      })

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Request-Id': requestId,
        },
      })
    }

    const payload = await executeDailyRun(runDate, {
      nctNumber,
      modelIds,
      claudeProvider,
    })
    return successResponse(payload, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run daily trial cycle')
  }
}
