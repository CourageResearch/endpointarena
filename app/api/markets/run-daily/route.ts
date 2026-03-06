import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { ensureAdmin } from '@/lib/auth'
import { errorResponse, parseOptionalJsonBody, createRequestId, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { executeDailyRun } from '@/lib/markets/daily-run'
import { normalizeRunDate } from '@/lib/markets/engine'
import type { DailyRunActivityPhase, DailyRunResult, DailyRunStatus, DailyRunStreamEvent } from '@/lib/markets/types'
import { MODEL_INFO } from '@/lib/constants'
import { db, marketRuns } from '@/lib/db'
import { appendMarketRunLog, clearMarketRunLogs, ensureMarketRunLogSchema, getRunningMarketRunId } from '@/lib/market-run-logs'

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

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

function formatProgressLog(result: DailyRunResult): string {
  const modelName = MODEL_INFO[result.modelId].fullName
  const amountPart = result.amountUsd > 0 ? ` ${formatMoney(result.amountUsd)}` : ''
  return `${modelName} ${result.action}${amountPart} (${result.status}) - ${truncateText(result.detail, 110)}`
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
          await ensureMarketRunLogSchema()

          let streamClosed = false
          const writeEvent = (event: DailyRunStreamEvent): void => {
            if (streamClosed) return
            try {
              controller.enqueue(serializeNdjsonLine(event))
            } catch (error) {
              streamClosed = true
              const message = error instanceof Error ? error.message : String(error)
              // Client may disconnect (navigate/refresh) while run continues on server.
              console.warn('Market run stream disconnected while run is active:', message)
            }
          }
          let runId: string | null = null
          let okCount = 0
          let errorCount = 0
          let skippedCount = 0
          let persistQueue = Promise.resolve()

          const queuePersist = (input: {
            logType: 'system' | 'activity' | 'progress' | 'error'
            message: string
            completedActions?: number
            totalActions?: number
            marketId?: string
            fdaEventId?: string
            modelId?: DailyRunResult['modelId']
            activityPhase?: DailyRunActivityPhase
            status?: DailyRunStatus
            result?: DailyRunResult
          }) => {
            const currentRunId = runId
            if (!currentRunId) return

            persistQueue = persistQueue
              .then(async () => {
                await appendMarketRunLog({
                  runId: currentRunId,
                  logType: input.logType,
                  message: input.message,
                  completedActions: input.completedActions,
                  totalActions: input.totalActions,
                  okCount,
                  errorCount,
                  skippedCount,
                  marketId: input.result?.marketId ?? input.marketId ?? null,
                  fdaEventId: input.result?.fdaEventId ?? input.fdaEventId ?? null,
                  modelId: input.result?.modelId ?? input.modelId ?? null,
                  activityPhase: input.activityPhase ?? null,
                  action: input.result?.action ?? null,
                  actionStatus: input.status ?? null,
                  amountUsd: input.result?.amountUsd ?? null,
                })
              })
              .catch((error) => {
                console.error('Failed to persist market run log:', error)
              })
          }

          const queueRunHeartbeat = (completedActions: number, totalActions: number) => {
            const currentRunId = runId
            if (!currentRunId) return

            persistQueue = persistQueue
              .then(async () => {
                await db.update(marketRuns)
                  .set({
                    totalActions,
                    processedActions: completedActions,
                    okCount,
                    errorCount,
                    skippedCount,
                    updatedAt: new Date(),
                  })
                  .where(eq(marketRuns.id, currentRunId))
              })
              .catch((error) => {
                console.error('Failed to persist market run heartbeat:', error)
              })
          }

          try {
            const payload = await executeDailyRun(runDate, {
              onStart: (start) => {
                runId = start.runId
                persistQueue = persistQueue
                  .then(async () => {
                    if (!runId) return
                    await clearMarketRunLogs(runId)
                  })
                  .catch((error) => {
                    console.error('Failed to reset market run logs:', error)
                  })
                queuePersist({
                  logType: 'system',
                  message: 'Starting daily market cycle...',
                  completedActions: 0,
                  totalActions: start.totalActions,
                })
                writeEvent({ type: 'start', ...start })
              },
              onActivity: ({ completedActions, totalActions, message, marketId, fdaEventId, modelId, phase }) => {
                queuePersist({
                  logType: 'activity',
                  message,
                  completedActions,
                  totalActions,
                  marketId,
                  fdaEventId,
                  modelId,
                  activityPhase: phase,
                })
                queueRunHeartbeat(completedActions, totalActions)
                writeEvent({
                  type: 'activity',
                  completedActions,
                  totalActions,
                  message,
                  marketId,
                  fdaEventId,
                  modelId,
                  phase,
                })
              },
              onProgress: ({ completedActions, totalActions, result }) => {
                if (result.status === 'ok') okCount += 1
                if (result.status === 'error') errorCount += 1
                if (result.status === 'skipped') skippedCount += 1

                queuePersist({
                  logType: result.status === 'error' ? 'error' : 'progress',
                  message: formatProgressLog(result),
                  completedActions,
                  totalActions,
                  status: result.status,
                  result,
                })
                queueRunHeartbeat(completedActions, totalActions)
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
            if (runId) {
              okCount = payload.summary.ok
              errorCount = payload.summary.error
              skippedCount = payload.summary.skipped
              queuePersist({
                logType: 'system',
                message: 'Daily market cycle completed',
                completedActions: payload.processedActions,
                totalActions: payload.totalActions,
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : `Failed to run daily market cycle (request ${requestId})`
            const alreadyRunning = message.toLowerCase().includes('already running')

            if (!alreadyRunning) {
              if (!runId) {
                runId = await getRunningMarketRunId()
              }
              queuePersist({
                logType: 'error',
                message: `RUN FAILED - ${message}`,
              })
            }

            writeEvent({
              type: 'error',
              message,
            })
          } finally {
            await persistQueue
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
          // Persistence is handled via queuePersist/queueRunHeartbeat.
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
