import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { exportAiSubscriptionPacket, getAiBatchState } from '@/lib/admin-ai'
import { assertAiBatchMatchesActiveDatabase } from '@/lib/admin-ai-active-dataset'
import { AI_SUBSCRIPTION_MODEL_IDS, type AiSubscriptionModelId } from '@/lib/admin-ai-shared'
import { ValidationError } from '@/lib/errors'

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { id } = await context.params
    const { searchParams } = new URL(request.url)
    const modelId = searchParams.get('modelId')
    if (!modelId || !AI_SUBSCRIPTION_MODEL_IDS.includes(modelId as AiSubscriptionModelId)) {
      throw new ValidationError('modelId must be claude-opus or gpt-5.4')
    }

    const existingBatch = await getAiBatchState(id)
    if (existingBatch) {
      assertAiBatchMatchesActiveDatabase(existingBatch)
    }

    const packet = await exportAiSubscriptionPacket(id, modelId as AiSubscriptionModelId)
    return successResponse({ packet }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to export AI subscription packet')
  }
}
