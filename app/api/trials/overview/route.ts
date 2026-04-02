import { NextRequest } from 'next/server'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getTrialsOverviewData } from '@/lib/trial-overview'

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const marketId = request.nextUrl.searchParams.get('marketId')
    const includeResolved = request.nextUrl.searchParams.get('includeResolved')
    const payload = await getTrialsOverviewData({
      marketId,
      includeResolved: includeResolved === '1' || includeResolved === 'true',
    })
    return successResponse(payload, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch trials overview')
  }
}
