import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { openMarketForTrialQuestion } from '@/lib/markets/engine'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
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

    const market = await openMarketForTrialQuestion(trialQuestionId)

    revalidatePath('/trials')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/markets')
    revalidatePath('/admin/predictions')

    return successResponse({ success: true, market }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to open market')
  }
}
