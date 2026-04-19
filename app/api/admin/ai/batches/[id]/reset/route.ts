import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getAiBatchState, resetAiBatch } from '@/lib/admin-ai'
import { assertAiBatchMatchesActiveDatabase } from '@/lib/admin-ai-active-dataset'

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
    const existingBatch = await getAiBatchState(id)
    if (existingBatch) {
      assertAiBatchMatchesActiveDatabase(existingBatch)
    }

    await resetAiBatch(id)

    return successResponse({ success: true }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to reset AI batch')
  }
}
