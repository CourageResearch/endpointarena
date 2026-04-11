import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { generateManualTrialIntakeDraft, type ManualTrialIntakeInput } from '@/lib/manual-trial-intake'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<ManualTrialIntakeInput>(request)
    const draft = await generateManualTrialIntakeDraft(body)

    return successResponse({ success: true, draft }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to generate trial draft')
  }
}
