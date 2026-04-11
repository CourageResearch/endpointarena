import { NextRequest } from 'next/server'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getTrialsOverviewData } from '@/lib/trial-overview'

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const marketId = request.nextUrl.searchParams.get('marketId')
    const includeResolved = request.nextUrl.searchParams.get('includeResolved')
    const includeAccounts = request.nextUrl.searchParams.get('includeAccounts')
    const includeEquityHistory = request.nextUrl.searchParams.get('includeEquityHistory')
    const includeRecentRuns = request.nextUrl.searchParams.get('includeRecentRuns')
    const payload = await getTrialsOverviewData({
      marketId,
      includeResolved: includeResolved === '1' || includeResolved === 'true',
      includeAccounts: includeAccounts === null ? undefined : includeAccounts === '1' || includeAccounts === 'true',
      includeEquityHistory: includeEquityHistory === null ? undefined : includeEquityHistory === '1' || includeEquityHistory === 'true',
      includeRecentRuns: includeRecentRuns === null ? undefined : includeRecentRuns === '1' || includeRecentRuns === 'true',
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
