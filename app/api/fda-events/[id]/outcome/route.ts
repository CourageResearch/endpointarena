import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { ensureAdmin } from '@/lib/auth'
import { reopenMarketForEvent, resolveMarketForEvent } from '@/lib/markets/engine'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'

type PatchBody = {
  outcome?: 'Pending' | 'Approved' | 'Rejected'
  source?: string | null
  nctId?: string | null
}

const VALID_OUTCOMES = new Set(['Pending', 'Approved', 'Rejected'])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { id } = await params
    const body = await parseJsonBody<PatchBody>(request)
    const { outcome, source, nctId } = body

    if (!outcome && source === undefined && nctId === undefined) {
      throw new ValidationError('Must provide outcome, source, or nctId')
    }

    if (outcome && !VALID_OUTCOMES.has(outcome)) {
      throw new ValidationError('Invalid outcome. Must be Pending, Approved, or Rejected')
    }

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, id),
    })

    if (!event) {
      throw new NotFoundError('FDA event not found')
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (outcome) {
      updateData.outcome = outcome
      updateData.outcomeDate = outcome !== 'Pending' ? new Date() : null
    }
    if (source !== undefined) {
      updateData.source = source
    }
    if (nctId !== undefined) {
      updateData.nctId = nctId
    }

    const [updated] = await db.update(fdaCalendarEvents)
      .set(updateData)
      .where(eq(fdaCalendarEvents.id, id))
      .returning()

    if (outcome) {
      if (outcome !== 'Pending') {
        const predictions = await db.query.fdaPredictions.findMany({
          where: eq(fdaPredictions.fdaEventId, id),
        })

        for (const prediction of predictions) {
          const isCorrect =
            (prediction.prediction === 'approved' && outcome === 'Approved') ||
            (prediction.prediction === 'rejected' && outcome === 'Rejected')

          await db.update(fdaPredictions)
            .set({ correct: isCorrect })
            .where(eq(fdaPredictions.id, prediction.id))
        }

        await resolveMarketForEvent(id, outcome)
      } else {
        await db.update(fdaPredictions)
          .set({ correct: null })
          .where(eq(fdaPredictions.fdaEventId, id))

        await reopenMarketForEvent(id)
      }
    }

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/fda-calendar')
    revalidatePath('/markets')
    revalidatePath('/admin')
    revalidatePath('/admin/markets')

    return successResponse(
      { success: true, event: updated },
      {
        headers: {
          'X-Request-Id': requestId,
        },
      }
    )
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update FDA event')
  }
}

