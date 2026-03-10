import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { requestDailyRunStop } from '@/lib/markets/run-control'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<{ runId?: string }>(request, {})
    const runId = typeof body.runId === 'string' && body.runId.trim().length > 0
      ? body.runId.trim()
      : undefined

    const stoppedRunId = await requestDailyRunStop(runId)
    if (!stoppedRunId) {
      throw new ValidationError('No running daily market cycle was found to stop.')
    }

    return successResponse({
      runId: stoppedRunId,
      message: 'Stop requested. The current in-flight model step will finish, then the daily cycle will halt.',
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to stop daily market cycle')
  }
}
