import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db, onchainMarkets, trialQuestions } from '@/lib/db'
import { requireAdminSession } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { revalidateSeason4Routes } from '@/lib/season4-revalidate'
import { resolveSeason4Market } from '@/lib/season4-ops'
import { recordTrialQuestionOutcomeHistory } from '@/lib/trial-outcome-history'

type PatchBody = {
  outcome?: 'Pending' | 'YES' | 'NO'
}

const VALID_OUTCOMES = new Set<PatchBody['outcome']>(['Pending', 'YES', 'NO'])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId()

  try {
    const session = await requireAdminSession()
    const changedByUserId = session.user.id ?? null

    const { id } = await params
    const body = await parseJsonBody<PatchBody>(request)
    const outcome = body.outcome

    if (!outcome) {
      throw new ValidationError('outcome is required')
    }

    if (!VALID_OUTCOMES.has(outcome)) {
      throw new ValidationError('Invalid outcome. Must be Pending, YES, or NO')
    }

    const question = await db.query.trialQuestions.findFirst({
      where: eq(trialQuestions.id, id),
    })
    const linkedSeason4Markets = await db.query.onchainMarkets.findMany({
      columns: {
        marketSlug: true,
        status: true,
        resolvedOutcome: true,
      },
      where: eq(onchainMarkets.trialQuestionId, id),
    })

    if (!question) {
      throw new NotFoundError('Trial question not found')
    }

    const previousOutcome = question.outcome as PatchBody['outcome']
    const previousOutcomeDate = question.outcomeDate
    const nextOutcomeDate = outcome === 'Pending'
      ? null
      : previousOutcome === outcome
        ? previousOutcomeDate ?? new Date()
        : new Date()

    const resolvedSeason4Markets = linkedSeason4Markets.filter((entry) => entry.status === 'resolved')
    if (resolvedSeason4Markets.length > 0) {
      if (outcome === 'Pending') {
        throw new ValidationError('Season 4 markets cannot be reopened to Pending after onchain resolution.')
      }

      const conflicting = resolvedSeason4Markets.find((entry) => entry.resolvedOutcome && entry.resolvedOutcome !== outcome)
      if (conflicting) {
        throw new ValidationError(`Season 4 market ${conflicting.marketSlug} is already resolved ${conflicting.resolvedOutcome}.`)
      }
    }

    if (outcome !== 'Pending') {
      for (const season4Market of linkedSeason4Markets) {
        if (season4Market.status === 'resolved') continue
        await resolveSeason4Market({
          identifier: season4Market.marketSlug,
          outcome,
        })
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [nextQuestion] = await tx.update(trialQuestions)
        .set({
          outcome,
          outcomeDate: nextOutcomeDate,
          updatedAt: new Date(),
        })
        .where(eq(trialQuestions.id, id))
        .returning()

      await recordTrialQuestionOutcomeHistory({
        dbClient: tx,
        trialQuestionId: id,
        previousOutcome: previousOutcome ?? null,
        previousOutcomeDate,
        nextOutcome: outcome,
        nextOutcomeDate,
        changeSource: 'manual_admin',
        changedByUserId,
      })

      return nextQuestion
    })

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/trials')
    revalidatePath('/admin')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/trials')
    revalidatePath('/admin/base')
    revalidatePath('/admin/oracle')
    revalidatePath('/admin/predictions')
    revalidateSeason4Routes()

    for (const season4Market of linkedSeason4Markets) {
      revalidateSeason4Routes({ marketSlug: season4Market.marketSlug })
    }

    return successResponse(
      { success: true, question: updated },
      {
        headers: {
          'X-Request-Id': requestId,
        },
      },
    )
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update trial question outcome')
  }
}
