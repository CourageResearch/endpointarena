import { db, fdaCalendarEvents, fdaPredictions, marketAccounts, marketPositions, predictionMarkets } from '@/lib/db'
import { eq, or, desc, asc, inArray } from 'drizzle-orm'
import { MODEL_IDS, findPredictionByModelId, isModelId, type ModelId } from '@/lib/constants'

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

    const [allFdaEvents, allFdaPredictions, accounts, openMarkets] = await Promise.all([
      db.query.fdaCalendarEvents.findMany(),
      db.query.fdaPredictions.findMany({
        where: eq(fdaPredictions.predictorType, 'model'),
        with: { fdaEvent: true },
      }),
      db.query.marketAccounts.findMany(),
      db.query.predictionMarkets.findMany({
        where: eq(predictionMarkets.status, 'OPEN'),
      }),
    ])

    const openMarketIds = openMarkets.map((market) => market.id)
    const positions = openMarketIds.length > 0
      ? await db.query.marketPositions.findMany({
          where: inArray(marketPositions.marketId, openMarketIds),
        })
      : []

    const openMarketById = new Map(openMarkets.map((market) => [market.id, market]))
    const positionsValueByModelId = new Map<ModelId, number>()

    for (const position of positions) {
      const market = openMarketById.get(position.marketId)
      if (!market || !isModelId(position.modelId)) continue

      const markedValue = (position.yesShares * market.priceYes) + (position.noShares * (1 - market.priceYes))
      positionsValueByModelId.set(
        position.modelId,
        (positionsValueByModelId.get(position.modelId) ?? 0) + markedValue
      )
    }

    const accountByModelId = new Map<ModelId, { cashBalance: number }>()
    for (const account of accounts) {
      if (!isModelId(account.modelId)) continue
      accountByModelId.set(account.modelId, { cashBalance: account.cashBalance })
    }

    const modelStats = new Map<ModelId, { correct: number; total: number; pending: number; confidenceSum: number }>()
    for (const id of MODEL_IDS) {
      modelStats.set(id, { correct: 0, total: 0, pending: 0, confidenceSum: 0 })
    }

    for (const pred of allFdaPredictions) {
      if (!isModelId(pred.predictorId)) continue
      const stats = modelStats.get(pred.predictorId)
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
        const account = accountByModelId.get(id)
        const positionsValue = positionsValueByModelId.get(id) ?? 0
        return {
          id,
          correct: stats.correct,
          total: stats.total,
          pending: stats.pending,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
          avgConfidence: totalPreds > 0 ? stats.confidenceSum / totalPreds : 0,
          totalEquity: account ? account.cashBalance + positionsValue : null,
        }
      })
      .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

    const moneyLeaderboard = [...leaderboard].sort((a, b) => {
      const aEquity = a.totalEquity ?? Number.NEGATIVE_INFINITY
      const bEquity = b.totalEquity ?? Number.NEGATIVE_INFINITY
      if (aEquity !== bEquity) return bEquity - aEquity
      if (a.accuracy !== b.accuracy) return b.accuracy - a.accuracy
      return b.correct - a.correct
    })

    const nextFdaEvent = upcomingFdaEvents[0] || null

    const gridScatterData = recentFdaDecisions.map((event) => ({
      id: event.id,
      drugName: event.drugName,
      outcome: event.outcome as 'Approved' | 'Rejected',
      predictions: MODEL_IDS.map((modelId) => {
        const pred = findPredictionByModelId(event.predictions, modelId)
        if (!pred) return { model: modelId, predicted: null, correct: null }
        return {
          model: modelId,
          predicted: pred.prediction as 'approved' | 'rejected',
          correct: pred.correct,
        }
      }),
    }))

    return {
      leaderboard,
      moneyLeaderboard,
      upcomingFdaEvents,
      recentFdaDecisions,
      nextFdaEvent,
      gridScatterData,
      stats: {
        fdaEventsTracked: allFdaEvents.length,
        predictions: allFdaPredictions.length,
        modelsCompared: MODEL_IDS.length,
      },
    }
  } catch (error) {
    throw new Error(`Failed to load home page data: ${describeDataError(error)}`)
  }
}

export type HomeData = Awaited<ReturnType<typeof getHomeData>>
