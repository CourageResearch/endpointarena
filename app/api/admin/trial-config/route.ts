import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getTrialRuntimeConfig,
  updateTrialRuntimeConfig,
  type TrialRuntimeConfigPatchInput,
} from '@/lib/trial-runtime-config'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const config = await getTrialRuntimeConfig()

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load runtime settings')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<TrialRuntimeConfigPatchInput>(request)
    const config = await updateTrialRuntimeConfig(body)

    revalidatePath('/admin/settings')
    revalidatePath('/admin/ai')

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update runtime settings')
  }
}
