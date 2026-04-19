import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { clearAiBatchNow, getAiBatchState } from '@/lib/admin-ai'
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

    const batch = await clearAiBatchNow(id)

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to clear AI batch')
  }
}
