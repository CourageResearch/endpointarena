import { db, trialQuestions } from '@/lib/db'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { getUnifiedPredictionHistoriesByEventIds, selectPredictionFromHistory } from '@/lib/model-decision-snapshots'
import { loadOpenMarketActorState } from '@/lib/market-read-model'
import { filterSupportedTrialQuestions } from '@/lib/trial-questions'

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
    const [rawQuestions, openMarketState] = await Promise.all([
      db.query.trialQuestions.findMany(),
      loadOpenMarketActorState(),
    ])
    const questions = filterSupportedTrialQuestions(rawQuestions)

    const questionOutcomeById = new Map(questions.map((question) => [question.id, question.outcome]))
    const historyByQuestionId = await getUnifiedPredictionHistoriesByEventIds(
      questions.map((question) => question.id),
      questionOutcomeById,
    )

    const modelStats = new Map<ModelId, { correct: number; total: number; pending: number; confidenceSum: number }>()
    for (const id of MODEL_IDS) {
      modelStats.set(id, { correct: 0, total: 0, pending: 0, confidenceSum: 0 })
    }

    let totalPredictionHistoryEntries = 0
    for (const question of questions) {
      const questionHistory = historyByQuestionId.get(question.id)
      if (!questionHistory) continue

      for (const [predictorId, history] of questionHistory.entries()) {
        if (!isModelId(predictorId)) continue
        totalPredictionHistoryEntries += history.length

        const selected = selectPredictionFromHistory(history, 'final')
        if (!selected) continue

        const stats = modelStats.get(predictorId)
        if (!stats) continue

        stats.confidenceSum += selected.confidence

        const isDecided = question.outcome === 'YES' || question.outcome === 'NO'
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
        const account = openMarketState.accountMaps.byModelKey.get(id)
        const positionsValue = account ? (openMarketState.positionsValueByActorId.get(account.actorId) ?? 0) : 0
        return {
          id,
          correct: stats.correct,
          total: stats.total,
          pending: stats.pending,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
          avgConfidence: (stats.total + stats.pending) > 0 ? stats.confidenceSum / (stats.total + stats.pending) : 0,
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

    return {
      leaderboard,
      moneyLeaderboard,
      gridScatterData: [],
      stats: {
        fdaEventsTracked: questions.length,
        predictions: totalPredictionHistoryEntries,
        modelsCompared: MODEL_IDS.length,
      },
    }
  } catch (error) {
    throw new Error(`Failed to load home page data: ${describeDataError(error)}`)
  }
}

export type HomeData = Awaited<ReturnType<typeof getHomeData>>
