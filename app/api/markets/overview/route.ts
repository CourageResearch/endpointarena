import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getMarketOverviewData } from '@/lib/market-overview'

export async function GET() {
  const requestId = createRequestId()

  try {
    const payload = await getMarketOverviewData()
    return successResponse(payload, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch market overview')
  }
}
