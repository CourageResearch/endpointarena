import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { exportAi2SubscriptionPacket } from '@/lib/admin-ai2'
import { AI2_SUBSCRIPTION_MODEL_IDS, type Ai2SubscriptionModelId } from '@/lib/admin-ai2-shared'
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
    if (!modelId || !AI2_SUBSCRIPTION_MODEL_IDS.includes(modelId as Ai2SubscriptionModelId)) {
      throw new ValidationError('modelId must be claude-opus or gpt-5.2')
    }

    const packet = await exportAi2SubscriptionPacket(id, modelId as Ai2SubscriptionModelId)
    return successResponse({ packet }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to export AI subscription packet')
  }
}
