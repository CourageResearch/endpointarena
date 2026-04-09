import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import {
  db,
  ai2Batches,
  marketAccounts,
  marketPositions,
  predictionMarkets,
  trialQuestions,
  phase2Trials,
  type Ai2Batch as Ai2BatchRow,
} from '@/lib/db'
import {
  AI2_SUBSCRIPTION_EXPORT_WORKFLOW,
  AI2_SUBSCRIPTION_IMPORT_WORKFLOW,
  AI2_SUBSCRIPTION_MODEL_IDS,
  buildAi2TaskKey,
  getAi2DatasetDescription,
  getAi2DatasetLabel,
  getAi2ModelLabel,
  getAi2ModelLane,
  isAi2SubscriptionImportWorkflow,
  LEGACY_AI2_SUBSCRIPTION_IMPORT_WORKFLOW,
  listAi2SupportedModelIds,
  type Ai2AvailableModel,
  type Ai2BatchState,
  type Ai2BatchStatus,
  type Ai2Dataset,
  type Ai2DatasetSummary,
  type Ai2DecisionTask,
  type Ai2DeskState,
  type Ai2FrozenMarketSnapshot,
  type Ai2FrozenPortfolio,
  type Ai2PortfolioMarketPosition,
  type Ai2PortfolioState,
  type Ai2SubscriptionImportPacket,
  type Ai2SubscriptionModelId,
  type Ai2TaskStatus,
} from '@/lib/admin-ai2-shared'
import { MODEL_INFO, type ModelId } from '@/lib/constants'
import {
  normalizeRunDate,
  rotateModelOrder,
  ensureMarketAccounts,
  ensureMarketPositions,
  calculateExecutableTradeCaps,
  runBuyAction,
  runHoldAction,
  runSellAction,
  recordMarketActionError,
} from '@/lib/markets/engine'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { getModelActorIds } from '@/lib/market-actors'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { getModelDecisionGeneratorDisabledReason, MODEL_DECISION_GENERATORS } from '@/lib/predictions/model-decision-generators'
import { buildModelDecisionPrompt, parseModelDecisionResponse, type ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'
import { buildModelDecisionSnapshotInput, generateAndStoreModelDecisionSnapshot, linkSnapshotToMarketAction, storeImportedModelDecisionSnapshot } from '@/lib/model-decision-snapshots'
import { getMarketModelResponseTimeoutMs } from '@/lib/markets/run-health'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

type OpenTrialCandidate = {
  market: typeof predictionMarkets.$inferSelect
  question: typeof trialQuestions.$inferSelect & {
    trial: typeof phase2Trials.$inferSelect
  }
}

type CreateAi2BatchInput = {
  dataset: Ai2Dataset
  enabledModelIds: ModelId[]
}

declare global {
  // eslint-disable-next-line no-var
  var __endpointArenaAi2Workers: Map<string, Promise<void>> | undefined
  // eslint-disable-next-line no-var
  var __endpointArenaAi2Locks: Map<string, Promise<void>> | undefined
}

const ACTIVE_BATCH_STATUSES: Ai2BatchStatus[] = ['collecting', 'waiting', 'ready', 'clearing']

const ai2Workers = globalThis.__endpointArenaAi2Workers ?? new Map<string, Promise<void>>()
const ai2Locks = globalThis.__endpointArenaAi2Locks ?? new Map<string, Promise<void>>()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__endpointArenaAi2Workers = ai2Workers
  globalThis.__endpointArenaAi2Locks = ai2Locks
}

function isTerminalBatchStatus(status: Ai2BatchStatus): boolean {
  return status === 'cleared' || status === 'failed' || status === 'reset'
}

function toModelIds(values: Iterable<ModelId>): ModelId[] {
  return Array.from(new Set(values))
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseBatchState(row: Ai2BatchRow): Ai2BatchState {
  const state = row.state as unknown as Partial<Ai2BatchState>
  const inferredRunStartedAt = state.runStartedAt
    ?? (row.status === 'waiting' ? null : row.updatedAt.toISOString())

  return {
    id: row.id,
    dataset: row.dataset as Ai2Dataset,
    status: row.status as Ai2BatchStatus,
    createdAt: state.createdAt ?? row.createdAt.toISOString(),
    updatedAt: state.updatedAt ?? row.updatedAt.toISOString(),
    runStartedAt: inferredRunStartedAt,
    clearOrder: state.clearOrder ?? [],
    enabledModelIds: state.enabledModelIds ?? [],
    trials: state.trials ?? [],
    tasks: state.tasks ?? [],
    fills: state.fills ?? [],
    portfolioStates: state.portfolioStates ?? [],
    logs: state.logs ?? [],
    failureMessage: state.failureMessage ?? row.error ?? null,
  }
}

async function withBatchLock<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
  const previous = ai2Locks.get(batchId) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current, () => current)
  ai2Locks.set(batchId, tail)
  await previous

  try {
    return await fn()
  } finally {
    release()
    if (ai2Locks.get(batchId) === tail) {
      ai2Locks.delete(batchId)
    }
  }
}

function buildLog(message: string, tone: Ai2BatchState['logs'][number]['tone'] = 'info') {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    message,
    tone,
  }
}

async function listOpenTrialCandidates(): Promise<OpenTrialCandidate[]> {
  const markets = await db.query.predictionMarkets.findMany({
    where: and(
      eq(predictionMarkets.status, 'OPEN'),
      isNotNull(predictionMarkets.trialQuestionId),
    ),
    with: {
      trialQuestion: {
        with: {
          trial: true,
        },
      },
    },
  })

  return markets
    .filter((entry): entry is typeof entry & { trialQuestion: OpenTrialCandidate['question'] } => (
      Boolean(entry.trialQuestion?.trial)
    ))
    .filter((entry) => {
      const question = entry.trialQuestion
      if (!question) return false
      if (question.outcome !== 'Pending') return false
      if (question.status !== 'live' || !question.isBettable) return false
      return filterSupportedTrialQuestions([question]).length === 1
    })
    .map((entry) => ({
      market: entry,
      question: entry.trialQuestion,
    }))
    .sort((a, b) => {
      const aDecisionAt = a.question.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
      const bDecisionAt = b.question.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
      if (aDecisionAt !== bDecisionAt) return aDecisionAt - bDecisionAt

      const aOpenedAt = a.market.openedAt?.getTime() ?? 0
      const bOpenedAt = b.market.openedAt?.getTime() ?? 0
      if (aOpenedAt !== bOpenedAt) return aOpenedAt - bOpenedAt

      return a.market.id.localeCompare(b.market.id)
    })
}

export function getAi2AvailableModels(): Ai2AvailableModel[] {
  return listAi2SupportedModelIds().map((modelId) => {
    const lane = getAi2ModelLane(modelId)
    const available = lane === 'subscription' ? true : MODEL_DECISION_GENERATORS[modelId]?.enabled() ?? false

    return {
      modelId,
      label: getAi2ModelLabel(modelId),
      provider: MODEL_INFO[modelId].provider,
      lane,
      available,
      defaultEnabled: available,
      disabledReason: available ? null : getModelDecisionGeneratorDisabledReason(modelId),
    }
  })
}

async function buildDatasetSummaries(): Promise<Ai2DatasetSummary[]> {
  const [candidates, runtimeConfig] = await Promise.all([
    listOpenTrialCandidates(),
    getMarketRuntimeConfig(),
  ])
  const candidateCount = candidates.length
  return [
    {
      key: 'toy',
      label: getAi2DatasetLabel('toy'),
      description: getAi2DatasetDescription('toy'),
      candidateCount: Math.min(runtimeConfig.toyTrialCount, candidateCount),
    },
    {
      key: 'live',
      label: getAi2DatasetLabel('live'),
      description: getAi2DatasetDescription('live'),
      candidateCount,
    },
  ]
}

function pickDatasetTrials(
  dataset: Ai2Dataset,
  candidates: OpenTrialCandidate[],
  toyTrialCount: number,
): OpenTrialCandidate[] {
  if (dataset === 'toy') {
    const slice = candidates.slice(0, toyTrialCount)
    if (slice.length === 0) {
      throw new ValidationError('Toy mode needs at least 1 open trial to open a batch.')
    }
    return slice
  }

  if (candidates.length === 0) {
    throw new ValidationError('No open trials are currently available for the live desk.')
  }

  return candidates
}

function buildFrozenMarketSnapshot(candidate: OpenTrialCandidate): Ai2FrozenMarketSnapshot {
  return {
    priceYes: candidate.market.priceYes,
    priceNo: 1 - candidate.market.priceYes,
    qYes: candidate.market.qYes,
    qNo: candidate.market.qNo,
    b: candidate.market.b,
    openedAt: toIsoString(candidate.market.openedAt),
    snapshotAt: new Date().toISOString(),
  }
}

function buildFrozenPortfolio(input: {
  market: typeof predictionMarkets.$inferSelect
  account: typeof marketAccounts.$inferSelect
  position: typeof marketPositions.$inferSelect
  runDate: Date
  runtimeConfig: Awaited<ReturnType<typeof getMarketRuntimeConfig>>
}): Ai2FrozenPortfolio {
  const tradeCaps = calculateExecutableTradeCaps({
    state: {
      qYes: input.market.qYes,
      qNo: input.market.qNo,
      b: input.market.b,
    },
    accountCash: input.account.cashBalance,
    yesSharesHeld: input.position.yesShares,
    noSharesHeld: input.position.noShares,
    marketOpenedAt: input.market.openedAt,
    runDate: input.runDate,
    config: input.runtimeConfig,
  })

  return {
    actorId: input.account.actorId,
    cashAvailable: input.account.cashBalance,
    yesSharesHeld: input.position.yesShares,
    noSharesHeld: input.position.noShares,
    maxBuyUsd: tradeCaps.maxBuyUsd,
    maxSellYesUsd: tradeCaps.maxSellYesUsd,
    maxSellNoUsd: tradeCaps.maxSellNoUsd,
  }
}

function buildBatchTrial(candidate: OpenTrialCandidate): Ai2BatchState['trials'][number] {
  return {
    marketId: candidate.market.id,
    trialQuestionId: candidate.question.id,
    trialId: candidate.question.trial.id,
    shortTitle: candidate.question.trial.shortTitle,
    sponsorName: candidate.question.trial.sponsorName,
    sponsorTicker: candidate.question.trial.sponsorTicker ?? null,
    nctNumber: candidate.question.trial.nctNumber,
    decisionDate: candidate.question.trial.estPrimaryCompletionDate.toISOString(),
    questionPrompt: normalizeTrialQuestionPrompt(candidate.question.prompt),
    exactPhase: candidate.question.trial.exactPhase,
    indication: candidate.question.trial.indication,
    intervention: candidate.question.trial.intervention,
    primaryEndpoint: candidate.question.trial.primaryEndpoint,
    currentStatus: candidate.question.trial.currentStatus,
    briefSummary: candidate.question.trial.briefSummary,
    marketSnapshot: buildFrozenMarketSnapshot(candidate),
  }
}

function buildTaskStatus(lane: 'api' | 'subscription'): Ai2TaskStatus {
  return lane === 'api' ? 'queued' : 'waiting-import'
}

async function buildInitialPortfolioStates(state: Pick<Ai2BatchState, 'trials' | 'enabledModelIds' | 'tasks' | 'fills'>): Promise<Ai2PortfolioState[]> {
  const actorIdByModelId = new Map(state.tasks.map((task) => [task.modelId, task.actorId]))
  const uniqueActorIds = Array.from(new Set(state.tasks.map((task) => task.actorId)))
  const marketIds = state.trials.map((trial) => trial.marketId)

  const [accounts, positions] = await Promise.all([
    uniqueActorIds.length === 0
      ? []
      : db.query.marketAccounts.findMany({
          where: inArray(marketAccounts.actorId, uniqueActorIds),
        }),
    uniqueActorIds.length === 0 || marketIds.length === 0
      ? []
      : db.query.marketPositions.findMany({
          where: and(
            inArray(marketPositions.actorId, uniqueActorIds),
            inArray(marketPositions.marketId, marketIds),
          ),
        }),
  ])

  const accountByActorId = new Map(accounts.map((account) => [account.actorId, account]))
  const positionsByActorId = new Map<string, Ai2PortfolioMarketPosition[]>()

  for (const position of positions) {
    const trial = state.trials.find((entry) => entry.marketId === position.marketId)
    if (!trial) continue
    const existing = positionsByActorId.get(position.actorId) ?? []
    existing.push({
      marketId: position.marketId,
      trialQuestionId: trial.trialQuestionId,
      shortTitle: trial.shortTitle,
      yesShares: position.yesShares,
      noShares: position.noShares,
    })
    positionsByActorId.set(position.actorId, existing)
  }

  return state.enabledModelIds.map((modelId) => {
    const actorId = actorIdByModelId.get(modelId) ?? ''
    const account = actorId ? accountByActorId.get(actorId) : null
    const markets = actorId ? (positionsByActorId.get(actorId) ?? []) : []
    const latestFill = [...state.fills].reverse().find((fill) => fill.modelId === modelId)
    return {
      modelId,
      actorId,
      cashBalance: account?.cashBalance ?? 0,
      totalYesShares: markets.reduce((sum, item) => sum + item.yesShares, 0),
      totalNoShares: markets.reduce((sum, item) => sum + item.noShares, 0),
      markets,
      latestActionSummary: latestFill
        ? `${getAi2ModelLabel(modelId)} ${latestFill.executedAction} ${latestFill.executedAmountUsd > 0 ? `$${latestFill.executedAmountUsd.toFixed(2)}` : ''}`.trim()
        : null,
    }
  })
}

function buildInitialBatchState(input: {
  batchId: string
  dataset: Ai2Dataset
  enabledModelIds: ModelId[]
  clearOrder: ModelId[]
  trials: OpenTrialCandidate[]
  actorIdByModelId: Map<ModelId, string>
  accountByActorId: Map<string, typeof marketAccounts.$inferSelect>
  positionByMarketActorKey: Map<string, typeof marketPositions.$inferSelect>
  runtimeConfig: Awaited<ReturnType<typeof getMarketRuntimeConfig>>
  createdAt: Date
}): Ai2BatchState {
  const createdAtIso = input.createdAt.toISOString()
  const normalizedRunDate = normalizeRunDate(input.createdAt)
  const trials = input.trials.map((candidate) => buildBatchTrial(candidate))
  const tasks: Ai2DecisionTask[] = []

  for (const trial of trials) {
    const candidate = input.trials.find((entry) => entry.market.id === trial.marketId)
    if (!candidate) continue

    for (const modelId of input.enabledModelIds) {
      const actorId = input.actorIdByModelId.get(modelId)
      if (!actorId) continue

      const account = input.accountByActorId.get(actorId)
      const position = input.positionByMarketActorKey.get(`${trial.marketId}:${actorId}`)
      if (!account || !position) continue

      tasks.push({
        taskKey: buildAi2TaskKey(input.batchId, trial.marketId, modelId),
        marketId: trial.marketId,
        trialQuestionId: trial.trialQuestionId,
        trialId: trial.trialId,
        modelId,
        actorId,
        lane: getAi2ModelLane(modelId),
        status: buildTaskStatus(getAi2ModelLane(modelId)),
        frozenPortfolio: buildFrozenPortfolio({
          market: candidate.market,
          account,
          position,
          runDate: normalizedRunDate,
          runtimeConfig: input.runtimeConfig,
        }),
        frozenMarket: trial.marketSnapshot,
        decision: null,
        reasoningPreview: null,
        snapshotId: null,
        durationMs: null,
        costSource: null,
        estimatedCostUsd: null,
        exportedAt: null,
        importedAt: null,
        errorMessage: null,
        fill: null,
      })
    }
  }

  return {
    id: input.batchId,
    dataset: input.dataset,
    status: 'waiting',
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
    runStartedAt: null,
    clearOrder: input.clearOrder,
    enabledModelIds: input.enabledModelIds,
    trials,
    tasks,
    fills: [],
    portfolioStates: [],
    logs: [
      buildLog(
        `${getAi2DatasetLabel(input.dataset)} batch staged with ${trials.length} trial${trials.length === 1 ? '' : 's'} and ${input.enabledModelIds.length} model${input.enabledModelIds.length === 1 ? '' : 's'}.`,
      ),
    ],
    failureMessage: null,
  }
}

function serializeBatchState(state: Ai2BatchState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>
}

async function getBatchRowById(batchId: string): Promise<Ai2BatchRow | null> {
  return (await db.query.ai2Batches.findFirst({
    where: eq(ai2Batches.id, batchId),
  })) ?? null
}

async function getLatestVisibleBatch(dataset: Ai2Dataset): Promise<Ai2BatchState | null> {
  const row = await db.query.ai2Batches.findFirst({
    where: and(
      eq(ai2Batches.dataset, dataset),
      inArray(ai2Batches.status, ['collecting', 'waiting', 'ready', 'clearing', 'cleared', 'failed']),
    ),
    orderBy: [desc(ai2Batches.updatedAt), desc(ai2Batches.createdAt)],
  })

  return row ? parseBatchState(row) : null
}

function updateAggregateStatus(state: Ai2BatchState, overrideStatus?: Ai2BatchStatus): Ai2BatchState {
  const next = { ...state }
  const tasks = next.tasks

  if (overrideStatus) {
    next.status = overrideStatus
  } else if (next.status === 'reset' || next.status === 'failed') {
    next.status = next.status
  } else if (!next.runStartedAt) {
    next.status = 'waiting'
  } else if (next.status === 'clearing' && tasks.some((task) => task.status === 'ready' || task.status === 'cleared')) {
    next.status = 'clearing'
  } else if (tasks.some((task) => task.status === 'error')) {
    next.status = 'failed'
  } else if (tasks.length > 0 && tasks.every((task) => task.status === 'cleared')) {
    next.status = 'cleared'
  } else if (tasks.every((task) => task.status === 'ready' || task.status === 'cleared')) {
    next.status = 'ready'
  } else if (tasks.some((task) => task.status === 'waiting-import')) {
    next.status = 'waiting'
  } else {
    next.status = 'collecting'
  }

  next.updatedAt = new Date().toISOString()
  return next
}

async function persistBatchState(batchId: string, state: Ai2BatchState): Promise<Ai2BatchState | null> {
  const normalized = updateAggregateStatus(state)
  const [row] = await db.update(ai2Batches)
    .set({
      status: normalized.status,
      state: serializeBatchState(normalized),
      error: normalized.failureMessage,
      updatedAt: new Date(),
    })
    .where(eq(ai2Batches.id, batchId))
    .returning()

  return row ? parseBatchState(row) : null
}

async function mutateBatchState(
  batchId: string,
  mutator: (state: Ai2BatchState) => Promise<Ai2BatchState> | Ai2BatchState,
): Promise<Ai2BatchState | null> {
  return withBatchLock(batchId, async () => {
    const row = await getBatchRowById(batchId)
    if (!row) return null
    const current = parseBatchState(row)
    const next = await mutator(current)
    return persistBatchState(batchId, next)
  })
}

function reconstructSnapshotArgs(batch: Ai2BatchState, task: Ai2DecisionTask) {
  const trial = batch.trials.find((entry) => entry.marketId === task.marketId)
  if (!trial) {
    throw new NotFoundError(`Missing trial snapshot for ${task.marketId}`)
  }

  const runtimeTrial = {
    id: trial.trialId,
    nctNumber: trial.nctNumber,
    shortTitle: trial.shortTitle,
    sponsorName: trial.sponsorName,
    sponsorTicker: trial.sponsorTicker,
    indication: trial.indication,
    exactPhase: trial.exactPhase,
    intervention: trial.intervention,
    primaryEndpoint: trial.primaryEndpoint,
    estPrimaryCompletionDate: new Date(trial.decisionDate),
    currentStatus: trial.currentStatus,
    briefSummary: trial.briefSummary,
  } as typeof phase2Trials.$inferSelect

  const runtimeMarket = {
    id: trial.marketId,
    trialQuestionId: trial.trialQuestionId,
    priceYes: task.frozenMarket.priceYes,
    qYes: task.frozenMarket.qYes,
    qNo: task.frozenMarket.qNo,
    b: task.frozenMarket.b,
    openedAt: task.frozenMarket.openedAt ? new Date(task.frozenMarket.openedAt) : null,
  } as typeof predictionMarkets.$inferSelect

  const runtimeAccount = {
    actorId: task.actorId,
    cashBalance: task.frozenPortfolio.cashAvailable,
  } as typeof marketAccounts.$inferSelect

  const runtimePosition = {
    marketId: task.marketId,
    actorId: task.actorId,
    yesShares: task.frozenPortfolio.yesSharesHeld,
    noShares: task.frozenPortfolio.noSharesHeld,
  } as typeof marketPositions.$inferSelect

  return {
    trial,
    snapshotArgs: {
      runSource: 'manual' as const,
      modelId: task.modelId,
      actorId: task.actorId,
      runDate: new Date(batch.createdAt),
      trial: runtimeTrial,
      trialQuestionId: trial.trialQuestionId,
      questionPrompt: trial.questionPrompt,
      market: runtimeMarket,
      account: runtimeAccount,
      position: runtimePosition,
    },
  }
}

async function buildExportPacket(batch: Ai2BatchState, modelId: Ai2SubscriptionModelId) {
  if (!batch.enabledModelIds.includes(modelId)) {
    throw new ValidationError(`${getAi2ModelLabel(modelId)} is not enabled in this batch.`)
  }

  const runtimeConfig = await getMarketRuntimeConfig()
  const tasks = batch.tasks.filter((task) => task.modelId === modelId)
  if (tasks.length === 0) {
    throw new ValidationError(`No ${getAi2ModelLabel(modelId)} tasks are queued in this batch.`)
  }

  const exportTasks = tasks.map((task) => {
    const { snapshotArgs } = reconstructSnapshotArgs(batch, task)
    const { input } = buildModelDecisionSnapshotInput({
      ...snapshotArgs,
      runtimeConfig,
    })

    return {
      taskKey: task.taskKey,
      marketId: task.marketId,
      trialQuestionId: task.trialQuestionId,
      modelId,
      shortTitle: snapshotArgs.trial.shortTitle,
      sponsorName: snapshotArgs.trial.sponsorName,
      nctNumber: snapshotArgs.trial.nctNumber,
      decisionDate: snapshotArgs.trial.estPrimaryCompletionDate.toISOString(),
      input,
      prompt: buildModelDecisionPrompt(input),
    }
  })

  const responseTemplate: Ai2SubscriptionImportPacket = {
    version: 1,
    workflow: AI2_SUBSCRIPTION_IMPORT_WORKFLOW,
    batchId: batch.id,
    modelId,
    decisions: exportTasks.map((task) => ({
      taskKey: task.taskKey,
      decision: {
        forecast: {
          approvalProbability: 0,
          yesProbability: 0,
          binaryCall: 'yes',
          confidence: 50,
          reasoning: 'string',
        },
        action: {
          type: 'HOLD',
          amountUsd: 0,
          explanation: 'string',
        },
      },
    })),
  }

  return {
    version: 1 as const,
    workflow: AI2_SUBSCRIPTION_EXPORT_WORKFLOW,
    batchId: batch.id,
    dataset: batch.dataset,
    modelId,
    exportedAt: new Date().toISOString(),
    taskCount: exportTasks.length,
    operatorInstructions: [
      'Read every task in tasks and solve each one using that task\'s prompt as the source of truth.',
      'Return one JSON object only. Do not return prose, headings, markdown, or fenced code blocks.',
      'Your final answer must match responseTemplate exactly: same workflow, batchId, modelId, and one decisions item per taskKey.',
      'Replace each placeholder decision in responseTemplate with the real forecast/action object for that task.',
      'Keep decisions in the same order as responseTemplate.decisions.',
    ],
    responseTemplate,
    tasks: exportTasks,
  }
}

function extractBalancedJsonObject(raw: string, startIndex: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIndex; i < raw.length; i += 1) {
    const ch = raw[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return raw.slice(startIndex, i + 1)
      }
    }
  }

  return null
}

function extractJsonObjects(raw: string): string[] {
  const objects: string[] = []

  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '{') continue
    const candidate = extractBalancedJsonObject(raw, i)
    if (!candidate) continue
    objects.push(candidate)
    i += candidate.length - 1
  }

  return objects
}

function normalizeRawSubscriptionImport(args: {
  batch: Ai2BatchState
  modelId: Ai2SubscriptionModelId
  rawText: string
}): {
  workflow: typeof AI2_SUBSCRIPTION_IMPORT_WORKFLOW
  batchId: string
  modelId: Ai2SubscriptionModelId
  decisions: Array<{
    taskKey: string
    decision: ModelDecisionResult
  }>
} {
  const pendingTasks = args.batch.tasks.filter((task) => task.modelId === args.modelId && !task.snapshotId)
  if (pendingTasks.length === 0) {
    throw new ValidationError(`No pending ${args.modelId} tasks are waiting for import.`)
  }

  const decisions = extractJsonObjects(args.rawText)
    .map((candidate) => {
      try {
        return parseModelDecisionResponse(
          candidate,
          ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
          220,
        )
      } catch {
        return null
      }
    })
    .filter((decision): decision is ModelDecisionResult => decision !== null)

  if (decisions.length !== pendingTasks.length) {
    throw new ValidationError(
      `Could not infer import decisions from the pasted response. Found ${decisions.length} decision object${decisions.length === 1 ? '' : 's'} for ${pendingTasks.length} pending task${pendingTasks.length === 1 ? '' : 's'}. Return the full batch import object or exactly one decision object per pending task in order.`,
    )
  }

  return {
    workflow: AI2_SUBSCRIPTION_IMPORT_WORKFLOW,
    batchId: args.batch.id,
    modelId: args.modelId,
    decisions: pendingTasks.map((task, index) => ({
      taskKey: task.taskKey,
      decision: decisions[index],
    })),
  }
}

async function getLiveFillState(task: Ai2DecisionTask) {
  const [market, account, position] = await Promise.all([
    db.query.predictionMarkets.findFirst({
      where: eq(predictionMarkets.id, task.marketId),
    }),
    db.query.marketAccounts.findFirst({
      where: eq(marketAccounts.actorId, task.actorId),
    }),
    db.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, task.marketId),
        eq(marketPositions.actorId, task.actorId),
      ),
    }),
  ])

  if (!market) {
    throw new NotFoundError(`Market ${task.marketId} not found`)
  }
  if (!account || !position) {
    throw new NotFoundError(`Missing actor state for ${task.modelId} on ${task.marketId}`)
  }

  return {
    market,
    account,
    position,
  }
}

function applyRiskCap(args: {
  action: NonNullable<Ai2DecisionTask['decision']>['action']['type']
  requestedUsd: number
  market: typeof predictionMarkets.$inferSelect
  account: typeof marketAccounts.$inferSelect
  position: typeof marketPositions.$inferSelect
  runDate: Date
  config: Awaited<ReturnType<typeof getMarketRuntimeConfig>>
}): {
  amountUsd: number
  note: string
} {
  const requested = Math.max(0, args.requestedUsd)
  if (requested <= 0 || args.action === 'HOLD') {
    return {
      amountUsd: 0,
      note: '',
    }
  }

  const tradeCaps = calculateExecutableTradeCaps({
    state: {
      qYes: args.market.qYes,
      qNo: args.market.qNo,
      b: args.market.b,
    },
    accountCash: args.account.cashBalance,
    yesSharesHeld: args.position.yesShares,
    noSharesHeld: args.position.noShares,
    marketOpenedAt: args.market.openedAt,
    runDate: args.runDate,
    config: args.config,
  })

  const tradeCapUsd = args.action === 'BUY_YES'
    ? tradeCaps.maxBuyYesUsd
    : args.action === 'BUY_NO'
      ? tradeCaps.maxBuyNoUsd
      : args.action === 'SELL_YES'
        ? tradeCaps.maxSellYesUsd
        : tradeCaps.maxSellNoUsd

  const capped = Math.max(0, Math.min(requested, tradeCapUsd))
  if (capped >= requested - 1e-9) {
    return {
      amountUsd: requested,
      note: '',
    }
  }

  return {
    amountUsd: capped,
    note: `${tradeCaps.inWarmupWindow ? 'Warm-up' : 'Steady-state'} cap reduced request to $${capped.toFixed(2)}.`,
  }
}

async function hydratePortfolioStates(state: Ai2BatchState): Promise<Ai2BatchState> {
  return {
    ...state,
    portfolioStates: await buildInitialPortfolioStates(state),
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${context} timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
    })

    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function runApiTask(batchId: string, taskKey: string): Promise<void> {
  const runningState = await mutateBatchState(batchId, (state) => {
    if (state.status === 'reset') return state
    return {
      ...state,
      logs: [...state.logs, buildLog(`Starting ${taskKey}.`)],
      tasks: state.tasks.map((task) => (
        task.taskKey === taskKey && task.status === 'queued'
          ? { ...task, status: 'running', errorMessage: null }
          : task
      )),
    }
  })

  if (!runningState || runningState.status === 'reset') return
  const task = runningState.tasks.find((entry) => entry.taskKey === taskKey)
  if (!task || task.lane !== 'api') return

  try {
    const runtimeConfig = await getMarketRuntimeConfig()
    const { snapshotArgs } = reconstructSnapshotArgs(runningState, task)
    const result = await withTimeout(
      generateAndStoreModelDecisionSnapshot({
        ...snapshotArgs,
        runtimeConfig,
      }),
      getMarketModelResponseTimeoutMs(task.modelId),
      `${task.modelId} decision`,
    )

    const next = await mutateBatchState(batchId, (state) => ({
      ...state,
      logs: [...state.logs, buildLog(`${getAi2ModelLabel(task.modelId)} is ready on ${task.marketId}.`, 'success')],
      tasks: state.tasks.map((entry) => (
        entry.taskKey === taskKey
          ? {
              ...entry,
              status: 'ready',
              decision: {
                forecast: result.decision.forecast,
                action: result.decision.action,
              },
              reasoningPreview: result.decision.forecast.reasoning.slice(0, 240),
              snapshotId: result.snapshot.id,
              durationMs: result.snapshot.durationMs ?? null,
              costSource: result.snapshot.costSource ?? null,
              estimatedCostUsd: result.snapshot.estimatedCostUsd ?? null,
              errorMessage: null,
            }
          : entry
      )),
    }))

    if (next) {
      void continueBatchProcessing(batchId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown API task error'

    await mutateBatchState(batchId, (state) => ({
      ...state,
      status: 'failed',
      failureMessage: message,
      logs: [...state.logs, buildLog(`${task.modelId} failed: ${message}`, 'error')],
      tasks: state.tasks.map((entry) => (
        entry.taskKey === taskKey
          ? {
              ...entry,
              status: 'error',
              errorMessage: message,
            }
          : entry
      )),
    }))
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const pending = [...items]
  const runners = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (pending.length > 0) {
      const next = pending.shift()
      if (!next) return
      await worker(next)
    }
  })

  await Promise.all(runners)
}

async function clearBatch(batchId: string): Promise<void> {
  const state = await mutateBatchState(batchId, (current) => ({
    ...current,
    status: 'clearing',
    logs: [...current.logs, buildLog('All model decisions are in. Clearing the shared AMM now.', 'warning')],
  }))

  if (!state || state.status === 'reset' || state.status === 'failed') return

  const runtimeConfig = await getMarketRuntimeConfig()
  const clearPlans = state.trials.map((trial) => ({
    trial,
    queue: state.clearOrder
      .map((modelId) => state.tasks.find((task) => task.marketId === trial.marketId && task.modelId === modelId))
      .filter((task): task is Ai2DecisionTask => task != null),
  }))

  for (const plan of clearPlans) {
    for (const task of plan.queue) {
      const live = await getBatchRowById(batchId)
      if (!live) return
      const current = parseBatchState(live)
      if (current.status === 'reset' || current.status === 'failed') return

      const currentTask = current.tasks.find((entry) => entry.taskKey === task.taskKey)
      if (!currentTask?.decision || currentTask.status !== 'ready') continue
      const decision = currentTask.decision

      try {
        const { market, account, position } = await getLiveFillState(currentTask)
        const cap = applyRiskCap({
          action: decision.action.type,
          requestedUsd: decision.action.amountUsd,
          market,
          account,
          position,
          runDate: new Date(current.createdAt),
          config: runtimeConfig,
        })
        const explanation = [decision.action.explanation, cap.note, `[Batch ${current.id}]`]
          .filter(Boolean)
          .join(' ')
          .trim()

        let fillEvent: Ai2BatchState['fills'][number]
        let fillSummary: Ai2DecisionTask['fill']

        if (decision.action.type === 'HOLD' || cap.amountUsd <= 0) {
          const actionRecord = await runHoldAction({
            marketId: market.id,
            trialQuestionId: market.trialQuestionId ?? currentTask.trialQuestionId,
            actorId: currentTask.actorId,
            runDate: new Date(),
            explanation,
            priceYes: market.priceYes,
            actionSource: 'human',
          })
          if (currentTask.snapshotId) {
            await linkSnapshotToMarketAction(currentTask.snapshotId, actionRecord.id)
          }

          fillSummary = {
            fillEventId: actionRecord.id,
            marketActionId: actionRecord.id,
            executedAction: 'HOLD',
            executedAmountUsd: 0,
            sharesDelta: 0,
            priceBefore: market.priceYes,
            priceAfter: market.priceYes,
            explanation,
            status: 'ok',
            errorMessage: null,
          }
        } else if (decision.action.type === 'BUY_YES' || decision.action.type === 'BUY_NO') {
          const result = await runBuyAction({
            market,
            actorId: currentTask.actorId,
            runDate: new Date(),
            side: decision.action.type,
            requestedUsd: cap.amountUsd,
            explanation,
            actionSource: 'human',
          })
          if (currentTask.snapshotId) {
            await linkSnapshotToMarketAction(currentTask.snapshotId, result.actionId)
          }

          fillSummary = {
            fillEventId: result.actionId,
            marketActionId: result.actionId,
            executedAction: decision.action.type,
            executedAmountUsd: result.spent,
            sharesDelta: result.shares,
            priceBefore: result.priceBefore,
            priceAfter: result.priceAfter,
            explanation,
            status: 'ok',
            errorMessage: null,
          }
        } else {
          const result = await runSellAction({
            market,
            actorId: currentTask.actorId,
            runDate: new Date(),
            side: decision.action.type,
            requestedUsd: cap.amountUsd,
            explanation,
            actionSource: 'human',
          })
          if (currentTask.snapshotId) {
            await linkSnapshotToMarketAction(currentTask.snapshotId, result.actionId)
          }

          fillSummary = {
            fillEventId: result.actionId,
            marketActionId: result.actionId,
            executedAction: decision.action.type,
            executedAmountUsd: result.proceeds,
            sharesDelta: -result.shares,
            priceBefore: result.priceBefore,
            priceAfter: result.priceAfter,
            explanation,
            status: 'ok',
            errorMessage: null,
          }
        }

        fillEvent = {
          id: fillSummary.fillEventId ?? crypto.randomUUID(),
          marketId: currentTask.marketId,
          trialQuestionId: currentTask.trialQuestionId,
          modelId: currentTask.modelId,
          taskKey: currentTask.taskKey,
          requestedAction: decision.action.type,
          requestedAmountUsd: decision.action.amountUsd,
          executedAction: fillSummary.executedAction,
          executedAmountUsd: fillSummary.executedAmountUsd,
          sharesDelta: fillSummary.sharesDelta,
          priceBefore: fillSummary.priceBefore,
          priceAfter: fillSummary.priceAfter,
          explanation: fillSummary.explanation,
          snapshotId: currentTask.snapshotId,
          marketActionId: fillSummary.marketActionId,
          status: fillSummary.status,
          createdAt: new Date().toISOString(),
          errorMessage: fillSummary.errorMessage,
        }

        await mutateBatchState(batchId, async (currentState) => hydratePortfolioStates({
          ...currentState,
          fills: [...currentState.fills, fillEvent],
          logs: [...currentState.logs, buildLog(`${getAi2ModelLabel(currentTask.modelId)} cleared ${fillSummary.executedAction} on ${currentTask.marketId}.`, 'success')],
          tasks: currentState.tasks.map((entry) => (
            entry.taskKey === currentTask.taskKey
              ? {
                  ...entry,
                  status: 'cleared',
                  fill: fillSummary,
                }
              : entry
          )),
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown clearing error'
        const { market } = await getLiveFillState(currentTask)
        const action = await recordMarketActionError({
          marketId: market.id,
          trialQuestionId: market.trialQuestionId ?? currentTask.trialQuestionId,
          actorId: currentTask.actorId,
          runDate: new Date(),
          priceYes: market.priceYes,
          message,
          actionSource: 'human',
        })

        await mutateBatchState(batchId, async (currentState) => hydratePortfolioStates({
          ...currentState,
          status: 'failed',
          failureMessage: message,
          fills: [
            ...currentState.fills,
            {
              id: action.id,
              marketId: currentTask.marketId,
              trialQuestionId: currentTask.trialQuestionId,
              modelId: currentTask.modelId,
              taskKey: currentTask.taskKey,
              requestedAction: decision.action.type,
              requestedAmountUsd: decision.action.amountUsd,
              executedAction: 'HOLD',
              executedAmountUsd: 0,
              sharesDelta: 0,
              priceBefore: market.priceYes,
              priceAfter: market.priceYes,
              explanation: message,
              snapshotId: currentTask.snapshotId,
              marketActionId: action.id,
              status: 'error',
              createdAt: new Date().toISOString(),
              errorMessage: message,
            },
          ],
          logs: [...currentState.logs, buildLog(`Clearing failed: ${message}`, 'error')],
          tasks: currentState.tasks.map((entry) => (
            entry.taskKey === currentTask.taskKey
              ? {
                  ...entry,
                  status: 'error',
                  errorMessage: message,
                }
              : entry
          )),
        }))
        return
      }
    }
  }

  await mutateBatchState(batchId, async (currentState) => hydratePortfolioStates({
    ...currentState,
    status: 'cleared',
    logs: [...currentState.logs, buildLog('Batch clearing complete.', 'success')],
  }))
}

async function continueBatchProcessing(batchId: string): Promise<void> {
  if (ai2Workers.has(batchId)) return

  const worker = (async () => {
    const row = await getBatchRowById(batchId)
    if (!row) return

    const state = parseBatchState(row)
    if (!state.runStartedAt) return
    if (state.status === 'reset' || state.status === 'cleared') return

    const apiTasks = state.tasks.filter((task) => task.lane === 'api' && task.status === 'queued')
    if (apiTasks.length > 0) {
      await runWithConcurrency(apiTasks, 4, async (task) => {
        await runApiTask(batchId, task.taskKey)
      })
    }

    const refreshedRow = await getBatchRowById(batchId)
    if (!refreshedRow) return
    const refreshed = parseBatchState(refreshedRow)
    if (refreshed.status === 'reset' || refreshed.status === 'cleared') return

    const waitingTasks = refreshed.tasks.filter((task) => task.status === 'waiting-import')
    const readyToClear = refreshed.tasks.length > 0 && refreshed.tasks.every((task) => task.status === 'ready' || task.status === 'cleared')

    if (waitingTasks.length > 0) {
      await mutateBatchState(batchId, (current) => ({
        ...current,
        status: 'waiting',
      }))
      return
    }

    if (readyToClear) {
      await clearBatch(batchId)
    }
  })().finally(() => {
    ai2Workers.delete(batchId)
  })

  ai2Workers.set(batchId, worker)
  await worker
}

export async function getAi2DeskState(dataset: Ai2Dataset, batchId?: string | null): Promise<Ai2DeskState> {
  const [datasets, availableModels] = await Promise.all([
    buildDatasetSummaries(),
    Promise.resolve(getAi2AvailableModels()),
  ])

  const batch = batchId
    ? await getBatchRowById(batchId).then((row) => row ? parseBatchState(row) : null)
    : await getLatestVisibleBatch(dataset)

  if (batch && batch.runStartedAt && !isTerminalBatchStatus(batch.status)) {
    void continueBatchProcessing(batch.id)
  }

  return {
    dataset,
    datasets,
    availableModels,
    batch,
  }
}

export async function getAi2BatchState(batchId: string): Promise<Ai2BatchState | null> {
  const row = await getBatchRowById(batchId)
  if (!row) return null
  const batch = parseBatchState(row)
  if (batch.runStartedAt && !isTerminalBatchStatus(batch.status)) {
    void continueBatchProcessing(batch.id)
  }
  return batch
}

export async function createAi2Batch(input: CreateAi2BatchInput): Promise<Ai2BatchState> {
  const enabledModelIds = toModelIds(input.enabledModelIds)
  if (enabledModelIds.length === 0) {
    throw new ValidationError('Select at least one model before opening a batch.')
  }

  const availableModels = new Map(getAi2AvailableModels().map((model) => [model.modelId, model]))
  for (const modelId of enabledModelIds) {
    const model = availableModels.get(modelId)
    if (!model) {
      throw new ValidationError(`Unknown model ${modelId}`)
    }
    if (!model.available) {
      throw new ValidationError(model.disabledReason || `${modelId} is not currently available`)
    }
  }

  const existing = await db.query.ai2Batches.findFirst({
    where: inArray(ai2Batches.status, ACTIVE_BATCH_STATUSES),
    orderBy: [desc(ai2Batches.updatedAt)],
  })
  if (existing) {
    throw new ConflictError('An /admin/ai batch is already active. Reset it before opening a new one.')
  }

  const runtimeConfig = await getMarketRuntimeConfig()
  const candidates = pickDatasetTrials(input.dataset, await listOpenTrialCandidates(), runtimeConfig.toyTrialCount)
  const createdAt = new Date()
  const clearOrder = rotateModelOrder(normalizeRunDate(createdAt)).filter((modelId) => enabledModelIds.includes(modelId))

  await ensureMarketAccounts()
  await Promise.all(candidates.map((candidate) => ensureMarketPositions(candidate.market.id)))

  const actorIdByModelId = await getModelActorIds(enabledModelIds)
  const actorIds = Array.from(new Set(Array.from(actorIdByModelId.values())))
  const marketIds = candidates.map((candidate) => candidate.market.id)
  const [accounts, positions] = await Promise.all([
    actorIds.length === 0
      ? []
      : db.query.marketAccounts.findMany({
          where: inArray(marketAccounts.actorId, actorIds),
        }),
    actorIds.length === 0 || marketIds.length === 0
      ? []
      : db.query.marketPositions.findMany({
          where: and(
            inArray(marketPositions.actorId, actorIds),
            inArray(marketPositions.marketId, marketIds),
          ),
        }),
  ])

  const accountByActorId = new Map(accounts.map((account) => [account.actorId, account]))
  const positionByMarketActorKey = new Map(positions.map((position) => [`${position.marketId}:${position.actorId}`, position]))
  const batchId = crypto.randomUUID()
  let state = buildInitialBatchState({
    batchId,
    dataset: input.dataset,
    enabledModelIds,
    clearOrder,
    trials: candidates,
    actorIdByModelId,
    accountByActorId,
    positionByMarketActorKey,
    runtimeConfig,
    createdAt,
  })
  state = await hydratePortfolioStates(state)

  const [row] = await db.insert(ai2Batches)
    .values({
      id: batchId,
      dataset: input.dataset,
      status: state.status,
      state: serializeBatchState(state),
      error: null,
      createdAt,
      updatedAt: createdAt,
    })
    .returning()

  return parseBatchState(row)
}

export async function exportAi2SubscriptionPacket(batchId: string, modelId: Ai2SubscriptionModelId) {
  const row = await getBatchRowById(batchId)
  if (!row) {
    throw new NotFoundError('Batch not found')
  }

  const batch = parseBatchState(row)
  const packet = await buildExportPacket(batch, modelId)

  await mutateBatchState(batchId, (state) => ({
    ...state,
    logs: [...state.logs, buildLog(`${getAi2ModelLabel(modelId)} export packet generated.`)],
    tasks: state.tasks.map((task) => (
      task.modelId === modelId
        ? { ...task, exportedAt: packet.exportedAt }
        : task
    )),
  }))

  return packet
}

export async function importAi2SubscriptionPacket(batchId: string, payload: {
  workflow: string
  batchId: string
  modelId: string
  decisions: Array<{
    taskKey: string
    decision: unknown
  }>
  rawText?: string | null
}): Promise<Ai2BatchState> {
  if (!AI2_SUBSCRIPTION_MODEL_IDS.includes(payload.modelId as Ai2SubscriptionModelId)) {
    throw new ValidationError('Only Claude and GPT subscription lanes accept imported decision JSON.')
  }

  const modelId = payload.modelId as Ai2SubscriptionModelId
  const row = await getBatchRowById(batchId)
  if (!row) {
    throw new NotFoundError('Batch not found')
  }
  const batch = parseBatchState(row)
  const runtimeConfig = await getMarketRuntimeConfig()
  const normalizedPayload = isAi2SubscriptionImportWorkflow(payload.workflow)
    ? {
        ...payload,
        workflow: AI2_SUBSCRIPTION_IMPORT_WORKFLOW,
      }
    : payload.rawText?.trim()
      ? normalizeRawSubscriptionImport({
          batch,
          modelId,
          rawText: payload.rawText,
        })
      : null

  if (!normalizedPayload) {
    throw new ValidationError(
      `Decision JSON does not match the import workflow. Use ${AI2_SUBSCRIPTION_IMPORT_WORKFLOW} for new packets. ${LEGACY_AI2_SUBSCRIPTION_IMPORT_WORKFLOW} is still accepted for older exports.`,
    )
  }
  if (normalizedPayload.batchId !== batchId) {
    throw new ValidationError('Decision JSON batchId does not match the selected batch.')
  }

  if (normalizedPayload !== payload) {
    await mutateBatchState(batchId, (state) => ({
      ...state,
      logs: [...state.logs, buildLog(`${getAi2ModelLabel(modelId)} raw response normalized into import format.`, 'warning')],
    }))
  }

  for (const item of normalizedPayload.decisions) {
    const task = batch.tasks.find((entry) => entry.taskKey === item.taskKey && entry.modelId === modelId)
    if (!task) {
      throw new ValidationError(`Imported task ${item.taskKey} does not belong to ${modelId} in this batch.`)
    }

    if (task.snapshotId) {
      continue
    }

    const decision = parseModelDecisionResponse(
      JSON.stringify(item.decision),
      ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
      220,
    )
    const { snapshotArgs } = reconstructSnapshotArgs(batch, task)
    const stored = await storeImportedModelDecisionSnapshot({
      ...snapshotArgs,
      runtimeConfig,
      decision,
    })

    await mutateBatchState(batchId, (state) => ({
      ...state,
      logs: [...state.logs, buildLog(`${getAi2ModelLabel(task.modelId)} import attached to ${task.marketId}.`, 'success')],
      tasks: state.tasks.map((entry) => (
        entry.taskKey === item.taskKey
          ? {
              ...entry,
              status: 'ready',
              decision: {
                forecast: stored.decision.forecast,
                action: stored.decision.action,
              },
              reasoningPreview: stored.decision.forecast.reasoning.slice(0, 240),
              snapshotId: stored.snapshot.id,
              durationMs: stored.snapshot.durationMs ?? null,
              costSource: stored.snapshot.costSource ?? null,
              estimatedCostUsd: stored.snapshot.estimatedCostUsd ?? null,
              importedAt: new Date().toISOString(),
              errorMessage: null,
            }
          : entry
      )),
    }))
  }

  const final = await getBatchRowById(batchId)
  if (!final) {
    throw new NotFoundError('Batch not found after import')
  }

  return parseBatchState(final)
}

export async function runAi2BatchNow(batchId: string): Promise<Ai2BatchState> {
  const row = await getBatchRowById(batchId)
  if (!row) {
    throw new NotFoundError('Batch not found')
  }

  const batch = parseBatchState(row)
  if (isTerminalBatchStatus(batch.status)) {
    throw new ConflictError('Batch is already closed.')
  }

  const missingImport = batch.tasks.find((task) => task.lane === 'subscription' && task.status === 'waiting-import')
  if (missingImport) {
    throw new ConflictError('Import all subscription JSON before running the batch.')
  }

  if (batch.tasks.length === 0) {
    throw new ValidationError('Batch has no tasks to run.')
  }

  const next = await mutateBatchState(batchId, (state) => {
    if (state.runStartedAt) {
      return state
    }

    const startedAt = new Date().toISOString()
    return {
      ...state,
      runStartedAt: startedAt,
      status: 'collecting',
      logs: [...state.logs, buildLog('Batch run started by admin. API models can now execute, then the shared AMM will clear.', 'warning')],
    }
  })

  if (!next) {
    throw new NotFoundError('Batch not found after starting')
  }

  void continueBatchProcessing(batchId)
  return next
}

export async function retryAi2Task(batchId: string, taskKey: string): Promise<Ai2BatchState> {
  const row = await getBatchRowById(batchId)
  if (!row) {
    throw new NotFoundError('Batch not found')
  }

  const batch = parseBatchState(row)
  if (batch.status === 'reset' || batch.status === 'cleared') {
    throw new ConflictError('This batch can no longer be retried.')
  }

  const task = batch.tasks.find((entry) => entry.taskKey === taskKey)
  if (!task) {
    throw new NotFoundError('Task not found')
  }
  if (task.status !== 'error') {
    throw new ConflictError('Only failed tasks can be retried.')
  }

  const successfulFills = batch.fills.filter((fill) => fill.status === 'ok')
  if (successfulFills.length > 0) {
    throw new ConflictError('This batch already started clearing against the live AMM. Reset and stage a new batch to preserve fairness.')
  }

  const nextTaskStatus: Ai2TaskStatus = task.decision
    ? 'ready'
    : task.lane === 'api'
      ? 'queued'
      : 'waiting-import'

  const next = await mutateBatchState(batchId, (state) => ({
    ...state,
    status: state.runStartedAt ? 'collecting' : 'waiting',
    failureMessage: null,
    fills: state.fills.filter((fill) => fill.taskKey !== taskKey || fill.status === 'ok'),
    logs: [
      ...state.logs,
      buildLog(
        task.decision
          ? `${getAi2ModelLabel(task.modelId)} retry armed from the frozen snapshot without changing clear order.`
          : `${getAi2ModelLabel(task.modelId)} retry queued against the frozen snapshot without changing clear order.`,
        'warning',
      ),
    ],
    tasks: state.tasks.map((entry) => (
      entry.taskKey === taskKey
        ? {
            ...entry,
            status: nextTaskStatus,
            errorMessage: null,
          }
        : entry
    )),
  }))

  if (!next) {
    throw new NotFoundError('Batch not found after retry')
  }

  if (next.runStartedAt && nextTaskStatus !== 'waiting-import') {
    void continueBatchProcessing(batchId)
  }

  return next
}

export async function clearAi2BatchNow(batchId: string): Promise<Ai2BatchState> {
  const row = await getBatchRowById(batchId)
  if (!row) {
    throw new NotFoundError('Batch not found')
  }

  const batch = parseBatchState(row)
  if (!batch.runStartedAt) {
    throw new ConflictError('Run the batch before clearing it.')
  }
  const notReady = batch.tasks.find((task) => task.status !== 'ready' && task.status !== 'cleared')
  if (notReady) {
    throw new ConflictError('Batch cannot clear until every enabled model has returned.')
  }

  await clearBatch(batchId)
  const refreshed = await getBatchRowById(batchId)
  if (!refreshed) {
    throw new NotFoundError('Batch not found after clearing')
  }
  return parseBatchState(refreshed)
}

export async function resetAi2Batch(batchId: string): Promise<void> {
  await mutateBatchState(batchId, (state) => ({
    ...state,
    status: 'reset',
    failureMessage: 'Reset by admin.',
    logs: [...state.logs, buildLog('Batch reset by admin.', 'warning')],
  }))
}
