import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getAiDeskState } from '@/lib/admin-ai'
import { assertAiBatchMatchesActiveDatabase, validateRequestedAiDatasetForActiveDatabase } from '@/lib/admin-ai-active-dataset'

export async function GET(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { searchParams } = new URL(request.url)
    const dataset = validateRequestedAiDatasetForActiveDatabase(searchParams.get('dataset'))
    const batchId = searchParams.get('batchId')

    const state = await getAiDeskState(dataset, batchId)
    if (state.batch) {
      assertAiBatchMatchesActiveDatabase(state.batch)
    }

    return successResponse(state, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load admin AI state')
  }
}
