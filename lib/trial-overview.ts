import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import {
  db,
  marketActions,
  marketDailySnapshots,
  marketPriceSnapshots,
  marketRuns,
  trialOutcomeCandidates,
  trialQuestions,
} from '@/lib/db'
import {
  getResolvedTrialOutcome,
  isMarketClosedToTrading,
  type MarketResolutionRow,
  type OverviewResponse,
} from '@/lib/markets/overview-shared'
import { getMarketDecisionHistoryByMarketIds } from '@/lib/model-decision-snapshots'
import type { ModelDecisionSnapshot, PredictionHistoryEntry } from '@/lib/types'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import {
  buildLatestModelActionByMarketActor,
  buildMarketActorKey,
  loadOpenMarketActorState,
  toModelId,
} from '@/lib/market-read-model'
import { isMockMarketActionLike } from '@/lib/mock-market-data'

function toRunStatus(value: string): OverviewResponse['recentRuns'][number]['status'] {
  if (value === 'running' || value === 'completed' || value === 'failed') {
    return value
  }
  return 'failed'
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function toDecisionSnapshot(entry: PredictionHistoryEntry, marketId: string, ownerId: string): ModelDecisionSnapshot {
  return {
    id: entry.id,
    eventId: ownerId,
    trialQuestionId: ownerId,
    marketId,
    modelId: entry.predictorId,
    source: entry.source ?? 'snapshot',
    runSource: entry.runSource,
    createdAt: entry.createdAt,
    linkedMarketActionId: entry.linkedMarketActionId ?? null,
    forecast: {
      approvalProbability: entry.approvalProbability ?? entry.yesProbability ?? (entry.prediction === 'yes' ? 1 : 0),
      yesProbability: entry.yesProbability ?? entry.approvalProbability ?? (entry.prediction === 'yes' ? 1 : 0),
      binaryCall: entry.prediction,
      confidence: entry.confidence,
      reasoning: entry.reasoning,
    },
    action: entry.action ?? null,
  }
}

export async function getTrialsOverviewData(input: {
  marketId?: string | null
  includeResolved?: boolean
  includeAccounts?: boolean
  includeEquityHistory?: boolean
  includeRecentRuns?: boolean
} = {}): Promise<OverviewResponse> {
  const includeAccounts = input.includeAccounts !== false
  const includeEquityHistory = input.includeEquityHistory !== false
  const includeRecentRuns = input.includeRecentRuns !== false
  const [openMarketState, allSnapshotsResult, recentRunsResult] = await Promise.all([
    loadOpenMarketActorState({
      includeMarketIds: input.marketId ? [input.marketId] : [],
      includeResolved: input.includeResolved === true,
      includePortfolioValues: includeAccounts,
    }),
    includeEquityHistory
      ? db.query.marketDailySnapshots.findMany({
          orderBy: [desc(marketDailySnapshots.snapshotDate)],
          with: {
            actor: true,
          },
        })
      : Promise.resolve(null),
    includeRecentRuns
      ? db.query.marketRuns.findMany({
          orderBy: [desc(marketRuns.createdAt), desc(marketRuns.updatedAt)],
          limit: 30,
        })
      : Promise.resolve(null),
  ])
  const allSnapshots = allSnapshotsResult ?? []
  const recentRuns = recentRunsResult ?? []

  const {
    accounts,
    openMarkets: visibleMarkets,
    openMarketIds: visibleMarketIds,
    marketById,
    positionsByMarketActor,
    portfolioPositionsValueByActorId,
  } = openMarketState
  const questionIds = Array.from(new Set(
    visibleMarkets.map((market) => market.trialQuestionId).filter((value): value is string => Boolean(value)),
  ))

  const [rawQuestionsWithTrials, actions, marketSnapshots] = await Promise.all([
    questionIds.length > 0
      ? db.query.trialQuestions.findMany({
          where: inArray(trialQuestions.id, questionIds),
          with: {
            trial: true,
          },
        })
      : Promise.resolve([]),
    visibleMarketIds.length > 0
      ? db.query.marketActions.findMany({
        where: and(
          inArray(marketActions.marketId, visibleMarketIds),
          isNotNull(marketActions.trialQuestionId),
        ),
        orderBy: [desc(marketActions.createdAt)],
          with: {
            actor: true,
          },
        })
      : Promise.resolve([]),
    visibleMarketIds.length > 0
      ? db.query.marketPriceSnapshots.findMany({
          where: inArray(marketPriceSnapshots.marketId, visibleMarketIds),
          orderBy: [desc(marketPriceSnapshots.snapshotDate)],
        })
      : Promise.resolve([]),
  ])
  const acceptedOutcomeCandidates = questionIds.length > 0
    ? await db.query.trialOutcomeCandidates.findMany({
        where: and(
          inArray(trialOutcomeCandidates.trialQuestionId, questionIds),
          eq(trialOutcomeCandidates.status, 'accepted'),
        ),
        with: {
          evidence: true,
        },
        orderBy: [desc(trialOutcomeCandidates.reviewedAt), desc(trialOutcomeCandidates.createdAt)],
      })
    : []
  const filteredActions = actions.filter((action) => (
    !isMockMarketActionLike(action) && toModelId(action.actor.modelKey) !== null
  ))
  const questionsWithTrials = filterSupportedTrialQuestions(rawQuestionsWithTrials)

  const questionById = new Map(questionsWithTrials.map((question) => [question.id, question]))
  const trialById = new Map(questionsWithTrials.map((question) => [question.trial.id, question.trial]))
  const questionOutcomeById = new Map(questionsWithTrials.map((question) => [question.id, question.outcome]))
  const decisionHistoryByMarketId = await getMarketDecisionHistoryByMarketIds(visibleMarketIds, questionOutcomeById)

  const questionsByTrialId = new Map<string, typeof questionsWithTrials>()
  for (const question of questionsWithTrials) {
    const current = questionsByTrialId.get(question.trialId) || []
    current.push(question)
    questionsByTrialId.set(question.trialId, current)
  }

  const latestModelActionByMarketActor = buildLatestModelActionByMarketActor(filteredActions)
  const costBasisByMarketActor = new Map<string, number>()
  const activityTotalsByMarket = new Map<string, { totalActionsCount: number; totalVolumeUsd: number }>()
  for (const action of filteredActions) {
    const key = buildMarketActorKey(action.marketId, action.actorId)
    const marketTotals = activityTotalsByMarket.get(action.marketId) || { totalActionsCount: 0, totalVolumeUsd: 0 }
    marketTotals.totalActionsCount += 1
    marketTotals.totalVolumeUsd += Math.max(0, Math.abs(action.usdAmount || 0))
    activityTotalsByMarket.set(action.marketId, marketTotals)
    if (action.status !== 'error' && action.status !== 'skipped') {
      if (action.action === 'BUY_YES' || action.action === 'BUY_NO') {
        costBasisByMarketActor.set(key, (costBasisByMarketActor.get(key) || 0) + Math.max(0, action.usdAmount || 0))
      }
      if (action.action === 'SELL_YES' || action.action === 'SELL_NO') {
        costBasisByMarketActor.set(key, (costBasisByMarketActor.get(key) || 0) - Math.max(0, action.usdAmount || 0))
      }
    }
  }

  const marketSnapshotsByMarket = new Map<string, (typeof marketSnapshots)>()
  for (const snapshot of marketSnapshots) {
    const current = marketSnapshotsByMarket.get(snapshot.marketId) || []
    current.push(snapshot)
    marketSnapshotsByMarket.set(snapshot.marketId, current)
  }

  const latestAcceptedCandidateByQuestionId = new Map<string, (typeof acceptedOutcomeCandidates)[number]>()
  for (const candidate of acceptedOutcomeCandidates) {
    if (!latestAcceptedCandidateByQuestionId.has(candidate.trialQuestionId)) {
      latestAcceptedCandidateByQuestionId.set(candidate.trialQuestionId, candidate)
    }
  }

  const accountRows = accounts
    .flatMap((account) => {
      const modelId = toModelId(account.actor.modelKey ?? '')
      if (!modelId) return []

      const positionsValue = portfolioPositionsValueByActorId.get(account.actorId) ?? 0
      return [{
        actorId: account.actorId,
        modelId,
        startingCash: account.startingCash,
        cashBalance: account.cashBalance,
        positionsValue,
        totalEquity: account.cashBalance + positionsValue,
      }]
    })
    .sort((a, b) => b.totalEquity - a.totalEquity)

  const marketRows = visibleMarkets.flatMap((market) => {
    const questionId = market.trialQuestionId
    if (!questionId) return []

    const question = questionById.get(questionId)
    const trial = question ? trialById.get(question.trialId) : null
    if (!question || !trial) return []
    const acceptedCandidate = latestAcceptedCandidateByQuestionId.get(questionId)
    const marketResolvedOutcome: 'YES' | 'NO' | null = market.resolvedOutcome === 'YES' || market.resolvedOutcome === 'NO'
      ? market.resolvedOutcome
      : null
    const questionResolvedOutcome = getResolvedTrialOutcome(question.outcome)
    const displayResolvedOutcome = marketResolvedOutcome ?? questionResolvedOutcome
    const resolution: MarketResolutionRow | null = displayResolvedOutcome
      ? {
          outcome: displayResolvedOutcome,
          resolvedAt: toIsoString(market.resolvedAt)
            ?? toIsoString(question.outcomeDate)
            ?? toIsoString(acceptedCandidate?.proposedOutcomeDate)
            ?? toIsoString(acceptedCandidate?.reviewedAt),
          acceptedReview: acceptedCandidate
            ? {
                summary: acceptedCandidate.summary,
                confidence: acceptedCandidate.confidence,
                proposedOutcomeDate: toIsoString(acceptedCandidate.proposedOutcomeDate),
                reviewedAt: toIsoString(acceptedCandidate.reviewedAt),
                evidence: acceptedCandidate.evidence
                  .slice()
                  .sort((left, right) => left.displayOrder - right.displayOrder)
                  .map((evidence) => ({
                    sourceType: evidence.sourceType as 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search',
                    title: evidence.title,
                    url: evidence.url,
                    publishedAt: toIsoString(evidence.publishedAt),
                    excerpt: evidence.excerpt,
                    domain: evidence.domain,
                    displayOrder: evidence.displayOrder,
                  })),
              }
            : null,
        }
      : null

    const allQuestions = (questionsByTrialId.get(trial.id) || [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        id: item.id,
        slug: item.slug,
        prompt: normalizeTrialQuestionPrompt(item.prompt),
        status: item.status as 'live' | 'coming_soon',
        isBettable: item.isBettable,
        outcome: item.outcome,
      }))

    const modelStates = accountRows.map((account) => {
      const key = buildMarketActorKey(market.id, account.actorId)
      const position = positionsByMarketActor.get(key)
      const latestAction = latestModelActionByMarketActor.get(key)
      const decisionHistory = (decisionHistoryByMarketId.get(market.id) || [])
        .filter((entry) => entry.predictorId === account.modelId)
        .map((entry) => toDecisionSnapshot(entry, market.id, question.id))

      return {
        modelId: account.modelId,
        yesShares: position?.yesShares ?? 0,
        noShares: position?.noShares ?? 0,
        costBasisUsd: costBasisByMarketActor.get(key) ?? 0,
        latestDecision: decisionHistory[0] ?? null,
        decisionHistory,
        latestAction: latestAction
          ? {
              action: latestAction.action,
              usdAmount: latestAction.usdAmount,
              explanation: latestAction.explanation,
              status: latestAction.status,
              runDate: latestAction.runDate.toISOString(),
              runId: latestAction.runId,
              error: latestAction.error,
              errorCode: latestAction.errorCode,
              errorDetails: latestAction.errorDetails,
            }
          : null,
      }
    })

    return [{
      marketId: market.id,
      trialQuestionId: question.id,
      status: market.status,
      priceYes: market.priceYes,
      priceNo: 1 - market.priceYes,
      openingProbability: market.openingProbability,
      totalActionsCount: activityTotalsByMarket.get(market.id)?.totalActionsCount ?? 0,
      totalVolumeUsd: activityTotalsByMarket.get(market.id)?.totalVolumeUsd ?? 0,
      b: market.b,
      openedAt: toIsoString(market.openedAt) ?? undefined,
      event: {
        drugName: trial.shortTitle,
        companyName: trial.sponsorName,
        symbols: trial.sponsorTicker ?? '',
        applicationType: trial.exactPhase,
        decisionDate: trial.estPrimaryCompletionDate.toISOString(),
        decisionDateKind: 'hard' as const,
        eventDescription: trial.briefSummary,
        outcome: question.outcome,
        nctId: trial.nctNumber,
        source: `https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctNumber)}`,
        shortTitle: trial.shortTitle,
        sponsorName: trial.sponsorName,
        sponsorTicker: trial.sponsorTicker,
        exactPhase: trial.exactPhase,
        indication: trial.indication,
        intervention: trial.intervention,
        primaryEndpoint: trial.primaryEndpoint,
        currentStatus: trial.currentStatus,
        briefSummary: trial.briefSummary,
        studyStartDate: toIsoString(trial.studyStartDate),
        estStudyCompletionDate: toIsoString(trial.estStudyCompletionDate),
        estResultsPostingDate: toIsoString(trial.estResultsPostingDate),
        estEnrollment: trial.estEnrollment,
        keyLocations: trial.keyLocations,
        standardBettingMarkets: trial.standardBettingMarkets,
        questionPrompt: normalizeTrialQuestionPrompt(question.prompt),
        questionSlug: question.slug,
        questionStatus: question.status as 'live' | 'coming_soon',
        allQuestions,
      },
      resolution,
      modelStates,
      priceHistory: (marketSnapshotsByMarket.get(market.id) || [])
        .slice(0, 90)
        .reverse()
        .map((snapshot) => ({
          snapshotDate: snapshot.snapshotDate.toISOString(),
          priceYes: snapshot.priceYes,
        })),
    }]
  })

  const snapshotByModel = new Map<string, (typeof allSnapshots)>()
  for (const snapshot of allSnapshots) {
    const modelKey = snapshot.actor.modelKey
    if (!modelKey) continue
    const current = snapshotByModel.get(modelKey) || []
    current.push(snapshot)
    snapshotByModel.set(modelKey, current)
  }

  const equityHistory = Array.from(snapshotByModel.entries())
    .flatMap(([modelIdRaw, snapshots]) => {
      const modelId = toModelId(modelIdRaw)
      if (!modelId) return []
      return [{
        modelId,
        snapshots: snapshots
          .slice(0, 90)
          .reverse()
          .map((snapshot) => ({
            snapshotDate: snapshot.snapshotDate.toISOString(),
            totalEquity: snapshot.totalEquity,
          })),
      }]
    })

  const recentActions = filteredActions.flatMap((action) => {
    const modelId = toModelId(action.actor.modelKey ?? '')
    if (!modelId) return []

    const questionId = action.trialQuestionId
    const question = questionId ? questionById.get(questionId) : null
    const trial = question ? trialById.get(question.trialId) : null
    const market = marketById.get(action.marketId)

    return [{
      id: action.id,
      runId: action.runId,
      marketId: action.marketId,
      modelId,
      runDate: action.runDate.toISOString(),
      createdAt: toIsoString(action.createdAt),
      action: action.action,
      status: action.status,
      usdAmount: action.usdAmount,
      sharesDelta: action.sharesDelta,
      priceBefore: action.priceBefore,
      priceAfter: action.priceAfter,
      explanation: action.explanation,
      error: action.error,
      errorCode: action.errorCode,
      errorDetails: action.errorDetails,
      currentPriceYes: market?.priceYes ?? null,
      marketStatus: market?.status ?? null,
      event: trial
        ? {
            drugName: trial.shortTitle,
            companyName: trial.sponsorName,
            symbols: trial.sponsorTicker ?? '',
            decisionDate: trial.estPrimaryCompletionDate.toISOString(),
            decisionDateKind: 'hard' as const,
          }
        : null,
    }]
  })

  const recentRunRows = recentRuns.map((run) => ({
    id: run.id,
    runDate: run.runDate.toISOString(),
    status: toRunStatus(run.status),
    openMarkets: run.openMarkets,
    totalActions: run.totalActions,
    processedActions: run.processedActions,
    okCount: run.okCount,
    errorCount: run.errorCount,
    skippedCount: run.skippedCount,
    failureReason: run.failureReason ?? null,
    completedAt: toIsoString(run.completedAt),
  }))

  const openMarketRows = marketRows.filter((market) => !isMarketClosedToTrading(market))
  const resolvedMarketRows = marketRows.filter((market) => isMarketClosedToTrading(market))

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    accounts: includeAccounts ? accountRows : [],
    openMarkets: openMarketRows,
    resolvedMarkets: resolvedMarketRows,
    equityHistory,
    recentActions,
    recentRuns: recentRunRows,
  }
}
