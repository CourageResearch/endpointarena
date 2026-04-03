import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { requestTrialMonitorStop } from '@/lib/trial-monitor'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<{ runId?: string }>(request, {})
    const runId = typeof body.runId === 'string' && body.runId.trim().length > 0
      ? body.runId.trim()
      : undefined

    const stoppedRunId = await requestTrialMonitorStop(runId)
    if (!stoppedRunId) {
      throw new ValidationError('No running trial monitor was found to pause.')
    }

    revalidatePath('/admin/outcomes')

    return successResponse({
      runId: stoppedRunId,
      message: 'Pause requested. The current in-flight trial check will finish, then the monitor will halt.',
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to pause trial monitor')
  }
}
