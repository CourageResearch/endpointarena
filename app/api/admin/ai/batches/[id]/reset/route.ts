import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { resetAi2Batch } from '@/lib/admin-ai2'

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(_: Request, context: RouteContext) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { id } = await context.params
    await resetAi2Batch(id)

    return successResponse({ success: true }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to reset AI batch')
  }
}
