import { desc, eq, isNotNull, or } from 'drizzle-orm'
import { db, fdaCalendarEvents, users } from '@/lib/db'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { attachUnifiedPredictionsToEvents, getUnifiedPredictionHistoriesByEventIds, type LeaderboardPredictionMode, selectPredictionFromHistory } from '@/lib/model-decision-snapshots'
import { getGeneratedDisplayName, normalizeDisplayName } from '@/lib/display-name'
import { enrichFdaEvents } from '@/lib/fda-event-metadata'
import { loadOpenMarketActorState } from '@/lib/market-read-model'

export interface ModelLeaderboardEntry {
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

export interface HumanLeaderboardEntry {
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
  const [rawAllEvents, openMarketState, rawRecentDecisionEvents, verifiedUsers] = await Promise.all([
    db.query.fdaCalendarEvents.findMany(),
    loadOpenMarketActorState(),
    db.query.fdaCalendarEvents.findMany({
      where: or(
        eq(fdaCalendarEvents.outcome, 'Approved'),
        eq(fdaCalendarEvents.outcome, 'Rejected')
      ),
      orderBy: [desc(fdaCalendarEvents.outcomeDate)],
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

  const [allEvents, recentDecisionEvents] = await Promise.all([
    enrichFdaEvents(rawAllEvents),
    enrichFdaEvents(rawRecentDecisionEvents),
  ])
  const recentFdaDecisions = await attachUnifiedPredictionsToEvents(recentDecisionEvents)

  const eventOutcomeById = new Map(allEvents.map((event) => [event.id, event.outcome]))
  const historyByEventId = await getUnifiedPredictionHistoriesByEventIds(
    allEvents.map((event) => event.id),
    eventOutcomeById,
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

  for (const event of allEvents) {
    const eventHistory = historyByEventId.get(event.id)
    if (!eventHistory) continue

    for (const [predictorId, history] of eventHistory.entries()) {
      if (!isModelId(predictorId)) continue
      const selected = selectPredictionFromHistory(history, mode)
      if (!selected) continue

      const stats = modelStats.get(predictorId)
      if (!stats) continue

      stats.confidenceSum += selected.confidence
      stats.total++

      const isDecided = event.outcome === 'Approved' || event.outcome === 'Rejected'
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
    recentFdaDecisions,
  }
}
