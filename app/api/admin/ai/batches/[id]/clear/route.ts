import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { clearAi2BatchNow } from '@/lib/admin-ai2'

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
    const batch = await clearAi2BatchNow(id)

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to clear AI batch')
  }
}
