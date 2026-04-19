import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { runTrialMonitor } from '@/lib/trial-monitor'

const VALID_RUN_SCOPES = new Set(['eligible_queue', 'all_open_trials', 'specific_nct'] as const)

type RequestBody = {
  force?: boolean
  scope?: 'eligible_queue' | 'all_open_trials' | 'specific_nct'
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
    if (body.scope !== undefined && !VALID_RUN_SCOPES.has(body.scope)) {
      throw new ValidationError('scope must be one of eligible_queue, all_open_trials, or specific_nct')
    }
    if (body.nctNumber !== undefined && typeof body.nctNumber !== 'string') {
      throw new ValidationError('nctNumber must be a string when provided')
    }

    const result = await runTrialMonitor({
      triggerSource: 'manual',
      force: body.force ?? true,
      questionSelection: body.scope,
      nctNumber: body.nctNumber,
    })

    revalidatePath('/admin/oracle')

    return successResponse({ result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run trial monitor')
  }
}
