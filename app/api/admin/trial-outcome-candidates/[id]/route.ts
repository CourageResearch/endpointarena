import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdminSession } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { db, onchainMarkets, trialOutcomeCandidates } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { getSeason4OnchainConfig } from '@/lib/onchain/config'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'
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
    const session = await requireAdminSession()
    const reviewerId = session.user.id ?? null

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
    revalidatePath('/admin/oracle')
    revalidateSeason4Routes()

    if (body.action === 'accept' && existingCandidate?.trialQuestionId) {
      const config = getSeason4OnchainConfig()
      const linkedSeason4Markets = config.managerAddress
        ? await db.query.onchainMarkets.findMany({
            where: and(
              eq(onchainMarkets.managerAddress, config.managerAddress),
              eq(onchainMarkets.trialQuestionId, existingCandidate.trialQuestionId),
            ),
            columns: {
              marketSlug: true,
            },
          })
        : []

      for (const market of linkedSeason4Markets) {
        revalidateSeason4Routes({ marketSlug: market.marketSlug })
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
