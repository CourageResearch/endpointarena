import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { runEventMonitor } from '@/lib/event-monitor'

type RequestBody = {
  force?: boolean
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<RequestBody>(request, {})
    if (body.force !== undefined && typeof body.force !== 'boolean') {
      throw new ValidationError('force must be a boolean when provided')
    }

    const result = await runEventMonitor({
      triggerSource: 'manual',
      force: body.force ?? true,
    })

    revalidatePath('/admin/outcomes')

    return successResponse({ result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run event monitor')
  }
}
