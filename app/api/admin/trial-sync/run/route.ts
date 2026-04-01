import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { runTrialSync, type TrialSyncMode } from '@/lib/trial-sync'

type RequestBody = {
  force?: boolean
  mode?: TrialSyncMode | 'auto'
}

function parseMode(value: unknown): TrialSyncMode | 'auto' | undefined {
  if (value === undefined) return undefined
  if (value === 'auto' || value === 'incremental' || value === 'reconcile') {
    return value
  }
  throw new ValidationError('mode must be one of: auto, incremental, reconcile')
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<RequestBody>(request, {})
    if (body.force !== undefined && typeof body.force !== 'boolean') {
      throw new ValidationError('force must be a boolean when provided')
    }

    const result = await runTrialSync({
      triggerSource: 'manual',
      force: body.force ?? true,
      mode: parseMode(body.mode) ?? 'auto',
    })

    revalidatePath('/trials')
    revalidatePath('/admin/outcomes')

    return successResponse({ result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run ClinicalTrials.gov sync')
  }
}
