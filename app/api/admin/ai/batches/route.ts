import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { createAi2Batch } from '@/lib/admin-ai2'
import { isAi2Dataset } from '@/lib/admin-ai2-shared'
import { isModelId } from '@/lib/constants'
import { ValidationError } from '@/lib/errors'

type CreateBatchBody = {
  dataset?: string
  enabledModelIds?: string[]
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<CreateBatchBody>(request)
    const dataset = typeof body.dataset === 'string' ? body.dataset : ''
    if (!isAi2Dataset(dataset)) {
      throw new ValidationError('dataset must be toy or live')
    }

    const rawEnabledModelIds = Array.isArray(body.enabledModelIds)
      ? body.enabledModelIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
      : []
    const invalidModel = rawEnabledModelIds.find((value) => !isModelId(value))
    if (invalidModel) {
      throw new ValidationError(`Unknown model id: ${invalidModel}`)
    }
    const enabledModelIds = rawEnabledModelIds.filter(isModelId)

    const batch = await createAi2Batch({
      dataset,
      enabledModelIds,
    })

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to create AI batch')
  }
}
