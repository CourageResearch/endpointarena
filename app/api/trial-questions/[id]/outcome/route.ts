import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db, predictionMarkets, trialQuestions } from '@/lib/db'
import { ensureAdmin } from '@/lib/auth'
import { reopenMarketForTrialQuestion, resolveMarketForTrialQuestion } from '@/lib/markets/engine'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'

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
    await ensureAdmin()

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
    const market = await db.query.predictionMarkets.findFirst({
      where: eq(predictionMarkets.trialQuestionId, id),
      columns: {
        id: true,
      },
    })

    if (!question) {
      throw new NotFoundError('Trial question not found')
    }

    const updated = await db.transaction(async (tx) => {
      const [nextQuestion] = await tx.update(trialQuestions)
        .set({
          outcome,
          outcomeDate: outcome === 'Pending' ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(trialQuestions.id, id))
        .returning()

      if (outcome === 'Pending') {
        await reopenMarketForTrialQuestion(id, tx)
      } else {
        await resolveMarketForTrialQuestion(id, outcome, tx)
      }

      return nextQuestion
    })

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/trials')
    revalidatePath('/admin')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/markets')
    revalidatePath('/admin/outcomes')
    revalidatePath('/admin/predictions')

    if (market?.id) {
      revalidatePath(`/trials/${market.id}`)
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
