import { MODEL_IDS, MODEL_INFO, type ModelId } from '@/lib/constants'
import type { ModelDecisionInput, ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'

export const AI2_DATASETS = ['toy', 'live'] as const
export type Ai2Dataset = (typeof AI2_DATASETS)[number]
export const AI2_SUBSCRIPTION_EXPORT_WORKFLOW = 'admin-ai-batch-export'
export const AI2_SUBSCRIPTION_IMPORT_WORKFLOW = 'admin-ai-batch-import'
export const LEGACY_AI2_SUBSCRIPTION_EXPORT_WORKFLOW = 'admin-ai2-batch-export'
export const LEGACY_AI2_SUBSCRIPTION_IMPORT_WORKFLOW = 'admin-ai2-batch-import'

export const AI2_BATCH_STATUSES = [
  'collecting',
  'waiting',
  'ready',
  'clearing',
  'cleared',
  'failed',
  'reset',
] as const
export type Ai2BatchStatus = (typeof AI2_BATCH_STATUSES)[number]

export const AI2_TASK_STATUSES = [
  'queued',
  'running',
  'waiting-import',
  'ready',
  'error',
  'cleared',
] as const
export type Ai2TaskStatus = (typeof AI2_TASK_STATUSES)[number]

export const AI2_LANE_STATUSES = [
  'collecting',
  'waiting',
  'ready',
  'clearing',
  'done',
  'failed',
] as const
export type Ai2LaneStatus = (typeof AI2_LANE_STATUSES)[number]

export const AI2_SUBSCRIPTION_MODEL_IDS = ['claude-opus', 'gpt-5.2'] as const satisfies readonly ModelId[]
export type Ai2SubscriptionModelId = (typeof AI2_SUBSCRIPTION_MODEL_IDS)[number]

export type Ai2ModelLane = 'api' | 'subscription'

export type Ai2DatasetSummary = {
  key: Ai2Dataset
  label: string
  description: string
  candidateCount: number
}

export type Ai2AvailableModel = {
  modelId: ModelId
  label: string
  provider: string
  lane: Ai2ModelLane
  available: boolean
  defaultEnabled: boolean
  disabledReason: string | null
}

export type Ai2FrozenPortfolio = {
  actorId: string
  cashAvailable: number
  yesSharesHeld: number
  noSharesHeld: number
  maxBuyUsd: number
  maxSellYesUsd: number
  maxSellNoUsd: number
}

export type Ai2FrozenMarketSnapshot = {
  priceYes: number
  priceNo: number
  qYes: number
  qNo: number
  b: number
  openedAt: string | null
  snapshotAt: string
}

export type Ai2BatchTrial = {
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
  marketSnapshot: Ai2FrozenMarketSnapshot
}

export type Ai2DecisionIntent = {
  forecast: ModelDecisionResult['forecast']
  action: ModelDecisionResult['action']
}

export type Ai2FillEvent = {
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

export type Ai2TaskFillSummary = {
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

export type Ai2DecisionTask = {
  taskKey: string
  marketId: string
  trialQuestionId: string
  trialId: string
  modelId: ModelId
  actorId: string
  lane: Ai2ModelLane
  status: Ai2TaskStatus
  frozenPortfolio: Ai2FrozenPortfolio
  frozenMarket: Ai2FrozenMarketSnapshot
  decision: Ai2DecisionIntent | null
  reasoningPreview: string | null
  snapshotId: string | null
  durationMs: number | null
  costSource: string | null
  estimatedCostUsd: number | null
  exportedAt: string | null
  importedAt: string | null
  errorMessage: string | null
  fill: Ai2TaskFillSummary | null
}

export type Ai2TrialClearPlan = {
  marketId: string
  trialQuestionId: string
  queue: Array<{
    modelId: ModelId
    taskKey: string
    position: number
  }>
}

export type Ai2PortfolioMarketPosition = {
  marketId: string
  trialQuestionId: string
  shortTitle: string
  yesShares: number
  noShares: number
}

export type Ai2PortfolioState = {
  modelId: ModelId
  actorId: string
  cashBalance: number
  totalYesShares: number
  totalNoShares: number
  markets: Ai2PortfolioMarketPosition[]
  latestActionSummary: string | null
}

export type Ai2BatchLog = {
  id: string
  at: string
  message: string
  tone: 'info' | 'success' | 'warning' | 'error'
}

export type Ai2BatchState = {
  id: string
  dataset: Ai2Dataset
  status: Ai2BatchStatus
  createdAt: string
  updatedAt: string
  runStartedAt: string | null
  clearOrder: ModelId[]
  enabledModelIds: ModelId[]
  trials: Ai2BatchTrial[]
  tasks: Ai2DecisionTask[]
  fills: Ai2FillEvent[]
  portfolioStates: Ai2PortfolioState[]
  logs: Ai2BatchLog[]
  failureMessage: string | null
}

export type Ai2DeskState = {
  dataset: Ai2Dataset
  datasets: Ai2DatasetSummary[]
  availableModels: Ai2AvailableModel[]
  batch: Ai2BatchState | null
}

export type Ai2SubscriptionExportTask = {
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

export type Ai2SubscriptionExportPacket = {
  version: 1
  workflow: typeof AI2_SUBSCRIPTION_EXPORT_WORKFLOW
  batchId: string
  dataset: Ai2Dataset
  modelId: ModelId
  exportedAt: string
  taskCount: number
  operatorInstructions: string[]
  responseTemplate: Ai2SubscriptionImportPacket
  tasks: Ai2SubscriptionExportTask[]
}

export type Ai2SubscriptionImportItem = {
  taskKey: string
  decision: ModelDecisionResult
}

export type Ai2SubscriptionImportPacket = {
  version: 1
  workflow: typeof AI2_SUBSCRIPTION_IMPORT_WORKFLOW
  batchId: string
  modelId: ModelId
  decisions: Ai2SubscriptionImportItem[]
}

export function isAi2Dataset(value: string | null | undefined): value is Ai2Dataset {
  return AI2_DATASETS.includes(value as Ai2Dataset)
}

export function isAi2SubscriptionModelId(modelId: ModelId): modelId is Ai2SubscriptionModelId {
  return AI2_SUBSCRIPTION_MODEL_IDS.includes(modelId as Ai2SubscriptionModelId)
}

export function isAi2SubscriptionImportWorkflow(value: string): value is typeof AI2_SUBSCRIPTION_IMPORT_WORKFLOW | typeof LEGACY_AI2_SUBSCRIPTION_IMPORT_WORKFLOW {
  return value === AI2_SUBSCRIPTION_IMPORT_WORKFLOW || value === LEGACY_AI2_SUBSCRIPTION_IMPORT_WORKFLOW
}

export function getAi2ModelLane(modelId: ModelId): Ai2ModelLane {
  return isAi2SubscriptionModelId(modelId) ? 'subscription' : 'api'
}

export function buildAi2TaskKey(batchId: string, marketId: string, modelId: ModelId): string {
  return `${batchId}:${marketId}:${modelId}`
}

export function getAi2DatasetLabel(dataset: Ai2Dataset): string {
  return dataset === 'toy' ? 'Toy' : 'Live'
}

export function getAi2DatasetDescription(dataset: Ai2Dataset): string {
  return dataset === 'toy'
    ? 'A small-slate batch for fast testing.'
    : 'All open trial markets currently eligible for the desk.'
}

export function getAi2ModelLabel(modelId: ModelId): string {
  return MODEL_INFO[modelId].fullName
}

export function listAi2SupportedModelIds(): readonly ModelId[] {
  return MODEL_IDS
}

export function buildAi2TrialClearPlans(batch: Ai2BatchState): Ai2TrialClearPlan[] {
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
      .filter((value): value is Ai2TrialClearPlan['queue'][number] => value !== null),
  }))
}

export function summarizeAi2Lane(batch: Ai2BatchState | null, modelIds: readonly ModelId[]): Ai2LaneStatus {
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
