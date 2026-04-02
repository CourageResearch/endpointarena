import type { MarketModelState, OpenMarketRow, OverviewResponse } from '@/lib/markets/overview-shared'

function trimDecisionStateForBrowse(state: MarketModelState): MarketModelState {
  return {
    ...state,
    latestDecision: state.latestDecision
      ? {
          ...state.latestDecision,
          forecast: {
            ...state.latestDecision.forecast,
            reasoning: '',
          },
          action: null,
        }
      : null,
    decisionHistory: [],
    latestAction: null,
  }
}

function trimMarketForBrowse(market: OpenMarketRow): OpenMarketRow {
  return {
    ...market,
    modelStates: market.modelStates.map(trimDecisionStateForBrowse),
  }
}

export function createBrowseOverviewPayload(data: OverviewResponse | null): OverviewResponse | null {
  if (!data) return null

  return {
    ...data,
    accounts: [],
    equityHistory: [],
    recentActions: [],
    recentRuns: [],
    openMarkets: data.openMarkets.map(trimMarketForBrowse),
    resolvedMarkets: data.resolvedMarkets.map(trimMarketForBrowse),
  }
}

export function createDetailOverviewPayload(data: OverviewResponse | null): OverviewResponse | null {
  if (!data) return null

  return {
    ...data,
    accounts: [],
    equityHistory: [],
    recentRuns: [],
  }
}

export const createBrowseTrialsOverviewPayload = createBrowseOverviewPayload
export const createDetailTrialsOverviewPayload = createDetailOverviewPayload
