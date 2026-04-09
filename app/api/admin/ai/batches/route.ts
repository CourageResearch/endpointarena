import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { createAiBatch } from '@/lib/admin-ai'
import {
  AI_API_CONCURRENCY_MAX,
  AI_API_CONCURRENCY_MIN,
  isAiApiConcurrency,
  isAiDataset,
} from '@/lib/admin-ai-shared'
import { isModelId } from '@/lib/constants'
import { ValidationError } from '@/lib/errors'

type CreateBatchBody = {
  dataset?: string
  enabledModelIds?: string[]
  apiConcurrency?: number
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<CreateBatchBody>(request)
    const dataset = typeof body.dataset === 'string' ? body.dataset : ''
    if (!isAiDataset(dataset)) {
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
    if (body.apiConcurrency != null && !isAiApiConcurrency(body.apiConcurrency)) {
      throw new ValidationError(`apiConcurrency must be an integer between ${AI_API_CONCURRENCY_MIN} and ${AI_API_CONCURRENCY_MAX}`)
    }

    const batch = await createAiBatch({
      dataset,
      enabledModelIds,
      apiConcurrency: body.apiConcurrency,
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
