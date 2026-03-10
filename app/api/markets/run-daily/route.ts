import { NextRequest, NextResponse } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { errorResponse, parseOptionalJsonBody, createRequestId, successResponse } from '@/lib/api-response'
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

export async function POST(request: NextRequest) {
  const requestId = createRequestId()
  const streamMode = new URL(request.url).searchParams.get('stream') === '1'

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<{ runDate?: string }>(request, {})
    const runDate = resolveRunDate(body.runDate)

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
              console.warn('Market run stream disconnected while run is active:', message)
            }
          }

          try {
            const payload = await executeDailyRun(runDate, {
              onStart: (start) => {
                writeEvent({ type: 'start', ...start })
              },
              onActivity: ({ completedActions, totalActions, message, marketId, fdaEventId, actorId, modelId, phase }) => {
                writeEvent({
                  type: 'activity',
                  completedActions,
                  totalActions,
                  message,
                  marketId,
                  fdaEventId,
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
            })

            writeEvent({
              type: 'done',
              payload,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : `Failed to run daily market cycle (request ${requestId})`
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

    const payload = await executeDailyRun(runDate)
    return successResponse(payload, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run daily market cycle')
  }
}
