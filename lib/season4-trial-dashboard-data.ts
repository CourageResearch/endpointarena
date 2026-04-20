import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { db } from '@/lib/db'
import type { OpenMarketRow } from '@/lib/markets/overview-shared'
import { MOCK_USDC_DISPLAY_SCALE } from '@/lib/onchain/constants'
import type { Season4MarketDetail } from '@/lib/season4-market-data'
import {
  modelDecisionSnapshots,
  onchainBalances,
  onchainEvents,
  onchainModelWallets,
  trialOutcomeCandidates,
} from '@/lib/schema'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import type { ModelDecisionSnapshot as DashboardDecisionSnapshot } from '@/lib/types'

function normalizeWalletAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

function atomicToDisplay(value: unknown): number {
  const numeric = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? Number(value)
    : Number.NaN
  if (!Number.isFinite(numeric)) return 0
  return numeric / MOCK_USDC_DISPLAY_SCALE
}

function normalizeResolvedOutcome(value: string | null | undefined): 'YES' | 'NO' | null {
  if (value === 'YES' || value === 'NO') return value
  return null
}

function chooseDisplayResolvedOutcome(detail: Season4MarketDetail): 'YES' | 'NO' | null {
  return normalizeResolvedOutcome(detail.market.resolvedOutcome)
    ?? normalizeResolvedOutcome(detail.trial?.questionOutcome ?? null)
}

function buildDecisionSnapshot(
  row: {
    id: string
    trialQuestionId: string
    marketId: string | null
    runSource: string
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
    modelKey: string | null
    actor?: {
      modelKey: string | null
    } | null
  },
): DashboardDecisionSnapshot | null {
  const modelKey = row.modelKey ?? row.actor?.modelKey ?? null
  if (!isModelId(modelKey)) return null

  return {
    id: row.id,
    eventId: row.trialQuestionId,
    trialQuestionId: row.trialQuestionId,
    marketId: row.marketId,
    modelId: modelKey,
    source: 'snapshot',
    runSource: row.runSource as 'manual' | 'cycle',
    createdAt: row.createdAt?.toISOString(),
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

export async function loadSeason4DashboardMarket(detail: Season4MarketDetail): Promise<OpenMarketRow> {
  const trialQuestionId = detail.trial?.trialQuestionId ?? detail.market.trialQuestionId ?? undefined
  const onchainMarketId = detail.market.onchainMarketId
  const marketRef = onchainMarketId ? `market:${onchainMarketId}` : null
  const resolvedOutcome = chooseDisplayResolvedOutcome(detail)
  const priceYes = resolvedOutcome === 'YES'
    ? 1
    : resolvedOutcome === 'NO'
      ? 0
      : detail.market.priceYes ?? 0.5
  const priceNo = Math.max(0, 1 - priceYes)

  const [snapshotRows, modelWalletRows, modelBalanceRows, acceptedCandidate] = await Promise.all([
    trialQuestionId
      ? db.query.modelDecisionSnapshots.findMany({
          where: eq(modelDecisionSnapshots.trialQuestionId, trialQuestionId),
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
    marketRef
      ? db.select({
          modelKey: onchainBalances.modelKey,
          yesShares: onchainBalances.yesShares,
          noShares: onchainBalances.noShares,
        })
          .from(onchainBalances)
          .where(and(
            eq(onchainBalances.marketRef, marketRef),
            isNotNull(onchainBalances.modelKey),
          ))
      : Promise.resolve([]),
    trialQuestionId
      ? db.query.trialOutcomeCandidates.findFirst({
          where: and(
            eq(trialOutcomeCandidates.trialQuestionId, trialQuestionId),
            eq(trialOutcomeCandidates.status, 'accepted'),
          ),
          with: {
            evidence: true,
          },
          orderBy: [desc(trialOutcomeCandidates.reviewedAt), desc(trialOutcomeCandidates.createdAt)],
        })
      : Promise.resolve(null),
  ])

  const normalizedModelWallets = modelWalletRows
    .flatMap((row) => {
      const walletAddress = normalizeWalletAddress(row.walletAddress)
      return isModelId(row.modelKey) && walletAddress
        ? [{ modelKey: row.modelKey, walletAddress }]
        : []
    })

  const modelWalletAddresses = normalizedModelWallets.map((row) => row.walletAddress)
  const modelKeyByWallet = new Map(
    normalizedModelWallets.map((row) => [row.walletAddress, row.modelKey] as const),
  )

  const tradeEventRows = onchainMarketId && modelWalletAddresses.length > 0
    ? await db.select({
        walletAddress: onchainEvents.walletAddress,
        payload: onchainEvents.payload,
      })
        .from(onchainEvents)
        .where(and(
          eq(onchainEvents.eventName, 'TradeExecuted'),
          eq(onchainEvents.marketRef, onchainMarketId),
          inArray(onchainEvents.walletAddress, modelWalletAddresses),
        ))
    : []

  const snapshotsByModelId = new Map<ModelId, DashboardDecisionSnapshot[]>(
    MODEL_IDS.map((modelId) => [modelId, [] as DashboardDecisionSnapshot[]]),
  )

  for (const row of snapshotRows) {
    const snapshot = buildDecisionSnapshot(row)
    if (!snapshot || !isModelId(snapshot.modelId)) continue
    const history = snapshotsByModelId.get(snapshot.modelId) ?? []
    history.push(snapshot)
    snapshotsByModelId.set(snapshot.modelId, history)
  }

  const balancesByModelId = new Map<ModelId, { yesShares: number; noShares: number }>()
  for (const row of modelBalanceRows) {
    if (!isModelId(row.modelKey)) continue
    balancesByModelId.set(row.modelKey, {
      yesShares: Math.max(0, row.yesShares ?? 0),
      noShares: Math.max(0, row.noShares ?? 0),
    })
  }

  const costBasisByModelId = new Map<ModelId, number>(
    MODEL_IDS.map((modelId) => [modelId, 0]),
  )
  for (const row of tradeEventRows) {
    const walletAddress = normalizeWalletAddress(row.walletAddress)
    if (!walletAddress) continue
    const modelKey = modelKeyByWallet.get(walletAddress)
    if (!modelKey) continue

    const payload = row.payload as Record<string, unknown>
    const collateralAmount = Math.max(0, atomicToDisplay(payload.collateralAmount))
    const signedCostBasis = payload.isBuy === true ? collateralAmount : -collateralAmount
    costBasisByModelId.set(modelKey, (costBasisByModelId.get(modelKey) ?? 0) + signedCostBasis)
  }

  const modelStates = MODEL_IDS.map((modelId) => {
    const history = snapshotsByModelId.get(modelId) ?? []
    const latestDecision = history[0] ?? null
    const balances = balancesByModelId.get(modelId) ?? { yesShares: 0, noShares: 0 }

    return {
      modelId,
      yesShares: balances.yesShares,
      noShares: balances.noShares,
      costBasisUsd: costBasisByModelId.get(modelId) ?? 0,
      latestDecision,
      decisionHistory: history,
      latestAction: latestDecision?.action
        ? {
            action: latestDecision.action.type,
            usdAmount: latestDecision.action.amountUsd,
            explanation: latestDecision.action.explanation,
            status: 'recorded',
            runDate: latestDecision.createdAt ?? detail.market.openedAt ?? new Date(0).toISOString(),
            runId: null,
            error: null,
            errorCode: null,
            errorDetails: null,
          }
        : null,
    }
  })

  const decisionDate = detail.trial?.estPrimaryCompletionDate
    ?? detail.market.closeTime
    ?? detail.market.openedAt
    ?? new Date(0).toISOString()
  const questionPrompt = normalizeTrialQuestionPrompt(detail.trial?.questionPrompt ?? detail.market.title)
  const acceptedReview = acceptedCandidate
    ? {
        summary: acceptedCandidate.summary,
        confidence: acceptedCandidate.confidence,
        proposedOutcomeDate: acceptedCandidate.proposedOutcomeDate ? acceptedCandidate.proposedOutcomeDate.toISOString() : null,
        reviewedAt: acceptedCandidate.reviewedAt ? acceptedCandidate.reviewedAt.toISOString() : null,
        evidence: acceptedCandidate.evidence
          .slice()
          .sort((left, right) => left.displayOrder - right.displayOrder)
          .map((evidence) => ({
            sourceType: evidence.sourceType as 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search',
            title: evidence.title,
            url: evidence.url,
            publishedAt: evidence.publishedAt ? evidence.publishedAt.toISOString() : null,
            excerpt: evidence.excerpt,
            domain: evidence.domain,
            displayOrder: evidence.displayOrder,
          })),
      }
    : null

  return {
    marketId: detail.market.marketSlug,
    trialQuestionId,
    status: resolvedOutcome ? 'RESOLVED' : 'OPEN',
    priceYes,
    priceNo,
    openingProbability: detail.priceHistory[0]?.priceYes ?? detail.market.priceYes ?? 0.5,
    totalActionsCount: detail.market.totalTrades,
    totalVolumeUsd: detail.market.totalVolumeDisplay,
    openedAt: detail.market.openedAt ?? undefined,
    event: {
      drugName: detail.trial?.shortTitle ?? detail.market.title,
      companyName: detail.trial?.sponsorName ?? '',
      symbols: detail.trial?.sponsorTicker ?? '',
      applicationType: detail.trial?.exactPhase ?? '',
      decisionDate,
      decisionDateKind: 'hard',
      eventDescription: detail.trial?.briefSummary ?? detail.market.title,
      outcome: detail.trial?.questionOutcome ?? (resolvedOutcome ?? 'Pending'),
      nctId: detail.trial?.nctNumber ?? null,
      source: detail.trial?.nctNumber
        ? `https://clinicaltrials.gov/study/${encodeURIComponent(detail.trial.nctNumber)}`
        : null,
      shortTitle: detail.trial?.shortTitle,
      sponsorName: detail.trial?.sponsorName,
      sponsorTicker: detail.trial?.sponsorTicker ?? null,
      exactPhase: detail.trial?.exactPhase,
      indication: detail.trial?.indication,
      intervention: detail.trial?.intervention,
      primaryEndpoint: detail.trial?.primaryEndpoint,
      currentStatus: detail.trial?.currentStatus,
      briefSummary: detail.trial?.briefSummary,
      estStudyCompletionDate: detail.trial?.estStudyCompletionDate ?? null,
      estEnrollment: detail.trial?.estEnrollment ?? null,
      questionPrompt,
      questionSlug: detail.trial?.questionSlug ?? detail.market.marketSlug,
      questionStatus: 'live',
      allQuestions: trialQuestionId
        ? [{
            id: trialQuestionId,
            slug: detail.trial?.questionSlug ?? detail.market.marketSlug,
            prompt: questionPrompt,
            status: 'live',
            isBettable: true,
            outcome: detail.trial?.questionOutcome ?? 'Pending',
          }]
        : [],
    },
    resolution: resolvedOutcome
      ? {
          outcome: resolvedOutcome,
          resolvedAt: detail.trial?.questionOutcomeDate
            ?? acceptedReview?.proposedOutcomeDate
            ?? acceptedReview?.reviewedAt
            ?? detail.market.closeTime
            ?? null,
          acceptedReview,
        }
      : null,
    modelStates,
    priceHistory: detail.priceHistory.length > 0
      ? detail.priceHistory
      : detail.market.openedAt
        ? [{ snapshotDate: detail.market.openedAt, priceYes }]
        : [],
  }
}
