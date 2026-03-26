import { desc, eq, inArray } from 'drizzle-orm'
import { db, predictionMarkets, trialQuestions, trialSyncRunItems, trialSyncRuns } from '@/lib/db'

export async function listRecentTrialSyncRuns(limit: number = 10) {
  return db.query.trialSyncRuns.findMany({
    orderBy: [desc(trialSyncRuns.startedAt)],
    limit,
  })
}

export async function getLatestTrialSyncChangeSet(limit: number = 100) {
  const latestCompletedRun = await db.query.trialSyncRuns.findFirst({
    where: eq(trialSyncRuns.status, 'completed'),
    orderBy: [desc(trialSyncRuns.startedAt)],
  })

  if (!latestCompletedRun) {
    return {
      run: null,
      items: [],
    }
  }

  const items = await db.query.trialSyncRunItems.findMany({
    where: eq(trialSyncRunItems.runId, latestCompletedRun.id),
    orderBy: [desc(trialSyncRunItems.createdAt)],
    limit,
  })

  const trialIds = Array.from(new Set(items.map((item) => item.trialId).filter((value): value is string => Boolean(value))))
  const questions = trialIds.length > 0
    ? await db.query.trialQuestions.findMany({
        where: inArray(trialQuestions.trialId, trialIds),
      })
    : []

  const questionIds = questions.map((question) => question.id)
  const markets = questionIds.length > 0
    ? await db.query.predictionMarkets.findMany({
        where: inArray(predictionMarkets.trialQuestionId, questionIds),
      })
    : []

  const marketIdByTrialId = new Map<string, string | null>()
  const questionByTrialId = new Map(questions.map((question) => [question.trialId, question]))
  for (const trialId of trialIds) {
    const question = questionByTrialId.get(trialId)
    const market = question ? markets.find((entry) => entry.trialQuestionId === question.id) : null
    marketIdByTrialId.set(trialId, market?.id ?? null)
  }

  return {
    run: latestCompletedRun,
    items: items.map((item) => ({
      ...item,
      marketId: item.trialId ? (marketIdByTrialId.get(item.trialId) ?? null) : null,
    })),
  }
}
