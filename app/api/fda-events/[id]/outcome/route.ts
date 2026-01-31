import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { outcome } = body

  if (!outcome || !['Pending', 'Approved', 'Rejected'].includes(outcome)) {
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

  // Update the event outcome
  const [updated] = await db.update(fdaCalendarEvents)
    .set({
      outcome,
      outcomeDate: outcome !== 'Pending' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(fdaCalendarEvents.id, id))
    .returning()

  // If outcome is set (not Pending), update prediction correctness
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

  return new Response(JSON.stringify({ success: true, event: updated }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
