import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { seedSeason4ModelWallets } from '@/lib/season4-ops'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'

type SeedBody = {
  bankrollDisplay?: number | null
  walletMap?: Record<string, string | null | undefined> | null
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<SeedBody>(request, {})
    const summary = await seedSeason4ModelWallets({
      bankrollDisplay: body.bankrollDisplay,
      walletMap: body.walletMap,
    })

    revalidateSeason4Routes()

    return successResponse({ summary }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to seed season 4 model wallets')
  }
}
