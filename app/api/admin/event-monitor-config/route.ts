import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getEventMonitorConfig,
  updateEventMonitorConfig,
  type EventMonitorConfigPatchInput,
} from '@/lib/event-monitor-config'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const config = await getEventMonitorConfig()

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load event monitor settings')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<EventMonitorConfigPatchInput>(request)
    const config = await updateEventMonitorConfig(body)

    revalidatePath('/admin/outcomes')

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update event monitor settings')
  }
}
