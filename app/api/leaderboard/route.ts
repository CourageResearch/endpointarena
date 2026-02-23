import { NextResponse } from 'next/server'
import { db, fdaPredictions } from '@/lib/db'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
    with: { fdaEvent: true },
  })

  const predictorStats = new Map<string, { correct: number; total: number; type: string }>()

  for (const pred of allPredictions) {
    const outcome = pred.fdaEvent?.outcome
    const isDecided = outcome === 'Approved' || outcome === 'Rejected'
    if (!isDecided) continue

    const isCorrect =
      (pred.prediction === 'approved' && outcome === 'Approved') ||
      (pred.prediction === 'rejected' && outcome === 'Rejected')

    const key = pred.predictorId
    const current = predictorStats.get(key) || { correct: 0, total: 0, type: pred.predictorType }
    current.total++
    if (isCorrect) current.correct++
    predictorStats.set(key, current)
  }

  const entries = Array.from(predictorStats.entries())
    .map(([id, stats]) => ({
      predictorId: id,
      predictorType: stats.type,
      totalPredictions: stats.total,
      correctPredictions: stats.correct,
      accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((entry, i) => ({ ...entry, rank: i + 1 }))

  return NextResponse.json(entries)
}
