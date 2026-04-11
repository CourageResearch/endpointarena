import { and, eq, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, trials, trialQuestions } from '@/lib/db'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { NotFoundError } from '@/lib/errors'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { id } = await params

    const question = await db.query.trialQuestions.findFirst({
      where: eq(trialQuestions.id, id),
    })

    if (!question) {
      throw new NotFoundError('Trial question not found')
    }

    const result = await db.transaction(async (tx) => {
      const siblingRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(trialQuestions)
        .where(and(
          eq(trialQuestions.trialId, question.trialId),
          ne(trialQuestions.id, id),
        ))

      const siblingCount = siblingRows[0]?.count ?? 0

      if (siblingCount === 0) {
        await tx.delete(trials).where(eq(trials.id, question.trialId))
        return { deletedTrialId: question.trialId, deletedQuestionId: id, deletedWholeTrial: true }
      }

      await tx.delete(trialQuestions).where(eq(trialQuestions.id, id))
      return { deletedTrialId: question.trialId, deletedQuestionId: id, deletedWholeTrial: false }
    })

    revalidatePath('/')
    revalidatePath('/trials')
    revalidatePath('/leaderboard')
    revalidatePath('/profile')
    revalidatePath('/admin')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/trials')
    revalidatePath('/admin/markets')
    revalidatePath('/admin/outcomes')
    revalidatePath('/admin/predictions')

    return successResponse(
      {
        success: true,
        ...result,
      },
      {
        headers: {
          'X-Request-Id': requestId,
        },
      },
    )
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to delete drug')
  }
}
