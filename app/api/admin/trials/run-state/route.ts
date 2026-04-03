import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getLatestTrialRunSnapshot } from '@/lib/trial-run-logs'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const snapshot = await getLatestTrialRunSnapshot()

    return successResponse({ snapshot }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load trial run state')
  }
}
