import { MODEL_IDS, MODEL_INFO, type ModelId } from '@/lib/constants'
import type { ModelDecisionInput, ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'

export const AI_DATASETS = ['toy', 'live'] as const
export type AiDataset = (typeof AI_DATASETS)[number]
export const AI_SUBSCRIPTION_EXPORT_WORKFLOW = 'admin-ai-batch-export'
export const AI_SUBSCRIPTION_IMPORT_WORKFLOW = 'admin-ai-batch-import'
const LEGACY_AI_SUBSCRIPTION_EXPORT_WORKFLOW = 'admin-ai2-batch-export'
export const LEGACY_AI_SUBSCRIPTION_IMPORT_WORKFLOW = 'admin-ai2-batch-import'

export const AI_BATCH_STATUSES = [
  'collecting',
  'waiting',
  'ready',
  'clearing',
  'cleared',
  'failed',
  'reset',
] as const
export type AiBatchStatus = (typeof AI_BATCH_STATUSES)[number]

export const AI_TASK_STATUSES = [
  'queued',
  'running',
  'waiting-import',
  'ready',
  'error',
  'cleared',
] as const
export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number]

const AI_LANE_STATUSES = [
  'collecting',
  'waiting',
  'ready',
  'clearing',
  'done',
  'failed',
] as const
export type AiLaneStatus = (typeof AI_LANE_STATUSES)[number]

export const AI_SUBSCRIPTION_MODEL_IDS = ['claude-opus', 'gpt-5.4'] as const satisfies readonly ModelId[]
export type AiSubscriptionModelId = (typeof AI_SUBSCRIPTION_MODEL_IDS)[number]

export type AiModelLane = 'api' | 'subscription'
export const AI_API_CONCURRENCY_MIN = 1
export const AI_API_CONCURRENCY_MAX = 10
export const AI_API_CONCURRENCY_DEFAULT = 4

export type AiDatasetSummary = {
  key: AiDataset
  label: string
  description: string
  candidateCount: number
}

export type AiAvailableModel = {
  modelId: ModelId
  label: string
  provider: string
  lane: AiModelLane
  available: boolean
  defaultEnabled: boolean
  disabledReason: string | null
}

export type AiFrozenPortfolio = {
  actorId: string
  cashAvailable: number
  yesSharesHeld: number
  noSharesHeld: number
  maxBuyUsd: number
  maxSellYesUsd: number
  maxSellNoUsd: number
}

export type AiFrozenMarketSnapshot = {
  priceYes: number
  priceNo: number
  qYes: number
  qNo: number
  b: number
  openedAt: string | null
  snapshotAt: string
}

export type AiBatchTrial = {
  marketId: string
  trialQuestionId: string
  trialId: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  nctNumber: string | null
  decisionDate: string
  questionPrompt: string
  exactPhase: string
  indication: string
  intervention: string
  primaryEndpoint: string
  currentStatus: string
  briefSummary: string
  marketSnapshot: AiFrozenMarketSnapshot
}

export type AiDecisionIntent = {
  forecast: ModelDecisionResult['forecast']
  action: ModelDecisionResult['action']
}

export type AiFillEvent = {
  id: string
  marketId: string
  trialQuestionId: string
  modelId: ModelId
  taskKey: string
  requestedAction: ModelDecisionResult['action']['type']
  requestedAmountUsd: number
  executedAction: ModelDecisionResult['action']['type']
  executedAmountUsd: number
  sharesDelta: number
  priceBefore: number
  priceAfter: number
  explanation: string
  snapshotId: string | null
  marketActionId: string | null
  status: 'ok' | 'error'
  createdAt: string
  errorMessage: string | null
}

export type AiTaskFillSummary = {
  fillEventId: string | null
  marketActionId: string | null
  executedAction: ModelDecisionResult['action']['type']
  executedAmountUsd: number
  sharesDelta: number
  priceBefore: number
  priceAfter: number
  explanation: string
  status: 'ok' | 'error'
  errorMessage: string | null
}

export type AiDecisionTask = {
  taskKey: string
  marketId: string
  trialQuestionId: string
  trialId: string
  modelId: ModelId
  actorId: string
  lane: AiModelLane
  status: AiTaskStatus
  startedAt?: string | null
  frozenPortfolio: AiFrozenPortfolio
  frozenMarket: AiFrozenMarketSnapshot
  decision: AiDecisionIntent | null
  reasoningPreview: string | null
  snapshotId: string | null
  durationMs: number | null
  costSource: string | null
  estimatedCostUsd: number | null
  exportedAt: string | null
  importedAt: string | null
  errorMessage: string | null
  fill: AiTaskFillSummary | null
}

export type AiTrialClearPlan = {
  marketId: string
  trialQuestionId: string
  queue: Array<{
    modelId: ModelId
    taskKey: string
    position: number
  }>
}

export type AiPortfolioMarketPosition = {
  marketId: string
  trialQuestionId: string
  shortTitle: string
  yesShares: number
  noShares: number
}

export type AiPortfolioState = {
  modelId: ModelId
  actorId: string
  cashBalance: number
  totalYesShares: number
  totalNoShares: number
  markets: AiPortfolioMarketPosition[]
  latestActionSummary: string | null
}

export type AiBatchLog = {
  id: string
  at: string
  message: string
  tone: 'info' | 'success' | 'warning' | 'error'
}

export type AiBatchState = {
  id: string
  dataset: AiDataset
  status: AiBatchStatus
  createdAt: string
  updatedAt: string
  runStartedAt: string | null
  apiConcurrency: number
  clearOrder: ModelId[]
  enabledModelIds: ModelId[]
  trials: AiBatchTrial[]
  tasks: AiDecisionTask[]
  fills: AiFillEvent[]
  portfolioStates: AiPortfolioState[]
  logs: AiBatchLog[]
  failureMessage: string | null
}

export type AiDeskState = {
  dataset: AiDataset
  datasets: AiDatasetSummary[]
  availableModels: AiAvailableModel[]
  batch: AiBatchState | null
}

export type AiBatchTaskCounts = {
  total: number
  queued: number
  running: number
  waitingImport: number
  ready: number
  cleared: number
  error: number
}

export type AiBatchModelDurationSummary = {
  modelId: ModelId
  label: string
  lane: AiModelLane
  completedCount: number
  queuedCount: number
  runningCount: number
  readyCount: number
  clearedCount: number
  averageDurationMs: number | null
}

export type AiBatchRecentFill = {
  id: string
  at: string
  modelId: ModelId
  modelLabel: string
  trialLabel: string
  executedAction: ModelDecisionResult['action']['type']
  executedAmountUsd: number
  priceBefore: number
  priceAfter: number
  status: 'ok' | 'error'
}

export type AiBatchProgress = {
  batchId: string
  status: AiBatchStatus
  runStartedAt: string | null
  latestActivityAt: string
  elapsedMs: number | null
  apiConcurrency: number
  trialCount: number
  modelCount: number
  enabledModelIds: ModelId[]
  clearOrder: ModelId[]
  completionRatio: number
  taskCounts: AiBatchTaskCounts
  laneCounts: Record<AiModelLane, AiBatchTaskCounts>
  etaMs: number | null
  etaBasis: 'api' | 'clearing' | 'blocked' | 'none'
  recentLogs: AiBatchLog[]
  recentFills: AiBatchRecentFill[]
  modelDurations: AiBatchModelDurationSummary[]
  fillCount: number
  logCount: number
  failureMessage: string | null
}

export type AiLiveTradeExecutionTrade = {
  modelKey: ModelId
  marketSlug: string
  action: ModelDecisionResult['action']['type']
  requestedAction: ModelDecisionResult['action']['type']
  requestedAmountDisplay: number
  executedAmountDisplay: number
  shareAmountDisplay: number
  explanation: string
  priceYes?: number
  priceBefore?: number
  priceAfter?: number
  txHash: string
}

export type AiLiveTradeExecutionSkip = {
  modelKey: string
  marketSlug?: string | null
  reason: string
}

export type AiLiveTradeExecutionSummary = {
  tradesExecuted: number
  trades: AiLiveTradeExecutionTrade[]
  skipped: AiLiveTradeExecutionSkip[]
}

export type AiLiveTradeExecutionReconciliation = {
  status: AiBatchStatus
  failureMessage: string | null
  tasks: AiDecisionTask[]
  fills: AiFillEvent[]
  okCount: number
  errorCount: number
  errorMessages: string[]
}

export type AiSubscriptionExportTask = {
  taskKey: string
  marketId: string
  trialQuestionId: string
  modelId: ModelId
  shortTitle: string
  sponsorName: string
  nctNumber: string | null
  decisionDate: string
  input: ModelDecisionInput
  prompt: string
}

export type AiSubscriptionExportPacket = {
  version: 1
  workflow: typeof AI_SUBSCRIPTION_EXPORT_WORKFLOW
  batchId: string
  dataset: AiDataset
  modelId: ModelId
  exportedAt: string
  taskCount: number
  operatorInstructions: string[]
  responseTemplate: AiSubscriptionImportPacket
  tasks: AiSubscriptionExportTask[]
}

export type AiSubscriptionImportItem = {
  taskKey: string
  decision: ModelDecisionResult
}

export type AiSubscriptionImportPacket = {
  version: 1
  workflow: typeof AI_SUBSCRIPTION_IMPORT_WORKFLOW
  batchId: string
  modelId: ModelId
  decisions: AiSubscriptionImportItem[]
}

export function isAiDataset(value: string | null | undefined): value is AiDataset {
  return AI_DATASETS.includes(value as AiDataset)
}

function isAiSubscriptionModelId(modelId: ModelId): modelId is AiSubscriptionModelId {
  return AI_SUBSCRIPTION_MODEL_IDS.includes(modelId as AiSubscriptionModelId)
}

export function isAiSubscriptionImportWorkflow(value: string): value is typeof AI_SUBSCRIPTION_IMPORT_WORKFLOW | typeof LEGACY_AI_SUBSCRIPTION_IMPORT_WORKFLOW {
  return value === AI_SUBSCRIPTION_IMPORT_WORKFLOW || value === LEGACY_AI_SUBSCRIPTION_IMPORT_WORKFLOW
}

export function getAiModelLane(modelId: ModelId): AiModelLane {
  return isAiSubscriptionModelId(modelId) ? 'subscription' : 'api'
}

export function isAiApiConcurrency(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= AI_API_CONCURRENCY_MIN
    && value <= AI_API_CONCURRENCY_MAX
}

export function normalizeAiApiConcurrency(value: unknown): number {
  return isAiApiConcurrency(value) ? value : AI_API_CONCURRENCY_DEFAULT
}

export function buildAiTaskKey(batchId: string, marketId: string, modelId: ModelId): string {
  return `${batchId}:${marketId}:${modelId}`
}

export function getAiDatasetLabel(dataset: AiDataset): string {
  return dataset === 'toy' ? 'Toy' : 'Live'
}

export function getAiDatasetDescription(dataset: AiDataset): string {
  return dataset === 'toy'
    ? 'A small-slate batch for fast testing.'
    : 'All deployed season 4-linked trial markets currently eligible for the desk.'
}

export function filterAiLiveCandidatesToSeason4TrialQuestions<T extends { question: { id: string } }>(
  candidates: T[],
  season4TrialQuestionIds: Iterable<string>,
): T[] {
  const linkedIds = new Set(
    Array.from(season4TrialQuestionIds)
      .map((value) => value.trim())
      .filter(Boolean),
  )

  if (linkedIds.size === 0) {
    return []
  }

  return candidates.filter((candidate) => linkedIds.has(candidate.question.id))
}

export function getAiModelLabel(modelId: ModelId): string {
  return MODEL_INFO[modelId]?.fullName ?? modelId
}

export function listAiSupportedModelIds(): readonly ModelId[] {
  return MODEL_IDS
}

function buildAiTrialClearPlans(batch: AiBatchState): AiTrialClearPlan[] {
  return batch.trials.map((trial) => ({
    marketId: trial.marketId,
    trialQuestionId: trial.trialQuestionId,
    queue: batch.clearOrder
      .map((modelId, index) => {
        const task = batch.tasks.find((entry) => entry.marketId === trial.marketId && entry.modelId === modelId)
        if (!task) return null
        return {
          modelId,
          taskKey: task.taskKey,
          position: index + 1,
        }
      })
      .filter((value): value is AiTrialClearPlan['queue'][number] => value !== null),
  }))
}

function summarizeAiLane(batch: AiBatchState | null, modelIds: readonly ModelId[]): AiLaneStatus {
  if (!batch) return 'waiting'

  const tasks = batch.tasks.filter((task) => modelIds.includes(task.modelId))
  if (tasks.length === 0) return 'waiting'
  if (tasks.some((task) => task.status === 'error')) return 'failed'
  if (batch.status === 'clearing') return 'clearing'
  if (tasks.every((task) => task.status === 'cleared')) return 'done'
  if (tasks.every((task) => task.status === 'ready' || task.status === 'cleared')) return 'ready'
  if (!batch.runStartedAt) return 'waiting'
  if (tasks.some((task) => task.status === 'running')) return 'collecting'
  if (tasks.some((task) => task.status === 'waiting-import')) return 'waiting'
  return 'collecting'
}

const AI_PROGRESS_RECENT_LOG_LIMIT = 12
const AI_PROGRESS_RECENT_FILL_LIMIT = 12
const AI_PROGRESS_CLEAR_RATE_WINDOW = 20

function buildEmptyTaskCounts(): AiBatchTaskCounts {
  return {
    total: 0,
    queued: 0,
    running: 0,
    waitingImport: 0,
    ready: 0,
    cleared: 0,
    error: 0,
  }
}

function incrementTaskCounts(counts: AiBatchTaskCounts, task: AiDecisionTask): void {
  counts.total += 1

  if (task.status === 'queued') counts.queued += 1
  if (task.status === 'running') counts.running += 1
  if (task.status === 'waiting-import') counts.waitingImport += 1
  if (task.status === 'ready') counts.ready += 1
  if (task.status === 'cleared') counts.cleared += 1
  if (task.status === 'error') counts.error += 1
}

function getLatestActivityAt(batch: AiBatchState): string {
  const candidates = [
    batch.updatedAt,
    batch.runStartedAt,
    batch.logs[batch.logs.length - 1]?.at ?? null,
    batch.fills[batch.fills.length - 1]?.createdAt ?? null,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))

  if (candidates.length === 0) {
    return new Date().toISOString()
  }

  return new Date(Math.max(...candidates)).toISOString()
}

function estimateAiBatchEtaMs(batch: AiBatchState, taskCounts: AiBatchTaskCounts, laneCounts: Record<AiModelLane, AiBatchTaskCounts>): {
  etaMs: number | null
  etaBasis: AiBatchProgress['etaBasis']
} {
  if (batch.status === 'cleared') {
    return {
      etaMs: 0,
      etaBasis: 'none',
    }
  }

  if (batch.status === 'failed' || batch.status === 'reset') {
    return {
      etaMs: null,
      etaBasis: 'none',
    }
  }

  if (laneCounts.subscription.waitingImport > 0) {
    return {
      etaMs: null,
      etaBasis: 'blocked',
    }
  }

  if (batch.status === 'clearing') {
    const recentFills = batch.fills.slice(-AI_PROGRESS_CLEAR_RATE_WINDOW)
    if (recentFills.length >= 2) {
      const firstAt = new Date(recentFills[0].createdAt).getTime()
      const lastAt = new Date(recentFills[recentFills.length - 1].createdAt).getTime()
      const spanMs = lastAt - firstAt
      const averageFillIntervalMs = spanMs > 0 ? spanMs / (recentFills.length - 1) : 0
      const remainingTaskCount = Math.max(0, taskCounts.total - taskCounts.cleared)
      if (averageFillIntervalMs > 0 && remainingTaskCount > 0) {
        return {
          etaMs: Math.round(averageFillIntervalMs * remainingTaskCount),
          etaBasis: 'clearing',
        }
      }
    }
  }

  const completedApiTasks = batch.tasks.filter((task) => task.lane === 'api' && task.durationMs != null)
  const averageApiDurationMs = completedApiTasks.length > 0
    ? completedApiTasks.reduce((sum, task) => sum + (task.durationMs ?? 0), 0) / completedApiTasks.length
    : null
  const remainingApiTasks = laneCounts.api.queued + laneCounts.api.running

  if (averageApiDurationMs != null && averageApiDurationMs > 0 && remainingApiTasks > 0) {
    const waves = Math.ceil(remainingApiTasks / Math.max(1, batch.apiConcurrency))
    return {
      etaMs: Math.round(waves * averageApiDurationMs),
      etaBasis: 'api',
    }
  }

  return {
    etaMs: null,
    etaBasis: 'none',
  }
}

export function deriveAiBatchProgress(batch: AiBatchState | null): AiBatchProgress | null {
  if (!batch) return null

  const taskCounts = buildEmptyTaskCounts()
  const laneCounts: Record<AiModelLane, AiBatchTaskCounts> = {
    api: buildEmptyTaskCounts(),
    subscription: buildEmptyTaskCounts(),
  }

  for (const task of batch.tasks) {
    incrementTaskCounts(taskCounts, task)
    incrementTaskCounts(laneCounts[task.lane], task)
  }

  const recentLogs = batch.logs.slice(-AI_PROGRESS_RECENT_LOG_LIMIT).reverse()
  const trialLabelByMarketId = new Map(batch.trials.map((trial) => [trial.marketId, trial.nctNumber?.trim() || trial.shortTitle] as const))
  const recentFills = batch.fills
    .slice(-AI_PROGRESS_RECENT_FILL_LIMIT)
    .reverse()
    .map((fill) => ({
      id: fill.id,
      at: fill.createdAt,
      modelId: fill.modelId,
      modelLabel: getAiModelLabel(fill.modelId),
      trialLabel: trialLabelByMarketId.get(fill.marketId) ?? fill.marketId,
      executedAction: fill.executedAction,
      executedAmountUsd: fill.executedAmountUsd,
      priceBefore: fill.priceBefore,
      priceAfter: fill.priceAfter,
      status: fill.status,
    }))
  const modelDurations = batch.enabledModelIds.map((modelId) => {
    const tasks = batch.tasks.filter((task) => task.modelId === modelId)
    const completedTasks = tasks.filter((task) => task.durationMs != null)
    const totalDurationMs = completedTasks.reduce((sum, task) => sum + (task.durationMs ?? 0), 0)

    return {
      modelId,
      label: getAiModelLabel(modelId),
      lane: getAiModelLane(modelId),
      completedCount: completedTasks.length,
      queuedCount: tasks.filter((task) => task.status === 'queued').length,
      runningCount: tasks.filter((task) => task.status === 'running').length,
      readyCount: tasks.filter((task) => task.status === 'ready').length,
      clearedCount: tasks.filter((task) => task.status === 'cleared').length,
      averageDurationMs: completedTasks.length > 0 ? totalDurationMs / completedTasks.length : null,
    }
  })
  const { etaMs, etaBasis } = estimateAiBatchEtaMs(batch, taskCounts, laneCounts)
  const nowMs = Date.now()
  const startedAtMs = batch.runStartedAt ? new Date(batch.runStartedAt).getTime() : Number.NaN

  return {
    batchId: batch.id,
    status: batch.status,
    runStartedAt: batch.runStartedAt,
    latestActivityAt: getLatestActivityAt(batch),
    elapsedMs: Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : null,
    apiConcurrency: batch.apiConcurrency,
    trialCount: batch.trials.length,
    modelCount: batch.enabledModelIds.length,
    enabledModelIds: batch.enabledModelIds,
    clearOrder: batch.clearOrder,
    completionRatio: taskCounts.total > 0 ? taskCounts.cleared / taskCounts.total : 0,
    taskCounts,
    laneCounts,
    etaMs,
    etaBasis,
    recentLogs,
    recentFills,
    modelDurations,
    fillCount: batch.fills.length,
    logCount: batch.logs.length,
    failureMessage: batch.failureMessage,
  }
}

function buildLiveExecutionKey(modelId: string, marketId: string): string {
  return `${modelId}:${marketId}`
}

function finiteOrFallback(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getSkippedTradeReason(task: AiDecisionTask, skipped: AiLiveTradeExecutionSkip[]): string | null {
  const exact = skipped.find((entry) => entry.modelKey === task.modelId && entry.marketSlug === task.marketId)
  if (exact) return exact.reason

  const modelWide = skipped.find((entry) => entry.modelKey === task.modelId && !entry.marketSlug)
  if (modelWide) return modelWide.reason

  const marketWide = skipped.find((entry) => entry.modelKey === 'all' && (!entry.marketSlug || entry.marketSlug === task.marketId))
  if (marketWide) return marketWide.reason

  return null
}

function getSharesDelta(action: ModelDecisionResult['action']['type'], shareAmountDisplay: number): number {
  const shares = Math.max(0, finiteOrFallback(shareAmountDisplay, 0))
  return action === 'SELL_YES' || action === 'SELL_NO' ? -shares : shares
}

function appendFillOnce(fills: AiFillEvent[], seenTaskKeys: Set<string>, fill: AiFillEvent): void {
  if (seenTaskKeys.has(fill.taskKey)) return
  fills.push(fill)
  seenTaskKeys.add(fill.taskKey)
}

export function reconcileAiLiveTradeExecution(
  batch: AiBatchState,
  summary: AiLiveTradeExecutionSummary,
  nowIso = new Date().toISOString(),
): AiLiveTradeExecutionReconciliation {
  const tradesByTask = new Map(
    summary.trades.map((trade) => [buildLiveExecutionKey(trade.modelKey, trade.marketSlug), trade] as const),
  )
  const nextFills = [...batch.fills]
  const filledTaskKeys = new Set(nextFills.map((fill) => fill.taskKey))
  const errorMessages: string[] = []
  let okCount = 0
  let errorCount = 0

  const nextTasks = batch.tasks.map((task) => {
    if (task.status !== 'ready') return task

    const taskKey = buildLiveExecutionKey(task.modelId, task.marketId)
    const trade = tradesByTask.get(taskKey)
    const requestedAction = task.decision?.action.type ?? trade?.requestedAction ?? 'HOLD'
    const requestedAmountUsd = task.decision?.action.amountUsd ?? trade?.requestedAmountDisplay ?? 0
    const fallbackPrice = finiteOrFallback(task.frozenMarket.priceYes, 0.5)

    if (trade) {
      const priceBefore = finiteOrFallback(trade.priceBefore, finiteOrFallback(trade.priceYes, fallbackPrice))
      const priceAfter = finiteOrFallback(trade.priceAfter, finiteOrFallback(trade.priceYes, priceBefore))
      const fillSummary: AiTaskFillSummary = {
        fillEventId: trade.txHash,
        marketActionId: null,
        executedAction: trade.action,
        executedAmountUsd: Math.max(0, finiteOrFallback(trade.executedAmountDisplay, 0)),
        sharesDelta: getSharesDelta(trade.action, trade.shareAmountDisplay),
        priceBefore,
        priceAfter,
        explanation: trade.explanation,
        status: 'ok',
        errorMessage: null,
      }
      const fillEvent: AiFillEvent = {
        id: trade.txHash,
        marketId: task.marketId,
        trialQuestionId: task.trialQuestionId,
        modelId: task.modelId,
        taskKey: task.taskKey,
        requestedAction,
        requestedAmountUsd,
        executedAction: fillSummary.executedAction,
        executedAmountUsd: fillSummary.executedAmountUsd,
        sharesDelta: fillSummary.sharesDelta,
        priceBefore,
        priceAfter,
        explanation: fillSummary.explanation,
        snapshotId: task.snapshotId,
        marketActionId: null,
        status: 'ok',
        createdAt: nowIso,
        errorMessage: null,
      }

      appendFillOnce(nextFills, filledTaskKeys, fillEvent)
      okCount += 1
      return {
        ...task,
        status: 'cleared' as const,
        fill: fillSummary,
      }
    }

    if (task.decision?.action.type === 'HOLD') {
      const fillId = `hold:${task.taskKey}:${nowIso}`
      const fillSummary: AiTaskFillSummary = {
        fillEventId: fillId,
        marketActionId: null,
        executedAction: 'HOLD',
        executedAmountUsd: 0,
        sharesDelta: 0,
        priceBefore: fallbackPrice,
        priceAfter: fallbackPrice,
        explanation: task.decision.action.explanation,
        status: 'ok',
        errorMessage: null,
      }
      const fillEvent: AiFillEvent = {
        id: fillId,
        marketId: task.marketId,
        trialQuestionId: task.trialQuestionId,
        modelId: task.modelId,
        taskKey: task.taskKey,
        requestedAction: 'HOLD',
        requestedAmountUsd,
        executedAction: 'HOLD',
        executedAmountUsd: 0,
        sharesDelta: 0,
        priceBefore: fallbackPrice,
        priceAfter: fallbackPrice,
        explanation: fillSummary.explanation,
        snapshotId: task.snapshotId,
        marketActionId: null,
        status: 'ok',
        createdAt: nowIso,
        errorMessage: null,
      }

      appendFillOnce(nextFills, filledTaskKeys, fillEvent)
      okCount += 1
      return {
        ...task,
        status: 'cleared' as const,
        fill: fillSummary,
      }
    }

    const skipReason = getSkippedTradeReason(task, summary.skipped)
    const message = skipReason
      ? `Trade execution skipped for ${getAiModelLabel(task.modelId)} on ${task.marketId}: ${skipReason}`
      : `Trade execution returned no fill for ${getAiModelLabel(task.modelId)} on ${task.marketId}.`
    const fillId = `error:${task.taskKey}:${nowIso}`
    const fillSummary: AiTaskFillSummary = {
      fillEventId: fillId,
      marketActionId: null,
      executedAction: 'HOLD',
      executedAmountUsd: 0,
      sharesDelta: 0,
      priceBefore: fallbackPrice,
      priceAfter: fallbackPrice,
      explanation: message,
      status: 'error',
      errorMessage: message,
    }
    const fillEvent: AiFillEvent = {
      id: fillId,
      marketId: task.marketId,
      trialQuestionId: task.trialQuestionId,
      modelId: task.modelId,
      taskKey: task.taskKey,
      requestedAction,
      requestedAmountUsd,
      executedAction: 'HOLD',
      executedAmountUsd: 0,
      sharesDelta: 0,
      priceBefore: fallbackPrice,
      priceAfter: fallbackPrice,
      explanation: message,
      snapshotId: task.snapshotId,
      marketActionId: null,
      status: 'error',
      createdAt: nowIso,
      errorMessage: message,
    }

    appendFillOnce(nextFills, filledTaskKeys, fillEvent)
    errorCount += 1
    errorMessages.push(message)
    return {
      ...task,
      status: 'error' as const,
      errorMessage: message,
      fill: fillSummary,
    }
  })

  return {
    status: errorCount > 0 ? 'failed' : 'cleared',
    failureMessage: errorMessages[0] ?? null,
    tasks: nextTasks,
    fills: nextFills,
    okCount,
    errorCount,
    errorMessages,
  }
}
