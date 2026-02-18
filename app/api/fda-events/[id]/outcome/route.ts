import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Check admin authorization
  const authError = await requireAdmin()
  if (authError) return authError

  const { id } = await params
  const body = await request.json()
  const { outcome, source, nctId } = body

  // Allow field-only updates (no outcome required)
  if (!outcome && source === undefined && nctId === undefined) {
    return new Response(JSON.stringify({ error: 'Must provide outcome, source, or nctId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (outcome && !['Pending', 'Approved', 'Rejected'].includes(outcome)) {
    return new Response(JSON.stringify({ error: 'Invalid outcome. Must be Pending, Approved, or Rejected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get the event
  const event = await db.query.fdaCalendarEvents.findFirst({
    where: eq(fdaCalendarEvents.id, id),
  })

  if (!event) {
    return new Response(JSON.stringify({ error: 'FDA event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Build the update payload
  const updateData: Record<string, any> = { updatedAt: new Date() }
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

  // Update the event
  const [updated] = await db.update(fdaCalendarEvents)
    .set(updateData)
    .where(eq(fdaCalendarEvents.id, id))
    .returning()

  // If outcome was changed, update prediction correctness
  if (outcome) {
    if (outcome !== 'Pending') {
      const predictions = await db.query.fdaPredictions.findMany({
        where: eq(fdaPredictions.fdaEventId, id),
      })

      for (const pred of predictions) {
        const isCorrect = (pred.prediction === 'approved' && outcome === 'Approved') ||
                          (pred.prediction === 'rejected' && outcome === 'Rejected')

        await db.update(fdaPredictions)
          .set({ correct: isCorrect })
          .where(eq(fdaPredictions.id, pred.id))
      }
    } else {
      // Reset prediction correctness if outcome is set back to Pending
      await db.update(fdaPredictions)
        .set({ correct: null })
        .where(eq(fdaPredictions.fdaEventId, id))
    }
  }

  return new Response(JSON.stringify({ success: true, event: updated }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
