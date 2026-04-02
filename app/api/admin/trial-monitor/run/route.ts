import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { runTrialMonitor } from '@/lib/trial-monitor'

type RequestBody = {
  force?: boolean
  nctNumber?: string
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<RequestBody>(request, {})
    if (body.force !== undefined && typeof body.force !== 'boolean') {
      throw new ValidationError('force must be a boolean when provided')
    }
    if (body.nctNumber !== undefined && typeof body.nctNumber !== 'string') {
      throw new ValidationError('nctNumber must be a string when provided')
    }

    const result = await runTrialMonitor({
      triggerSource: 'manual',
      force: body.force ?? true,
      nctNumber: body.nctNumber,
    })

    revalidatePath('/admin/outcomes')

    return successResponse({ result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run trial monitor')
  }
}
