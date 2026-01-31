import { db, fdaPredictions, users } from './db'
import { eq, isNotNull, sql } from 'drizzle-orm'

export async function scoreFdaPredictions(fdaEventId: string, outcome: 'Approved' | 'Rejected') {
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.fdaEventId, fdaEventId),
  })

  const isApproved = outcome === 'Approved'

  for (const prediction of allPredictions) {
    const correct = (prediction.prediction === 'approved') === isApproved

    await db.update(fdaPredictions)
      .set({ correct })
      .where(eq(fdaPredictions.id, prediction.id))

    if (prediction.predictorType === 'user' && correct) {
      await db.update(users)
        .set({ correctPreds: sql`${users.correctPreds} + 1` })
        .where(eq(users.email, prediction.predictorId))
    }
  }
}

export async function calculateLeaderboard() {
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: isNotNull(fdaPredictions.correct),
  })

  const stats = new Map<string, { correct: number; total: number; type: string }>()

  for (const pred of allPredictions) {
    const current = stats.get(pred.predictorId) || { correct: 0, total: 0, type: pred.predictorType }
    current.total++
    if (pred.correct) current.correct++
    stats.set(pred.predictorId, current)
  }

  return Array.from(stats.entries())
    .map(([id, data]) => ({
      predictorId: id,
      predictorType: data.type,
      totalPredictions: data.total,
      correctPredictions: data.correct,
      accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((entry, i) => ({ ...entry, rank: i + 1 }))
}
