import { asc, inArray } from 'drizzle-orm'
import { db, phase2Trials, predictionMarkets, trialQuestions } from '@/lib/db'
import type { AdminTrialEvent } from '@/components/admin/trial-manager-utils'
import type { ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import { estimateAdminAiRowCosts } from '@/lib/admin-ai-row-costs'

export async function getTrialAdminData(): Promise<AdminTrialEvent[]> {
  const [rawQuestions, markets] = await Promise.all([
    db.query.trialQuestions.findMany({
      orderBy: [asc(trialQuestions.sortOrder), asc(trialQuestions.createdAt)],
    }),
    db.query.predictionMarkets.findMany(),
  ])
  const questions = filterSupportedTrialQuestions(rawQuestions)

  const trialIds = Array.from(new Set(questions.map((question) => question.trialId)))
  const trials = trialIds.length > 0
    ? await db.query.phase2Trials.findMany({
        where: inArray(phase2Trials.id, trialIds),
        orderBy: [asc(phase2Trials.estPrimaryCompletionDate), asc(phase2Trials.shortTitle)],
      })
    : []

  const trialById = new Map(trials.map((trial) => [trial.id, trial]))
  const marketByQuestionId = new Map(
    markets
      .filter((market) => market.trialQuestionId)
      .map((market) => [market.trialQuestionId as string, market]),
  )

  const events: AdminTrialEvent[] = []

  for (const question of questions) {
    const trial = trialById.get(question.trialId)
    if (!trial) continue

    const market = marketByQuestionId.get(question.id)
    const marketStatus: 'OPEN' | 'RESOLVED' | null = market?.status === 'OPEN' || market?.status === 'RESOLVED'
      ? market.status
      : null

    const normalizedQuestionPrompt = normalizeTrialQuestionPrompt(question.prompt)
    const estimatedModelRunCosts: Partial<Record<ModelId, number>> = market
      ? Object.fromEntries(
          Object.entries(estimateAdminAiRowCosts({
            marketId: market.id,
            trialId: trial.id,
            trialQuestionId: question.id,
            questionPrompt: normalizedQuestionPrompt,
            marketPriceYes: market.priceYes,
            trial: {
              shortTitle: trial.shortTitle,
              sponsorName: trial.sponsorName,
              sponsorTicker: trial.sponsorTicker ?? null,
              exactPhase: trial.exactPhase,
              estPrimaryCompletionDate: trial.estPrimaryCompletionDate,
              indication: trial.indication,
              intervention: trial.intervention,
              primaryEndpoint: trial.primaryEndpoint,
              currentStatus: trial.currentStatus,
              briefSummary: trial.briefSummary,
              nctNumber: trial.nctNumber,
            },
          })).map(([modelId, estimate]) => [modelId, estimate?.estimatedCostUsd ?? 0]),
        ) as Partial<Record<ModelId, number>>
      : {}

    events.push({
      id: question.id,
      trialId: trial.id,
      trialQuestionId: question.id,
      questionSlug: question.slug,
      questionPrompt: normalizedQuestionPrompt,
      shortTitle: trial.shortTitle,
      sponsorName: trial.sponsorName,
      sponsorTicker: trial.sponsorTicker ?? '',
      nctNumber: trial.nctNumber,
      decisionDate: trial.estPrimaryCompletionDate.toISOString(),
      outcome: question.outcome,
      questionStatus: question.status as 'live' | 'coming_soon',
      isBettable: question.isBettable,
      marketId: market?.id ?? null,
      marketStatus,
      marketPriceYes: market?.priceYes ?? null,
      marketOpenedAt: market?.openedAt?.toISOString() ?? null,
      estimatedModelRunCosts,
    })
  }

  return events.sort((a, b) => {
    const aTime = new Date(a.decisionDate).getTime()
    const bTime = new Date(b.decisionDate).getTime()
    if (aTime !== bTime) return aTime - bTime
    if (a.shortTitle !== b.shortTitle) return a.shortTitle.localeCompare(b.shortTitle)
    return a.questionPrompt.localeCompare(b.questionPrompt)
  })
}

export function getTrialAdminStats(events: AdminTrialEvent[]) {
  const openMarketEvents = events.filter((event) => event.marketStatus === 'OPEN')
  const liveQuestionEvents = events.filter((event) => event.questionStatus === 'live')
  const openMarketsNeedingReview = openMarketEvents.filter((event) => {
    const daysUntil = getDaysUntilUtc(event.decisionDate)
    return daysUntil !== null && daysUntil <= 0
  }).length

  return {
    openMarkets: openMarketEvents.length,
    resolvedMarkets: events.filter((event) => event.marketStatus === 'RESOLVED').length,
    pendingWithoutMarket: events.filter((event) => event.outcome === 'Pending' && event.marketStatus === null).length,
    pendingWithMarket: events.filter((event) => event.outcome === 'Pending' && event.marketStatus === 'OPEN').length,
    liveQuestions: liveQuestionEvents.length,
    liveQuestionsWithMarket: liveQuestionEvents.filter((event) => event.marketStatus !== null).length,
    openMarketsNeedingReview,
    upcomingOpenMarkets: Math.max(openMarketEvents.length - openMarketsNeedingReview, 0),
  }
}
