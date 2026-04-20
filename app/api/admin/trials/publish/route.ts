import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  type ManualTrialOpeningLineSource,
  publishManualTrialIntake,
  requireAdminUserId,
  type ManualTrialIntakeInput,
} from '@/lib/manual-trial-intake'
import { ValidationError } from '@/lib/errors'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'

type PublishRequestBody = {
  form: ManualTrialIntakeInput
  calculation?: {
    suggestedProbability?: number | null
    suggestedSource?: ManualTrialOpeningLineSource
    openingLineError?: string | null
  }
}

const AI_PUBLISH_REQUIRED_MESSAGE = 'Successful AI calculation is required before publishing manual trial intake.'

function assertPublishCalculationIsAiBacked(calculation: PublishRequestBody['calculation'] | undefined) {
  if (!calculation) {
    throw new ValidationError(AI_PUBLISH_REQUIRED_MESSAGE)
  }

  if (calculation.suggestedSource !== 'draft_ai') {
    throw new ValidationError(AI_PUBLISH_REQUIRED_MESSAGE)
  }

  if (typeof calculation.openingLineError === 'string' && calculation.openingLineError.trim().length > 0) {
    throw new ValidationError(AI_PUBLISH_REQUIRED_MESSAGE)
  }

  if (typeof calculation.suggestedProbability !== 'number' || !Number.isFinite(calculation.suggestedProbability)) {
    throw new ValidationError(AI_PUBLISH_REQUIRED_MESSAGE)
  }
}

function getSafePublishErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return null
  }

  const redacted = error.message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted database url]')
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, '[redacted private key]')
    .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*)=([^\s,;]+)/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()

  return redacted.length > 0 ? redacted.slice(0, 600) : null
}

function getPublishFailureFallback(error: unknown): string {
  const message = getSafePublishErrorMessage(error)
  return message
    ? `Failed to publish trial intake: ${message}`
    : 'Failed to publish trial intake'
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const adminUserId = await requireAdminUserId()
    const body = await parseJsonBody<ManualTrialIntakeInput | PublishRequestBody>(request)
    if (!body || typeof body !== 'object' || !('form' in body)) {
      throw new ValidationError(AI_PUBLISH_REQUIRED_MESSAGE)
    }

    const form = body.form
    const calculation = body.calculation
    assertPublishCalculationIsAiBacked(calculation)

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
    revalidatePath('/admin/base')
    revalidateSeason4Routes({ marketSlug: result.market.marketSlug })

    return successResponse({ success: true, ...result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    console.error(`[manual-trial-intake] Publish failed (${requestId})`, error)
    return errorResponse(error, requestId, getPublishFailureFallback(error))
  }
}
