import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getLatestMarketRunSnapshot } from '@/lib/market-run-logs'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const snapshot = await getLatestMarketRunSnapshot()

    return successResponse({ snapshot }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load trial run state')
  }
}
