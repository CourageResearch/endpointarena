import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { syncSeason4IndexerNow } from '@/lib/season4-ops'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'

export async function POST() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const summary = await syncSeason4IndexerNow()
    revalidateSeason4Routes()

    return successResponse({ summary }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run the season 4 indexer')
  }
}
