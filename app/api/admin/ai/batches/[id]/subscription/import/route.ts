import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { getAiBatchState, importAiSubscriptionPacket } from '@/lib/admin-ai'
import { assertAiBatchMatchesActiveDatabase } from '@/lib/admin-ai-active-dataset'

type ImportBody = {
  workflow?: string
  batchId?: string
  modelId?: string
  rawText?: string
  decisions?: Array<{
    taskKey?: string
    decision?: unknown
  }>
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
    const body = await parseJsonBody<ImportBody>(request)
    const existingBatch = await getAiBatchState(id)
    if (existingBatch) {
      assertAiBatchMatchesActiveDatabase(existingBatch)
    }

    const batch = await importAiSubscriptionPacket(id, {
      workflow: typeof body.workflow === 'string' ? body.workflow : '',
      batchId: typeof body.batchId === 'string' ? body.batchId : '',
      modelId: typeof body.modelId === 'string' ? body.modelId : '',
      rawText: typeof body.rawText === 'string' ? body.rawText : null,
      decisions: Array.isArray(body.decisions)
        ? body.decisions.map((item) => ({
            taskKey: typeof item.taskKey === 'string' ? item.taskKey : '',
            decision: item.decision,
          }))
        : [],
    })

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    console.error('AI subscription import failed', requestId, error)
    return errorResponse(error, requestId, 'Failed to import AI subscription packet')
  }
}
