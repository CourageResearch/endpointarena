import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getTrialMonitorConfig,
  updateTrialMonitorConfig,
  type TrialMonitorConfigPatchInput,
} from '@/lib/trial-monitor-config'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const config = await getTrialMonitorConfig()

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load trial monitor settings')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<TrialMonitorConfigPatchInput>(request)
    const config = await updateTrialMonitorConfig(body)

    revalidatePath('/admin/outcomes')

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update trial monitor settings')
  }
}
