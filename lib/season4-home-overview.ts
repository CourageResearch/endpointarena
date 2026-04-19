import type { OverviewResponse, OpenMarketRow } from '@/lib/markets/overview-shared'
import type { Season4MarketSummary } from '@/lib/season4-market-data'

function defaultPrice(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0.5
  }
  return Math.max(0, Math.min(1, value))
}

function buildLinkedOverviewMap(linkedOverview: OverviewResponse | null | undefined): Map<string, OpenMarketRow> {
  const map = new Map<string, OpenMarketRow>()
  if (!linkedOverview) return map

  for (const market of [...linkedOverview.openMarkets, ...linkedOverview.resolvedMarkets]) {
    if (!market.trialQuestionId || map.has(market.trialQuestionId)) continue
    map.set(market.trialQuestionId, market)
  }

  return map
}

function toOverviewMarketRow(
  market: Season4MarketSummary,
  linkedMarket: OpenMarketRow | null,
): OpenMarketRow {
  const priceYes = defaultPrice(linkedMarket?.priceYes ?? market.priceYes)
  const priceNo = defaultPrice(linkedMarket?.priceNo ?? market.priceNo ?? (1 - priceYes))
  const fallbackStatus = market.status === 'resolved' ? 'RESOLVED' : 'OPEN'
  const fallbackResolution = market.status === 'resolved'
    ? {
        outcome: market.resolvedOutcome,
        resolvedAt: market.closeTime,
        acceptedReview: null,
      }
    : null
  const linkedEvent = linkedMarket?.event
  const fallbackDrugName = market.shortTitle?.trim() || market.title
  const fallbackSponsorName = market.sponsorName?.trim() || market.title
  const fallbackDescription = market.briefSummary?.trim() || market.title
  const event = linkedEvent
    ? {
        ...linkedEvent,
        outcome: market.resolvedOutcome ?? linkedEvent.outcome,
        questionStatus: market.status === 'resolved'
          ? 'coming_soon'
          : (linkedEvent.questionStatus ?? 'live'),
      }
    : {
        drugName: fallbackDrugName,
        companyName: fallbackSponsorName,
        symbols: market.sponsorTicker?.trim() || '',
        applicationType: market.exactPhase?.trim() || 'Onchain',
        decisionDate: market.closeTime ?? new Date(0).toISOString(),
        decisionDateKind: 'hard' as const,
        eventDescription: fallbackDescription,
        outcome: market.resolvedOutcome ?? 'Pending',
        nctId: market.nctNumber?.trim() || null,
        source: 'season4_onchain',
        shortTitle: fallbackDrugName,
        sponsorName: fallbackSponsorName,
        sponsorTicker: market.sponsorTicker?.trim() || null,
        exactPhase: market.exactPhase?.trim() || undefined,
        indication: market.indication?.trim() || undefined,
        intervention: market.intervention?.trim() || undefined,
        primaryEndpoint: market.primaryEndpoint?.trim() || undefined,
        currentStatus: market.currentStatus?.trim() || undefined,
        briefSummary: fallbackDescription,
        questionPrompt: market.questionPrompt?.trim() || market.title,
        questionSlug: market.questionSlug?.trim() || market.marketSlug,
        questionStatus: market.status === 'resolved' ? 'coming_soon' as const : 'live' as const,
      }

  return {
    marketId: market.marketSlug,
    trialQuestionId: market.trialQuestionId ?? linkedMarket?.trialQuestionId,
    status: fallbackStatus,
    priceYes,
    priceNo,
    openingProbability: linkedMarket?.openingProbability ?? 0.5,
    totalActionsCount: linkedMarket?.totalActionsCount ?? market.totalTrades,
    totalVolumeUsd: linkedMarket?.totalVolumeUsd ?? market.totalVolumeDisplay,
    b: linkedMarket?.b,
    openedAt: linkedMarket?.openedAt ?? market.openedAt ?? undefined,
    event,
    resolution: linkedMarket?.resolution ?? fallbackResolution,
    modelStates: linkedMarket?.modelStates ?? [],
    priceHistory: linkedMarket?.priceHistory ?? [],
  }
}

export function createSeason4OverviewResponse(
  markets: Season4MarketSummary[],
  linkedOverview: OverviewResponse | null = null,
): OverviewResponse {
  const linkedOverviewByQuestionId = buildLinkedOverviewMap(linkedOverview)
  const openMarkets = markets
    .filter((market) => market.status !== 'resolved' && market.status !== 'archived')
    .map((market) => toOverviewMarketRow(
      market,
      market.trialQuestionId ? (linkedOverviewByQuestionId.get(market.trialQuestionId) ?? null) : null,
    ))
  const resolvedMarkets = markets
    .filter((market) => market.status === 'resolved')
    .map((market) => toOverviewMarketRow(
      market,
      market.trialQuestionId ? (linkedOverviewByQuestionId.get(market.trialQuestionId) ?? null) : null,
    ))

  return {
    success: true,
    generatedAt: linkedOverview?.generatedAt ?? new Date().toISOString(),
    accounts: [],
    openMarkets,
    resolvedMarkets,
    equityHistory: [],
    recentActions: [],
    recentRuns: [],
  }
}
