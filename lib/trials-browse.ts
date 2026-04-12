import { abbreviateType } from '@/lib/constants'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import {
  daysUntilUtc,
  getMarketQuestion,
  getPriceMoveFromHistory,
  type OpenMarketRow,
  type OverviewResponse,
} from '@/lib/markets/overview-shared'
import type { TrialsBrowseResponse, TrialsBrowseRow } from '@/lib/trials-browse-shared'

function getBrowseCompanyName(market: OpenMarketRow): string {
  return market.event?.sponsorName?.trim() || market.event?.companyName?.trim() || 'Trial'
}

function getBrowseDecisionCounts(market: OpenMarketRow) {
  let approveCount = 0
  let rejectCount = 0

  for (const state of market.modelStates) {
    const binaryCall = state.latestDecision?.forecast.binaryCall
    if (binaryCall === 'yes') {
      approveCount += 1
      continue
    }
    if (binaryCall === 'no') {
      rejectCount += 1
    }
  }

  const totalModelCount = market.modelStates.length
  const pendingCount = Math.max(0, totalModelCount - approveCount - rejectCount)

  return {
    approveCount,
    rejectCount,
    pendingCount,
    totalModelCount,
  }
}

function mapMarketToBrowseRow(market: OpenMarketRow): TrialsBrowseRow {
  const question = getMarketQuestion(market)
  const description = market.event?.eventDescription?.trim() || question
  const companyName = getBrowseCompanyName(market)
  const applicationTypeLabel = market.event?.applicationType
    ? abbreviateType(market.event.applicationType).display
    : '—'
  const move = getPriceMoveFromHistory(market.priceHistory, market.priceYes, {
    openingPrice: market.openingProbability,
    openedAt: market.openedAt,
  })
  const counts = getBrowseDecisionCounts(market)

  return {
    marketId: market.marketId,
    status: market.status,
    title: market.event?.drugName || question,
    question,
    companyName,
    sponsorName: market.event?.sponsorName?.trim() || null,
    nctId: market.event?.nctId?.trim() || null,
    applicationTypeLabel,
    description,
    decisionDate: market.event?.decisionDate ?? null,
    decisionDateKind: market.event?.decisionDateKind ?? null,
    daysUntil: daysUntilUtc(market.event?.decisionDate),
    resolvedAt: market.resolution?.resolvedAt ?? null,
    resolvedOutcome: market.resolution?.outcome ?? null,
    yesPrice: market.priceYes,
    noPrice: 1 - market.priceYes,
    volumeUsd: market.totalVolumeUsd ?? 0,
    commentsCount: market.totalActionsCount ?? 0,
    absMove: move.absDelta,
    aiApproveCount: counts.approveCount,
    aiRejectCount: counts.rejectCount,
    aiPendingCount: counts.pendingCount,
    aiTotalModelCount: counts.totalModelCount,
  }
}

function createTrialsBrowseResponse(data: OverviewResponse | null): TrialsBrowseResponse | null {
  if (!data) return null

  const openMarkets = data.openMarkets.map(mapMarketToBrowseRow)

  return {
    generatedAt: data.generatedAt ?? null,
    openMarkets,
    resolvedMarkets: data.resolvedMarkets.map(mapMarketToBrowseRow),
  }
}

export async function getTrialsBrowseData(input: {
  includeResolved?: boolean
} = {}): Promise<TrialsBrowseResponse> {
  const data = await getTrialsOverviewData({
    includeResolved: input.includeResolved,
  })

  return createTrialsBrowseResponse(data) ?? {
    generatedAt: null,
    openMarkets: [],
    resolvedMarkets: [],
  }
}
