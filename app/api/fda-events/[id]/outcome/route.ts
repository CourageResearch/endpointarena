import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db, fdaCalendarEvents } from '@/lib/db'
import { ensureAdmin } from '@/lib/auth'
import { reopenMarketForEvent, resolveMarketForEvent } from '@/lib/markets/engine'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { enrichFdaEvents, upsertEventExternalId, upsertEventPrimarySource } from '@/lib/fda-event-metadata'

type PatchBody = {
  outcome?: 'Pending' | 'Approved' | 'Rejected'
  source?: string | null
  nctId?: string | null
  pdufaDate?: string
  applicationType?: string
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
    const { outcome, source, nctId, pdufaDate, applicationType } = body

    if (!outcome && source === undefined && nctId === undefined && pdufaDate === undefined && applicationType === undefined) {
      throw new ValidationError('Must provide outcome, source, nctId, pdufaDate, or applicationType')
    }

    if (outcome && !VALID_OUTCOMES.has(outcome)) {
      throw new ValidationError('Invalid outcome. Must be Pending, Approved, or Rejected')
    }

    let parsedPdufaDate: Date | undefined
    if (pdufaDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pdufaDate)) {
        throw new ValidationError('Invalid pdufaDate. Must use YYYY-MM-DD')
      }

      parsedPdufaDate = new Date(`${pdufaDate}T00:00:00.000Z`)
      if (Number.isNaN(parsedPdufaDate.getTime())) {
        throw new ValidationError('Invalid pdufaDate. Must be a real date')
      }
    }

    const normalizedApplicationType = applicationType?.trim()
    if (applicationType !== undefined && !normalizedApplicationType) {
      throw new ValidationError('Application type cannot be empty')
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
    if (parsedPdufaDate) {
      updateData.pdufaDate = parsedPdufaDate
    }
    if (normalizedApplicationType) {
      updateData.applicationType = normalizedApplicationType
    }

    const [updated] = await db.update(fdaCalendarEvents)
      .set(updateData)
      .where(eq(fdaCalendarEvents.id, id))
      .returning()

    if (source !== undefined) {
      await upsertEventPrimarySource(id, source ?? null)
    }
    if (nctId !== undefined) {
      await upsertEventExternalId(id, 'nct', nctId ?? null)
    }

    if (outcome) {
      if (outcome !== 'Pending') {
        await resolveMarketForEvent(id, outcome)
      } else {
        await reopenMarketForEvent(id)
      }
    }

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/fda-calendar')
    revalidatePath('/markets')
    revalidatePath('/admin')
    revalidatePath('/admin/markets')
    revalidatePath('/admin/metadata')
    revalidatePath('/admin/predictions')

    const [enrichedUpdated] = await enrichFdaEvents(updated ? [updated] : [])

    return successResponse(
      { success: true, event: enrichedUpdated ?? updated },
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
