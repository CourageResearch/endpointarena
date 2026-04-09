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

export const AI_SUBSCRIPTION_MODEL_IDS = ['claude-opus', 'gpt-5.2'] as const satisfies readonly ModelId[]
export type AiSubscriptionModelId = (typeof AI_SUBSCRIPTION_MODEL_IDS)[number]

export type AiModelLane = 'api' | 'subscription'
export const AI_API_CONCURRENCY_MIN = 1
export const AI_API_CONCURRENCY_MAX = 8
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
    : 'All open trial markets currently eligible for the desk.'
}

export function getAiModelLabel(modelId: ModelId): string {
  return MODEL_INFO[modelId].fullName
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
