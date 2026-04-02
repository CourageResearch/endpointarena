import { getServerSession } from 'next-auth'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authOptions, ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { db, predictionMarkets, trialOutcomeCandidates } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { reviewTrialOutcomeCandidate } from '@/lib/trial-monitor'

type PatchBody = {
  action: 'accept' | 'reject' | 'dismiss' | 'supersede' | 'clear_for_rerun'
  reviewNotes?: string | null
}

function normalizeReviewNotes(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const session = await getServerSession(authOptions)
    const reviewerId = session?.user?.id ?? null

    const { id } = await params
    const body = await parseJsonBody<PatchBody>(request)
    const existingCandidate = await db.query.trialOutcomeCandidates.findFirst({
      where: eq(trialOutcomeCandidates.id, id),
      columns: {
        trialQuestionId: true,
      },
    })

    if (
      body.action !== 'accept' &&
      body.action !== 'reject' &&
      body.action !== 'dismiss' &&
      body.action !== 'supersede' &&
      body.action !== 'clear_for_rerun'
    ) {
      throw new ValidationError('action must be accept, reject, dismiss, supersede, or clear_for_rerun')
    }

    await reviewTrialOutcomeCandidate({
      candidateId: id,
      action: body.action,
      reviewerId,
      reviewNotes: normalizeReviewNotes(body.reviewNotes),
    })

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/trials')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/trials')
    revalidatePath('/admin/markets')
    revalidatePath('/admin/outcomes')

    if (body.action === 'accept' && existingCandidate?.trialQuestionId) {
      const market = await db.query.predictionMarkets.findFirst({
        where: eq(predictionMarkets.trialQuestionId, existingCandidate.trialQuestionId),
        columns: {
          id: true,
        },
      })

      if (market?.id) {
        revalidatePath(`/trials/${market.id}`)
      }
    }

    return successResponse({ success: true }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update trial outcome review item')
  }
}
