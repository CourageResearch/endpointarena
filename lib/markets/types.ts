import type { ModelId } from '@/lib/constants'

export type DailyRunStatus = 'ok' | 'error' | 'skipped'

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
  openMarkets: number
  totalActions: number
  processedActions: number
  summary: DailyRunSummary
  results: DailyRunResult[]
}

export type DailyRunStreamEvent =
  | {
      type: 'start'
      runDate: string
      modelOrder: ModelId[]
      openMarkets: number
      totalActions: number
    }
  | {
      type: 'activity'
      completedActions: number
      totalActions: number
      message: string
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
    runDate: string
    modelOrder: ModelId[]
    openMarkets: number
    totalActions: number
  }) => void
  onActivity?: (input: {
    completedActions: number
    totalActions: number
    message: string
  }) => void
  onProgress?: (input: {
    completedActions: number
    totalActions: number
    result: DailyRunResult
  }) => void
}
