import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import {
  getResolvedTrialOutcome,
  isMarketClosedToTrading,
  type MarketResolutionRow,
  type OpenMarketRow,
  type OverviewResponse,
} from '@/lib/markets/overview-shared'
import { getSeason4MarketSummaries } from '@/lib/season4-market-data'
import { normalizeTrialQuestionPrompt, filterSupportedTrialQuestions } from '@/lib/trial-questions'
import type { ModelDecisionSnapshot } from '@/lib/types'
import {
  modelDecisionSnapshots,
  onchainBalances,
  onchainEvents,
  onchainModelWallets,
  trialOutcomeCandidates,
  trialQuestions,
  trials,
} from '@/lib/schema'

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeWalletAddress(value: string | null | undefined): string | null {
  return trimOrNull(value)?.toLowerCase() ?? null
}

function atomicToDisplay(value: unknown): number {
  const numeric = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? Number(value)
    : Number.NaN
  if (!Number.isFinite(numeric)) return 0
  return numeric / 1_000_000
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function buildDecisionSnapshot(row: {
  id: string
  trialQuestionId: string
  createdAt: Date
  linkedMarketActionId: string | null
  approvalProbability: number
  yesProbability: number | null
  binaryCall: string
  confidence: number
  reasoning: string
  proposedActionType: string
  proposedAmountUsd: number
  proposedExplanation: string
  runSource: string
  modelKey: string | null
  actor?: {
    modelKey: string | null
  } | null
}, marketId: string): ModelDecisionSnapshot | null {
  const modelKey = row.modelKey ?? row.actor?.modelKey ?? null
  if (!isModelId(modelKey)) return null

  return {
    id: row.id,
    eventId: row.trialQuestionId,
    trialQuestionId: row.trialQuestionId,
    marketId,
    modelId: modelKey,
    source: 'snapshot',
    runSource: row.runSource as 'manual' | 'cycle',
    createdAt: row.createdAt.toISOString(),
    linkedMarketActionId: row.linkedMarketActionId ?? null,
    forecast: {
      approvalProbability: row.approvalProbability,
      yesProbability: row.yesProbability ?? row.approvalProbability,
      binaryCall: row.binaryCall as 'yes' | 'no',
      confidence: row.confidence,
      reasoning: row.reasoning,
    },
    action: {
      type: row.proposedActionType,
      amountUsd: row.proposedAmountUsd,
      explanation: row.proposedExplanation,
    },
  }
}

function emptyOverview(): OverviewResponse {
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    accounts: [],
    openMarkets: [],
    resolvedMarkets: [],
    equityHistory: [],
    recentActions: [],
    recentRuns: [],
  }
}

export async function getSeason4TrialsOverviewData(input: {
  marketId?: string | null
  includeResolved?: boolean
  includeAccounts?: boolean
  includeEquityHistory?: boolean
  includeRecentRuns?: boolean
} = {}): Promise<OverviewResponse> {
  const allMarkets = await getSeason4MarketSummaries({ sync: true })
  const requestedMarketId = trimOrNull(input.marketId)
  const filteredMarkets = requestedMarketId
    ? allMarkets.filter((market) => (
        market.marketSlug === requestedMarketId ||
        market.onchainMarketId === requestedMarketId ||
        market.id === requestedMarketId
      ))
    : allMarkets

  if (filteredMarkets.length === 0) {
    return emptyOverview()
  }

  const trialQuestionIds = Array.from(new Set(
    filteredMarkets
      .map((market) => trimOrNull(market.trialQuestionId))
      .filter((value): value is string => Boolean(value)),
  ))

  const marketIds = filteredMarkets
    .map((market) => trimOrNull(market.onchainMarketId))
    .filter((value): value is string => Boolean(value))
  const marketRefs = marketIds.map((marketId) => `market:${marketId}`)

  const [rawQuestions, snapshotRows, modelWalletRows, balanceRows, acceptedCandidates, tradeEvents] = await Promise.all([
    trialQuestionIds.length > 0
      ? db.query.trialQuestions.findMany({
          where: inArray(trialQuestions.id, trialQuestionIds),
          with: {
            trial: true,
          },
        })
      : Promise.resolve([]),
    trialQuestionIds.length > 0
      ? db.query.modelDecisionSnapshots.findMany({
          where: inArray(modelDecisionSnapshots.trialQuestionId, trialQuestionIds),
          orderBy: [desc(modelDecisionSnapshots.createdAt)],
          with: {
            actor: true,
          },
        })
      : Promise.resolve([]),
    db.select({
      modelKey: onchainModelWallets.modelKey,
      walletAddress: onchainModelWallets.walletAddress,
    })
      .from(onchainModelWallets),
    marketRefs.length > 0
      ? db.select({
          marketRef: onchainBalances.marketRef,
          modelKey: onchainBalances.modelKey,
          yesShares: onchainBalances.yesShares,
          noShares: onchainBalances.noShares,
        })
          .from(onchainBalances)
          .where(and(
            inArray(onchainBalances.marketRef, marketRefs),
            isNotNull(onchainBalances.modelKey),
          ))
      : Promise.resolve([]),
    trialQuestionIds.length > 0
      ? db.query.trialOutcomeCandidates.findMany({
          where: and(
            inArray(trialOutcomeCandidates.trialQuestionId, trialQuestionIds),
            eq(trialOutcomeCandidates.status, 'accepted'),
          ),
          with: {
            evidence: true,
          },
          orderBy: [desc(trialOutcomeCandidates.reviewedAt), desc(trialOutcomeCandidates.createdAt)],
        })
      : Promise.resolve([]),
    marketIds.length > 0
      ? db.select({
          marketRef: onchainEvents.marketRef,
          walletAddress: onchainEvents.walletAddress,
          payload: onchainEvents.payload,
          createdAt: onchainEvents.createdAt,
        })
          .from(onchainEvents)
          .where(and(
            inArray(onchainEvents.marketRef, marketIds),
            eq(onchainEvents.eventName, 'TradeExecuted'),
          ))
          .orderBy(desc(onchainEvents.createdAt))
      : Promise.resolve([]),
  ])

  const supportedQuestions = filterSupportedTrialQuestions(rawQuestions)
  const supportedQuestionIds = new Set(supportedQuestions.map((question) => question.id))
  const questionsById = new Map(supportedQuestions.map((question) => [question.id, question] as const))
  const allQuestionsByTrialId = new Map<string, typeof supportedQuestions>()
  for (const question of supportedQuestions) {
    const current = allQuestionsByTrialId.get(question.trialId) ?? []
    current.push(question)
    allQuestionsByTrialId.set(question.trialId, current)
  }

  const visibleMarkets = filteredMarkets.filter((market) => {
    const questionId = trimOrNull(market.trialQuestionId)
    return questionId ? supportedQuestionIds.has(questionId) : false
  })
  if (visibleMarkets.length === 0) {
    return emptyOverview()
  }

  const walletAddressByModel = new Map<ModelId, string>()
  for (const row of modelWalletRows) {
    const walletAddress = normalizeWalletAddress(row.walletAddress)
    if (!walletAddress || !isModelId(row.modelKey)) continue
    walletAddressByModel.set(row.modelKey, walletAddress)
  }
  const modelByWalletAddress = new Map(
    Array.from(walletAddressByModel.entries()).map(([modelId, walletAddress]) => [walletAddress, modelId] as const),
  )

  const balancesByMarketModel = new Map<string, { yesShares: number; noShares: number }>()
  for (const row of balanceRows) {
    if (!row.marketRef || !isModelId(row.modelKey)) continue
    balancesByMarketModel.set(`${row.marketRef}:${row.modelKey}`, {
      yesShares: Math.max(0, row.yesShares ?? 0),
      noShares: Math.max(0, row.noShares ?? 0),
    })
  }

  const acceptedCandidateByQuestionId = new Map<string, (typeof acceptedCandidates)[number]>()
  for (const candidate of acceptedCandidates) {
    if (!acceptedCandidateByQuestionId.has(candidate.trialQuestionId)) {
      acceptedCandidateByQuestionId.set(candidate.trialQuestionId, candidate)
    }
  }

  const snapshotsByQuestionModel = new Map<string, ModelDecisionSnapshot[]>()
  for (const row of snapshotRows) {
    const market = visibleMarkets.find((entry) => entry.trialQuestionId === row.trialQuestionId)
    if (!market) continue
    const snapshot = buildDecisionSnapshot(row, market.marketSlug)
    if (!snapshot || !isModelId(snapshot.modelId)) continue
    const key = `${row.trialQuestionId}:${snapshot.modelId}`
    const current = snapshotsByQuestionModel.get(key) ?? []
    current.push(snapshot)
    snapshotsByQuestionModel.set(key, current)
  }

  const costBasisByMarketModel = new Map<string, number>()
  const priceHistoryByMarketId = new Map<string, Array<{ snapshotDate: string; priceYes: number }>>()
  for (const event of tradeEvents) {
    const marketId = trimOrNull(event.marketRef)
    const payload = event.payload as Record<string, unknown>
    const priceYesRaw = typeof payload.priceYesE18 === 'string' || typeof payload.priceYesE18 === 'number'
      ? Number(payload.priceYesE18)
      : Number.NaN
    const priceYes = Number.isFinite(priceYesRaw) ? priceYesRaw / 1e18 : null
    if (marketId && priceYes != null) {
      const currentHistory = priceHistoryByMarketId.get(marketId) ?? []
      currentHistory.push({
        snapshotDate: event.createdAt.toISOString(),
        priceYes,
      })
      priceHistoryByMarketId.set(marketId, currentHistory)
    }

    const modelId = modelByWalletAddress.get(normalizeWalletAddress(event.walletAddress) ?? '')
    if (!marketId || !modelId) continue

    const collateralAmount = Math.max(0, atomicToDisplay(payload.collateralAmount))
    const signedCostBasis = payload.isBuy === true ? collateralAmount : -collateralAmount
    const costBasisKey = `${marketId}:${modelId}`
    costBasisByMarketModel.set(costBasisKey, (costBasisByMarketModel.get(costBasisKey) ?? 0) + signedCostBasis)
  }

  const marketRows: OpenMarketRow[] = visibleMarkets.flatMap((market) => {
    const questionId = trimOrNull(market.trialQuestionId)
    if (!questionId) return []
    const question = questionsById.get(questionId)
    if (!question) return []

    const acceptedCandidate = acceptedCandidateByQuestionId.get(questionId)
    const priceHistory = (priceHistoryByMarketId.get(trimOrNull(market.onchainMarketId) ?? '') ?? [])
      .slice()
      .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
    const openingProbability = priceHistory[0]?.priceYes ?? market.priceYes ?? 0.5
    const resolvedOutcome = market.resolvedOutcome ?? getResolvedTrialOutcome(question.outcome)
    const resolution: MarketResolutionRow | null = resolvedOutcome
      ? {
          outcome: resolvedOutcome,
          resolvedAt: market.closeTime
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

    const allQuestions = (allQuestionsByTrialId.get(question.trialId) ?? [])
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((item) => ({
        id: item.id,
        slug: item.slug,
        prompt: normalizeTrialQuestionPrompt(item.prompt),
        status: item.status as 'live' | 'coming_soon',
        isBettable: item.isBettable,
        outcome: item.outcome,
      }))

    const marketRef = trimOrNull(market.onchainMarketId) ? `market:${trimOrNull(market.onchainMarketId)}` : null
    const modelStates = MODEL_IDS.map((modelId) => {
      const decisionHistory = snapshotsByQuestionModel.get(`${question.id}:${modelId}`) ?? []
      const latestDecision = decisionHistory[0] ?? null
      const shares = marketRef ? balancesByMarketModel.get(`${marketRef}:${modelId}`) : null
      const onchainMarketId = trimOrNull(market.onchainMarketId)

      return {
        modelId,
        yesShares: shares?.yesShares ?? 0,
        noShares: shares?.noShares ?? 0,
        costBasisUsd: onchainMarketId ? (costBasisByMarketModel.get(`${onchainMarketId}:${modelId}`) ?? 0) : 0,
        latestDecision,
        decisionHistory,
        latestAction: latestDecision?.action
          ? {
              action: latestDecision.action.type,
              usdAmount: latestDecision.action.amountUsd,
              explanation: latestDecision.action.explanation,
              status: 'recorded',
              runDate: latestDecision.createdAt ?? market.openedAt ?? new Date(0).toISOString(),
              runId: null,
              error: null,
              errorCode: null,
              errorDetails: null,
            }
          : null,
      }
    })

    return [{
      marketId: market.marketSlug,
      trialQuestionId: question.id,
      status: market.status === 'resolved' ? 'RESOLVED' : 'OPEN',
      priceYes: resolvedOutcome === 'YES'
        ? 1
        : resolvedOutcome === 'NO'
          ? 0
          : (market.priceYes ?? 0.5),
      priceNo: resolvedOutcome === 'YES'
        ? 0
        : resolvedOutcome === 'NO'
          ? 1
          : (market.priceNo ?? Math.max(0, 1 - (market.priceYes ?? 0.5))),
      openingProbability,
      totalActionsCount: market.totalTrades,
      totalVolumeUsd: market.totalVolumeDisplay,
      b: undefined,
      openedAt: market.openedAt ?? undefined,
      event: {
        drugName: market.shortTitle?.trim() || market.title,
        companyName: market.sponsorName?.trim() || 'Unknown sponsor',
        symbols: market.sponsorTicker?.trim() || '',
        applicationType: market.exactPhase?.trim() || '—',
        decisionDate: question.trial.estPrimaryCompletionDate.toISOString(),
        decisionDateKind: 'hard' as const,
        eventDescription: market.briefSummary?.trim() || market.title,
        outcome: resolvedOutcome ?? question.outcome,
        nctId: market.nctNumber?.trim() || null,
        source: 'season4_onchain',
        shortTitle: market.shortTitle?.trim() || market.title,
        sponsorName: market.sponsorName?.trim() || market.title,
        sponsorTicker: market.sponsorTicker?.trim() || null,
        exactPhase: market.exactPhase?.trim() || undefined,
        indication: market.indication?.trim() || undefined,
        intervention: market.intervention?.trim() || undefined,
        primaryEndpoint: market.primaryEndpoint?.trim() || undefined,
        currentStatus: market.currentStatus?.trim() || undefined,
        briefSummary: market.briefSummary?.trim() || market.title,
        studyStartDate: toIsoString(question.trial.studyStartDate),
        estStudyCompletionDate: toIsoString(question.trial.estStudyCompletionDate),
        estResultsPostingDate: toIsoString(question.trial.estResultsPostingDate),
        estEnrollment: question.trial.estEnrollment,
        keyLocations: question.trial.keyLocations,
        standardBettingMarkets: question.trial.standardBettingMarkets,
        questionPrompt: normalizeTrialQuestionPrompt(question.prompt),
        questionSlug: question.slug,
        questionStatus: market.status === 'resolved' ? 'coming_soon' : (question.status as 'live' | 'coming_soon'),
        allQuestions,
      },
      resolution,
      modelStates,
      priceHistory,
    }]
  })

  const includeResolved = input.includeResolved === true
  const openMarkets = marketRows.filter((market) => !isMarketClosedToTrading(market))
  const resolvedMarkets = includeResolved
    ? marketRows.filter((market) => isMarketClosedToTrading(market))
    : []

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    accounts: [],
    openMarkets,
    resolvedMarkets,
    equityHistory: [],
    recentActions: [],
    recentRuns: [],
  }
}
