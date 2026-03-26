import { NextRequest } from 'next/server'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getTrialsBrowseData } from '@/lib/trials-browse'

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const includeResolved = request.nextUrl.searchParams.get('includeResolved')
    const payload = await getTrialsBrowseData({
      includeResolved: includeResolved === '1' || includeResolved === 'true',
    })

    return successResponse(payload, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch trials browse data')
  }
}
