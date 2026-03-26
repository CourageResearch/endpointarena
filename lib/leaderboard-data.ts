import { desc, isNotNull } from 'drizzle-orm'
import { db, trialQuestions, users } from '@/lib/db'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { getUnifiedPredictionHistoriesByEventIds, type LeaderboardPredictionMode, selectPredictionFromHistory } from '@/lib/model-decision-snapshots'
import { getGeneratedDisplayName, normalizeDisplayName } from '@/lib/display-name'
import { loadOpenMarketActorState } from '@/lib/market-read-model'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

interface ModelLeaderboardEntry {
  id: ModelId
  correct: number
  wrong: number
  pending: number
  decided: number
  total: number
  accuracy: number
  avgConfidence: number
  avgConfidenceCorrect: number
  avgConfidenceWrong: number
  totalEquity: number | null
  pnl: number | null
}

interface HumanLeaderboardEntry {
  userId: string
  displayName: string
  cashBalance: number
  positionsValue: number
  startingCash: number
  totalEquity: number
  pnl: number
}

interface ModelStats {
  correct: number
  wrong: number
  pending: number
  confidenceSum: number
  confidenceCorrectSum: number
  confidenceWrongSum: number
  total: number
}

export async function getLeaderboardData(mode: LeaderboardPredictionMode) {
  const [rawAllQuestions, openMarketState, rawRecentResolvedQuestions, verifiedUsers] = await Promise.all([
    db.query.trialQuestions.findMany({
      with: {
        trial: true,
      },
    }),
    loadOpenMarketActorState(),
    db.query.trialQuestions.findMany({
      where: isNotNull(trialQuestions.outcomeDate),
      with: {
        trial: true,
      },
      orderBy: [desc(trialQuestions.outcomeDate)],
      limit: 10,
    }),
    db.query.users.findMany({
      where: isNotNull(users.tweetVerifiedAt),
      columns: {
        id: true,
        name: true,
        email: true,
      },
    }),
  ])
  const allQuestions = filterSupportedTrialQuestions(rawAllQuestions)
  const recentResolvedQuestions = filterSupportedTrialQuestions(rawRecentResolvedQuestions)

  const questionOutcomeById = new Map(allQuestions.map((question) => [question.id, question.outcome]))
  const historyByQuestionId = await getUnifiedPredictionHistoriesByEventIds(
    allQuestions.map((question) => question.id),
    questionOutcomeById,
  )

  const modelStats = new Map<ModelId, ModelStats>()
  for (const id of MODEL_IDS) {
    modelStats.set(id, {
      correct: 0,
      wrong: 0,
      pending: 0,
      confidenceSum: 0,
      confidenceCorrectSum: 0,
      confidenceWrongSum: 0,
      total: 0,
    })
  }

  for (const question of allQuestions) {
    const questionHistory = historyByQuestionId.get(question.id)
    if (!questionHistory) continue

    for (const [predictorId, history] of questionHistory.entries()) {
      if (!isModelId(predictorId)) continue
      const selected = selectPredictionFromHistory(history, mode)
      if (!selected) continue

      const stats = modelStats.get(predictorId)
      if (!stats) continue

      stats.confidenceSum += selected.confidence
      stats.total++

      const isDecided = question.outcome === 'YES' || question.outcome === 'NO'
      if (!isDecided) {
        stats.pending++
        continue
      }

      if (selected.correct) {
        stats.correct++
        stats.confidenceCorrectSum += selected.confidence
      } else {
        stats.wrong++
        stats.confidenceWrongSum += selected.confidence
      }
    }
  }

  const leaderboard: ModelLeaderboardEntry[] = Array.from(modelStats.entries())
    .map(([id, stats]) => {
      const account = openMarketState.accountMaps.byModelKey.get(id)
      const decided = stats.correct + stats.wrong
      const positionsValue = account ? (openMarketState.positionsValueByActorId.get(account.actorId) ?? 0) : 0
      return {
        id,
        correct: stats.correct,
        wrong: stats.wrong,
        pending: stats.pending,
        decided,
        total: stats.total,
        accuracy: decided > 0 ? (stats.correct / decided) * 100 : 0,
        avgConfidence: stats.total > 0 ? stats.confidenceSum / stats.total : 0,
        avgConfidenceCorrect: stats.correct > 0 ? stats.confidenceCorrectSum / stats.correct : 0,
        avgConfidenceWrong: stats.wrong > 0 ? stats.confidenceWrongSum / stats.wrong : 0,
        totalEquity: account ? account.cashBalance + positionsValue : null,
        pnl: account ? (account.cashBalance + positionsValue - account.startingCash) : null,
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

  const humanLeaderboard: HumanLeaderboardEntry[] = verifiedUsers
    .map((user) => {
      const account = openMarketState.accountMaps.byUserId.get(user.id)
      const cashBalance = account?.cashBalance ?? 0
      const positionsValue = account ? (openMarketState.positionsValueByActorId.get(account.actorId) ?? 0) : 0
      const startingCash = account?.startingCash ?? 0
      const totalEquity = cashBalance + positionsValue
      const pnl = totalEquity - startingCash
      const normalizedName = normalizeDisplayName(user.name)

      return {
        userId: user.id,
        displayName: normalizedName ?? getGeneratedDisplayName(user.email || user.id),
        cashBalance,
        positionsValue,
        startingCash,
        totalEquity,
        pnl,
      }
    })
    .sort((a, b) => {
      if (a.totalEquity !== b.totalEquity) return b.totalEquity - a.totalEquity
      if (a.pnl !== b.pnl) return b.pnl - a.pnl
      const byName = a.displayName.localeCompare(b.displayName, 'en-US', { sensitivity: 'base' })
      if (byName !== 0) return byName
      return a.userId.localeCompare(b.userId)
    })

  return {
    leaderboard,
    moneyLeaderboard,
    humanLeaderboard,
    recentResolvedQuestions: recentResolvedQuestions.map((question) => ({
      id: question.id,
      prompt: normalizeTrialQuestionPrompt(question.prompt),
      outcome: question.outcome,
      outcomeDate: question.outcomeDate?.toISOString() ?? null,
      trial: {
        shortTitle: question.trial.shortTitle,
        sponsorName: question.trial.sponsorName,
        sponsorTicker: question.trial.sponsorTicker,
        exactPhase: question.trial.exactPhase,
        estPrimaryCompletionDate: question.trial.estPrimaryCompletionDate.toISOString(),
      },
    })),
  }
}
