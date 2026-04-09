import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { retryAiTask } from '@/lib/admin-ai'
import { ValidationError } from '@/lib/errors'

type RetryBody = {
  taskKey?: string
}

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
    const body = await parseJsonBody<RetryBody>(request)
    const taskKey = typeof body.taskKey === 'string' ? body.taskKey.trim() : ''
    if (!taskKey) {
      throw new ValidationError('taskKey is required')
    }

    const batch = await retryAiTask(id, taskKey)

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to retry AI task')
  }
}
