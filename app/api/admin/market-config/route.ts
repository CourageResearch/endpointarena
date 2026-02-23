import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getMarketRuntimeConfig,
  updateMarketRuntimeConfig,
  type MarketRuntimeConfigPatchInput,
} from '@/lib/markets/runtime-config'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const config = await getMarketRuntimeConfig()

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load market runtime config')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<MarketRuntimeConfigPatchInput>(request)
    const config = await updateMarketRuntimeConfig(body)

    revalidatePath('/admin/settings')
    revalidatePath('/admin/markets')

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update market runtime config')
  }
}
