import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSeason4HomepageData } from '@/lib/season4-market-data'

export async function GET() {
  const requestId = createRequestId()

  try {
    const payload = await getSeason4HomepageData({ sync: true })

    return successResponse(payload, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load season 4 markets')
  }
}
