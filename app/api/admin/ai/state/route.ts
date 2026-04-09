import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getAi2DeskState } from '@/lib/admin-ai2'
import { isAi2Dataset } from '@/lib/admin-ai2-shared'
import { getActiveDatabaseTarget } from '@/lib/database-target'
import { ValidationError } from '@/lib/errors'

function getDefaultAiDatasetForCurrentDatabase(): 'toy' | 'live' {
  return getActiveDatabaseTarget() === 'toy' ? 'toy' : 'live'
}

export async function GET(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { searchParams } = new URL(request.url)
    const datasetRaw = searchParams.get('dataset') ?? getDefaultAiDatasetForCurrentDatabase()
    const batchId = searchParams.get('batchId')
    if (!isAi2Dataset(datasetRaw)) {
      throw new ValidationError('dataset must be toy or live')
    }

    const state = await getAi2DeskState(datasetRaw, batchId)
    return successResponse(state, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load admin AI state')
  }
}
