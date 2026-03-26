import { NextRequest } from 'next/server'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getMarketOverviewData } from '@/lib/market-overview'

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const marketId = request.nextUrl.searchParams.get('marketId')
    const includeResolved = request.nextUrl.searchParams.get('includeResolved')
    const payload = await getMarketOverviewData({
      marketId,
      includeResolved: includeResolved === '1' || includeResolved === 'true',
    })
    return successResponse(payload, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch market overview')
  }
}
