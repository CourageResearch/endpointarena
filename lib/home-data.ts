import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import { findPredictionByVariant, getModelVariant, type ModelVariant, type ModelId } from '@/lib/constants'

export async function getHomeData() {
  const now = new Date()

  const upcomingFdaEvents = await db.query.fdaCalendarEvents.findMany({
    where: and(
      gte(fdaCalendarEvents.pdufaDate, now),
      eq(fdaCalendarEvents.outcome, 'Pending')
    ),
    with: { predictions: true },
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
    limit: 5,
  })

  const recentFdaDecisions = await db.query.fdaCalendarEvents.findMany({
    where: or(
      eq(fdaCalendarEvents.outcome, 'Approved'),
      eq(fdaCalendarEvents.outcome, 'Rejected')
    ),
    with: { predictions: true },
    orderBy: [desc(fdaCalendarEvents.outcomeDate)],
    limit: 10,
  })

  const allFdaEvents = await db.query.fdaCalendarEvents.findMany()

  const allFdaPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
  })

  const modelStats = new Map<ModelVariant, { correct: number; total: number; pending: number; confidenceSum: number }>()
  const modelVariants: ModelVariant[] = ['claude', 'gpt', 'grok']
  for (const id of modelVariants) {
    modelStats.set(id, { correct: 0, total: 0, pending: 0, confidenceSum: 0 })
  }

  for (const pred of allFdaPredictions) {
    let canonicalId: ModelVariant
    try {
      canonicalId = getModelVariant(pred.predictorId as ModelId)
    } catch {
      continue
    }
    const stats = modelStats.get(canonicalId)
    if (!stats) continue
    stats.confidenceSum += pred.confidence
    if (pred.correct === null) {
      stats.pending++
    } else {
      stats.total++
      if (pred.correct) stats.correct++
    }
  }

  const leaderboard = Array.from(modelStats.entries())
    .map(([id, stats]) => {
      const totalPreds = stats.total + stats.pending
      return {
        id: id as ModelVariant,
        correct: stats.correct,
        total: stats.total,
        pending: stats.pending,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        avgConfidence: totalPreds > 0 ? stats.confidenceSum / totalPreds : 0,
      }
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

  const nextFdaEvent = upcomingFdaEvents[0] || null

  const gridScatterData = recentFdaDecisions.map(event => ({
    id: event.id,
    drugName: event.drugName,
    outcome: event.outcome as 'Approved' | 'Rejected',
    predictions: (['claude', 'gpt', 'grok'] as const).map(variant => {
      const pred = findPredictionByVariant(event.predictions, variant)
      if (!pred) return { model: variant, predicted: null, correct: null }
      return {
        model: variant,
        predicted: pred.prediction as 'approved' | 'rejected',
        correct: pred.correct,
      }
    }),
  }))

  return {
    leaderboard,
    upcomingFdaEvents,
    recentFdaDecisions,
    nextFdaEvent,
    gridScatterData,
    stats: {
      fdaEventsTracked: allFdaEvents.length,
      predictions: allFdaPredictions.length,
      modelsCompared: modelVariants.length,
    },
  }
}

export type HomeData = Awaited<ReturnType<typeof getHomeData>>
