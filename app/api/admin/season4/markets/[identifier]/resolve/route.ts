import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { resolveSeason4Market } from '@/lib/season4-ops'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'

type ResolveBody = {
  outcome?: 'YES' | 'NO'
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const [{ identifier }, body] = await Promise.all([
      params,
      parseJsonBody<ResolveBody>(request),
    ])
    const market = await resolveSeason4Market({
      identifier,
      outcome: body.outcome === 'NO' ? 'NO' : 'YES',
    })

    revalidateSeason4Routes({ marketSlug: market.marketSlug })

    return successResponse({ market }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to resolve the season 4 market')
  }
}
