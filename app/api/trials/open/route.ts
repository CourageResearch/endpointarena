import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<{ trialQuestionId?: string }>(request)
    const trialQuestionId = typeof body?.trialQuestionId === 'string' ? body.trialQuestionId : ''

    if (!trialQuestionId) {
      throw new ValidationError('trialQuestionId is required')
    }

    throw new ValidationError('Legacy offchain market opening is retired. Publish from /admin/trials to deploy the Base Sepolia market.')
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to open trial')
  }
}
