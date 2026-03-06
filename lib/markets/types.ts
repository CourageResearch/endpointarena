import type { ModelId } from '@/lib/constants'

export type DailyRunStatus = 'ok' | 'error' | 'skipped'
export type DailyRunActivityPhase = 'running' | 'waiting'

export type DailyRunPlannedMarket = {
  marketId: string
  fdaEventId: string
  drugName: string
  companyName: string
  pdufaDate: string
}

export type DailyRunResult = {
  marketId: string
  fdaEventId: string
  modelId: ModelId
  action: string
  amountUsd: number
  status: DailyRunStatus
  detail: string
}

export type DailyRunSummary = {
  ok: number
  error: number
  skipped: number
}

export type DailyRunPayload = {
  success: true
  runId: string
  runDate: string
  modelOrder: ModelId[]
  orderedMarkets: DailyRunPlannedMarket[]
  openMarkets: number
  totalActions: number
  processedActions: number
  summary: DailyRunSummary
  results: DailyRunResult[]
}

export type DailyRunStreamEvent =
  | {
      type: 'start'
      runId: string
      runDate: string
      modelOrder: ModelId[]
      orderedMarkets: DailyRunPlannedMarket[]
      openMarkets: number
      totalActions: number
    }
  | {
      type: 'activity'
      completedActions: number
      totalActions: number
      message: string
      marketId?: string
      fdaEventId?: string
      modelId?: ModelId
      phase?: DailyRunActivityPhase
    }
  | {
      type: 'progress'
      completedActions: number
      totalActions: number
      result: DailyRunResult
    }
  | {
      type: 'done'
      payload: DailyRunPayload
    }
  | {
      type: 'error'
      message: string
    }

export type DailyRunHooks = {
  onStart?: (input: {
    runId: string
    runDate: string
    modelOrder: ModelId[]
    orderedMarkets: DailyRunPlannedMarket[]
    openMarkets: number
    totalActions: number
  }) => void
  onActivity?: (input: {
    completedActions: number
    totalActions: number
    message: string
    marketId?: string
    fdaEventId?: string
    modelId?: ModelId
    phase?: DailyRunActivityPhase
  }) => void
  onProgress?: (input: {
    completedActions: number
    totalActions: number
    result: DailyRunResult
  }) => void
}
