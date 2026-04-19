import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSession } from '@/lib/auth/session'
import { getSeason4MarketDetail } from '@/lib/season4-market-data'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ marketId: string }> },
) {
  const requestId = createRequestId()

  try {
    const [{ marketId: encodedMarketId }, session] = await Promise.all([
      params,
      getSession(),
    ])
    const marketId = decodeURIComponent(encodedMarketId)

    const payload = await getSeason4MarketDetail(marketId, {
      sync: true,
      viewerUserId: session?.user.id ?? null,
    })

    return successResponse(payload, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load the season 4 market')
  }
}
