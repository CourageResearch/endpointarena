import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  type ManualTrialOpeningLineSource,
  publishManualTrialIntake,
  requireAdminUserId,
  type ManualTrialIntakeInput,
} from '@/lib/manual-trial-intake'

type PublishRequestBody = {
  form: ManualTrialIntakeInput
  calculation?: {
    suggestedProbability?: number | null
    suggestedSource?: ManualTrialOpeningLineSource
    openingLineError?: string | null
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const adminUserId = await requireAdminUserId()
    const body = await parseJsonBody<ManualTrialIntakeInput | PublishRequestBody>(request)
    const form = body && typeof body === 'object' && 'form' in body ? body.form : body
    const calculation = body && typeof body === 'object' && 'form' in body ? body.calculation : undefined
    const result = await publishManualTrialIntake(form, adminUserId, {
      suggestedProbability: calculation?.suggestedProbability,
      suggestedSource: calculation?.suggestedSource,
      openingLineError: calculation?.openingLineError,
    })

    revalidatePath('/')
    revalidatePath('/trials')
    revalidatePath('/leaderboard')
    revalidatePath('/profile')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/trials')
    revalidatePath('/admin/predictions')

    return successResponse({ success: true, ...result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to publish trial intake')
  }
}
