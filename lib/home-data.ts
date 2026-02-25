import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, or, desc, asc } from 'drizzle-orm'
import { findPredictionByVariant, getModelVariant, type ModelVariant, type ModelId } from '@/lib/constants'

function describeDataError(error: unknown): string {
  if (error instanceof AggregateError) {
    const causes = error.errors
      .map((cause) => {
        if (!cause || typeof cause !== 'object') {
          return String(cause)
        }

        const err = cause as Error & { code?: string; address?: string; port?: number }
        const location = err.address && err.port ? `${err.address}:${err.port}` : undefined
        return [err.code, err.message, location].filter(Boolean).join(' ')
      })
      .filter(Boolean)

    if (causes.length > 0) {
      return causes.join('; ')
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown database error'
}

export async function getHomeData() {
  try {
    const upcomingFdaEvents = await db.query.fdaCalendarEvents.findMany({
      // Keep every undecided event on the pending/upcoming section until
      // a final outcome is explicitly set.
      where: eq(fdaCalendarEvents.outcome, 'Pending'),
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
      with: { fdaEvent: true },
    })

    const modelStats = new Map<ModelVariant, { correct: number; total: number; pending: number; confidenceSum: number }>()
    const modelVariants: ModelVariant[] = ['claude', 'gpt', 'grok', 'gemini']
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

      const outcome = pred.fdaEvent?.outcome
      const isDecided = outcome === 'Approved' || outcome === 'Rejected'

      if (!isDecided) {
        stats.pending++
      } else {
        stats.total++
        const isCorrect =
          (pred.prediction === 'approved' && outcome === 'Approved') ||
          (pred.prediction === 'rejected' && outcome === 'Rejected')
        if (isCorrect) stats.correct++
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
      predictions: (['claude', 'gpt', 'grok', 'gemini'] as const).map(variant => {
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
  } catch (error) {
    throw new Error(`Failed to load home page data: ${describeDataError(error)}`)
  }
}

export type HomeData = Awaited<ReturnType<typeof getHomeData>>
