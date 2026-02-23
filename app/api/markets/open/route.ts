import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { openMarketForEvent } from '@/lib/markets/engine'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<{ fdaEventId?: string }>(request)
    const fdaEventId = typeof body?.fdaEventId === 'string' ? body.fdaEventId : ''

    if (!fdaEventId) {
      throw new ValidationError('fdaEventId is required')
    }

    const market = await openMarketForEvent(fdaEventId)

    return successResponse({ success: true, market }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to open market')
  }
}
