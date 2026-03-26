import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getTrialSyncConfig,
  updateTrialSyncConfig,
  type TrialSyncConfigPatchInput,
} from '@/lib/trial-sync-config'

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const config = await getTrialSyncConfig()

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load ClinicalTrials.gov sync settings')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<TrialSyncConfigPatchInput>(request)
    const config = await updateTrialSyncConfig(body)

    return successResponse({ config }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update ClinicalTrials.gov sync settings')
  }
}
