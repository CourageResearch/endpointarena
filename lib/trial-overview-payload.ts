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

function trimTrialForBrowse(market: OpenMarketRow): OpenMarketRow {
  return {
    ...market,
    modelStates: market.modelStates.map(trimDecisionStateForBrowse),
  }
}

export function createBrowseTrialsOverviewPayload(data: OverviewResponse | null): OverviewResponse | null {
  if (!data) return null

  return {
    ...data,
    accounts: [],
    equityHistory: [],
    recentActions: [],
    recentRuns: [],
    openMarkets: data.openMarkets.map(trimTrialForBrowse),
    resolvedMarkets: data.resolvedMarkets.map(trimTrialForBrowse),
  }
}

export function createDetailTrialsOverviewPayload(data: OverviewResponse | null): OverviewResponse | null {
  if (!data) return null

  return {
    ...data,
    accounts: [],
    equityHistory: [],
    recentRuns: [],
  }
}
