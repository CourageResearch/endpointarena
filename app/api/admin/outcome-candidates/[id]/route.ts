import { and, eq, ne } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authOptions, ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { db, eventOutcomeCandidates, fdaCalendarEvents } from '@/lib/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveMarketForEvent } from '@/lib/markets/engine'

type PatchBody = {
  action: 'accept' | 'reject' | 'supersede'
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
    const { action, reviewNotes } = body

    if (action !== 'accept' && action !== 'reject' && action !== 'supersede') {
      throw new ValidationError('action must be accept, reject, or supersede')
    }

    const candidate = await db.query.eventOutcomeCandidates.findFirst({
      where: eq(eventOutcomeCandidates.id, id),
    })

    if (!candidate) {
      throw new NotFoundError('Outcome candidate not found')
    }

    if (candidate.status !== 'pending_review') {
      throw new ConflictError(`Outcome candidate is already ${candidate.status}`)
    }

    const now = new Date()
    const normalizedReviewNotes = normalizeReviewNotes(reviewNotes)

    if (action === 'accept') {
      await db.transaction(async (tx) => {
        await tx.update(fdaCalendarEvents)
          .set({
            outcome: candidate.proposedOutcome,
            outcomeDate: candidate.proposedOutcomeDate ?? now,
            updatedAt: now,
          })
          .where(eq(fdaCalendarEvents.id, candidate.eventId))

        await tx.update(eventOutcomeCandidates)
          .set({
            status: 'accepted',
            reviewedByUserId: reviewerId,
            reviewNotes: normalizedReviewNotes,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(eventOutcomeCandidates.id, candidate.id))

        await tx.update(eventOutcomeCandidates)
          .set({
            status: 'superseded',
            reviewedByUserId: reviewerId,
            reviewNotes: `Superseded after accepting candidate ${candidate.id}.`,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(eventOutcomeCandidates.eventId, candidate.eventId),
            eq(eventOutcomeCandidates.status, 'pending_review'),
            ne(eventOutcomeCandidates.id, candidate.id),
          ))
      })

      await resolveMarketForEvent(candidate.eventId, candidate.proposedOutcome as 'Approved' | 'Rejected')
    } else {
      await db.update(eventOutcomeCandidates)
        .set({
          status: action === 'reject' ? 'rejected' : 'superseded',
          reviewedByUserId: reviewerId,
          reviewNotes: normalizedReviewNotes,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(eventOutcomeCandidates.id, candidate.id))
    }

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/markets')
    revalidatePath('/fda-calendar')
    revalidatePath('/admin/markets')
    revalidatePath('/admin/outcomes')

    return successResponse({ success: true }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update outcome candidate')
  }
}
