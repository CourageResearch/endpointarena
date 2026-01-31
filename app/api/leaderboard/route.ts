import { NextResponse } from 'next/server'
import { db, fdaPredictions } from '@/lib/db'
import { isNotNull } from 'drizzle-orm'

export async function GET() {
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: isNotNull(fdaPredictions.correct),
  })

  const predictorStats = new Map<string, { correct: number; total: number; type: string }>()

  for (const pred of allPredictions) {
    const key = pred.predictorId
    const current = predictorStats.get(key) || { correct: 0, total: 0, type: pred.predictorType }
    current.total++
    if (pred.correct) current.correct++
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
