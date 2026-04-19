import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { createSeason4Market, type Season4MarketCreateInput } from '@/lib/season4-ops'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'

type CreateMarketBody = {
  marketSlug?: string
  title?: string
  metadataUri?: string | null
  closeTime?: string
  liquidityB?: string | number | null
  trialQuestionId?: string | null
  openingProbability?: number | null
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<CreateMarketBody>(request)
    const market = await createSeason4Market({
      marketSlug: body.marketSlug ?? '',
      title: body.title ?? '',
      metadataUri: body.metadataUri,
      closeTime: body.closeTime ?? '',
      liquidityB: body.liquidityB,
      trialQuestionId: body.trialQuestionId,
      openingProbability: body.openingProbability,
    } satisfies Season4MarketCreateInput)

    revalidateSeason4Routes({ marketSlug: market.marketSlug })

    return successResponse({ market }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to create the season 4 market')
  }
}
