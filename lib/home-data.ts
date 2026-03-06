import { db, fdaCalendarEvents, marketAccounts, marketPositions, predictionMarkets } from '@/lib/db'
import { eq, or, desc, asc, inArray } from 'drizzle-orm'
import { MODEL_IDS, findPredictionByModelId, isModelId, type ModelId } from '@/lib/constants'
import { attachUnifiedPredictionsToEvents, getUnifiedPredictionHistoriesByEventIds, selectPredictionFromHistory } from '@/lib/model-decision-snapshots'

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
    const [upcomingEvents, recentDecisionEvents, allFdaEvents, accounts, openMarkets] = await Promise.all([
      db.query.fdaCalendarEvents.findMany({
        where: eq(fdaCalendarEvents.outcome, 'Pending'),
        orderBy: [asc(fdaCalendarEvents.pdufaDate)],
        limit: 5,
      }),
      db.query.fdaCalendarEvents.findMany({
        where: or(
          eq(fdaCalendarEvents.outcome, 'Approved'),
          eq(fdaCalendarEvents.outcome, 'Rejected')
        ),
        orderBy: [desc(fdaCalendarEvents.outcomeDate)],
        limit: 10,
      }),
      db.query.fdaCalendarEvents.findMany(),
      db.query.marketAccounts.findMany(),
      db.query.predictionMarkets.findMany({
        where: eq(predictionMarkets.status, 'OPEN'),
      }),
    ])

    const [upcomingFdaEvents, recentFdaDecisions] = await Promise.all([
      attachUnifiedPredictionsToEvents(upcomingEvents),
      attachUnifiedPredictionsToEvents(recentDecisionEvents),
    ])

    const eventOutcomeById = new Map(allFdaEvents.map((event) => [event.id, event.outcome]))
    const historyByEventId = await getUnifiedPredictionHistoriesByEventIds(
      allFdaEvents.map((event) => event.id),
      eventOutcomeById,
    )

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

    let totalPredictionHistoryEntries = 0
    for (const event of allFdaEvents) {
      const eventHistory = historyByEventId.get(event.id)
      if (!eventHistory) continue

      for (const [predictorId, history] of eventHistory.entries()) {
        if (!isModelId(predictorId)) continue
        totalPredictionHistoryEntries += history.length

        const selected = selectPredictionFromHistory(history, 'final')
        if (!selected) continue

        const stats = modelStats.get(predictorId)
        if (!stats) continue

        stats.confidenceSum += selected.confidence

        const isDecided = event.outcome === 'Approved' || event.outcome === 'Rejected'
        if (!isDecided) {
          stats.pending++
        } else {
          stats.total++
          if (selected.correct) stats.correct++
        }
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
        predictions: totalPredictionHistoryEntries,
        modelsCompared: MODEL_IDS.length,
      },
    }
  } catch (error) {
    throw new Error(`Failed to load home page data: ${describeDataError(error)}`)
  }
}

export type HomeData = Awaited<ReturnType<typeof getHomeData>>
