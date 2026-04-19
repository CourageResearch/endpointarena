import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { getAiBatchState, updateAiBatchSettings } from '@/lib/admin-ai'
import { assertAiBatchMatchesActiveDatabase } from '@/lib/admin-ai-active-dataset'
import {
  AI_API_CONCURRENCY_MAX,
  AI_API_CONCURRENCY_MIN,
  isAiApiConcurrency,
} from '@/lib/admin-ai-shared'
import { ValidationError } from '@/lib/errors'

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type UpdateBatchBody = {
  apiConcurrency?: number
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<UpdateBatchBody>(request)
    if (!isAiApiConcurrency(body.apiConcurrency)) {
      throw new ValidationError(`apiConcurrency must be an integer between ${AI_API_CONCURRENCY_MIN} and ${AI_API_CONCURRENCY_MAX}`)
    }

    const { id } = await context.params
    const existingBatch = await getAiBatchState(id)
    if (existingBatch) {
      assertAiBatchMatchesActiveDatabase(existingBatch)
    }

    const batch = await updateAiBatchSettings(id, {
      apiConcurrency: body.apiConcurrency,
    })

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update AI batch settings')
  }
}
