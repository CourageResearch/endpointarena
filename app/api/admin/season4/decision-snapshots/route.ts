import { desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { db, modelDecisionSnapshots, trialQuestions } from '@/lib/db'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { isSupportedTrialQuestionSlug } from '@/lib/trial-questions'

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { searchParams } = new URL(request.url)
    const trialQuestionId = searchParams.get('trialQuestionId')
    if (!trialQuestionId) {
      throw new ValidationError('trialQuestionId is required')
    }

    const question = await db.query.trialQuestions.findFirst({
      where: eq(trialQuestions.id, trialQuestionId),
      with: {
        trial: true,
      },
    })
    if (!question) {
      throw new NotFoundError('Trial question not found')
    }

    if (!isSupportedTrialQuestionSlug(question.slug)) {
      throw new ValidationError('This question type has been removed from active trials.')
    }

    const snapshots = await db.query.modelDecisionSnapshots.findMany({
      where: eq(modelDecisionSnapshots.trialQuestionId, trialQuestionId),
      orderBy: [desc(modelDecisionSnapshots.createdAt)],
    })

    return successResponse({ snapshots, question }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch season 4 decision snapshots')
  }
}
