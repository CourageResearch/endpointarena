import { desc, eq, inArray } from 'drizzle-orm'
import { estimateCostFromTokenUsage, estimateTextGenerationCost, getCostEstimationProfileForModel, type AICostSource } from '@/lib/ai-costs'
import { type ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import {
  db,
  marketAccounts,
  marketPositions,
  modelDecisionSnapshots,
  trials,
  predictionMarkets,
} from '@/lib/db'
import { type MarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { calculateExecutableTradeCaps, normalizeRunDate } from '@/lib/markets/engine'
import { type Prediction, type PredictionHistoryEntry } from '@/lib/types'
import { isMockMarketSnapshotLike } from '@/lib/mock-market-data'
import {
  getModelDecisionGeneratorDisabledReason,
  MODEL_DECISION_GENERATORS,
  type ModelDecisionGeneration,
} from '@/lib/predictions/model-decision-generators'
import { buildModelDecisionPrompt, type ModelDecisionInput, type ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'

type DecisionRunSource = 'manual' | 'cycle'
export type LeaderboardPredictionMode = 'first' | 'final'

type UnifiedPredictionHistoryMap = Map<string, Map<string, PredictionHistoryEntry[]>>

function computeCorrectness(prediction: string, questionOutcome: string): boolean | null {
  if (questionOutcome !== 'YES' && questionOutcome !== 'NO') {
    return null
  }

  return (
    (prediction === 'yes' && questionOutcome === 'YES') ||
    (prediction === 'no' && questionOutcome === 'NO')
  )
}

function mapSnapshotPrediction(
  row: typeof modelDecisionSnapshots.$inferSelect,
  predictorId: string,
  questionOutcome: string,
): PredictionHistoryEntry {
  return {
    id: row.id,
    predictorId,
    prediction: row.binaryCall as 'yes' | 'no',
    confidence: row.confidence,
    reasoning: row.reasoning,
    durationMs: row.durationMs,
    correct: computeCorrectness(row.binaryCall, questionOutcome),
    createdAt: row.createdAt?.toISOString(),
    source: 'snapshot',
    runSource: row.runSource as 'manual' | 'cycle',
    approvalProbability: row.approvalProbability,
    yesProbability: row.yesProbability ?? row.approvalProbability,
    action: {
      type: row.proposedActionType,
      amountUsd: row.proposedAmountUsd,
      explanation: row.proposedExplanation,
    },
    linkedMarketActionId: row.linkedMarketActionId,
  }
}

function sortHistoryDescending(history: PredictionHistoryEntry[]): PredictionHistoryEntry[] {
  return [...history].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bTime - aTime
  })
}

function buildLatestPrediction(history: PredictionHistoryEntry[]): Prediction | null {
  const sortedHistory = sortHistoryDescending(history)
  const latest = sortedHistory[0]
  if (!latest) return null

  return {
    predictorId: latest.predictorId,
    prediction: latest.prediction,
    confidence: latest.confidence,
    reasoning: latest.reasoning,
    durationMs: latest.durationMs,
    correct: latest.correct,
    createdAt: latest.createdAt,
    source: latest.source,
    runSource: latest.runSource,
    approvalProbability: latest.approvalProbability,
    yesProbability: latest.yesProbability ?? latest.approvalProbability,
    action: latest.action,
    linkedMarketActionId: latest.linkedMarketActionId,
    history: sortedHistory,
  }
}

export async function getUnifiedPredictionHistoriesByQuestionIds(
  questionIds: string[],
  questionOutcomeById: Map<string, string>,
): Promise<UnifiedPredictionHistoryMap> {
  if (questionIds.length === 0) {
    return new Map()
  }

  const [snapshotRows] = await Promise.all([
    db.query.modelDecisionSnapshots.findMany({
      where: inArray(modelDecisionSnapshots.trialQuestionId, questionIds),
      orderBy: [desc(modelDecisionSnapshots.createdAt)],
      with: {
        actor: true,
      },
    }),
  ])

  const historyByQuestionId = new Map<string, Map<string, PredictionHistoryEntry[]>>()

  const pushHistory = (questionId: string, predictorId: string, entry: PredictionHistoryEntry) => {
    const questionMap = historyByQuestionId.get(questionId) || new Map<string, PredictionHistoryEntry[]>()
    const current = questionMap.get(predictorId) || []
    current.push(entry)
    questionMap.set(predictorId, current)
    historyByQuestionId.set(questionId, questionMap)
  }

  for (const row of snapshotRows) {
    if (isMockMarketSnapshotLike(row)) continue
    const predictorId = row.actor.modelKey ?? row.actorId
    const ownerId = row.trialQuestionId
    if (!ownerId) continue
    pushHistory(
      ownerId,
      predictorId,
      mapSnapshotPrediction(row, predictorId, questionOutcomeById.get(ownerId) || 'Pending'),
    )
  }

  for (const questionMap of historyByQuestionId.values()) {
    for (const [predictorId, history] of questionMap.entries()) {
      questionMap.set(predictorId, sortHistoryDescending(history))
    }
  }

  return historyByQuestionId
}

export async function attachUnifiedPredictionsToQuestions<T extends { id: string; outcome: string }>(questions: T[]): Promise<Array<T & { predictions: Prediction[] }>> {
  const questionIds = questions.map((question) => question.id)
  const questionOutcomeById = new Map(questions.map((question) => [question.id, question.outcome]))
  const historyByQuestionId = await getUnifiedPredictionHistoriesByQuestionIds(questionIds, questionOutcomeById)

  return questions.map((question) => {
    const questionHistory = historyByQuestionId.get(question.id)
    const predictions = questionHistory
      ? Array.from(questionHistory.values())
          .map((history) => buildLatestPrediction(history))
          .filter((prediction): prediction is Prediction => prediction != null)
      : []

    return {
      ...question,
      predictions,
    }
  })
}

export async function getMarketDecisionHistoryByMarketIds(
  marketIds: string[],
  questionOutcomeById: Map<string, string>,
): Promise<Map<string, PredictionHistoryEntry[]>> {
  if (marketIds.length === 0) {
    return new Map()
  }

  const snapshotRows = await db.query.modelDecisionSnapshots.findMany({
    where: inArray(modelDecisionSnapshots.marketId, marketIds),
    orderBy: [desc(modelDecisionSnapshots.createdAt)],
    with: {
      actor: true,
    },
  })

  const historyByMarketId = new Map<string, PredictionHistoryEntry[]>()
  for (const row of snapshotRows) {
    if (isMockMarketSnapshotLike(row)) continue
    const current = historyByMarketId.get(row.marketId) || []
    current.push(
      mapSnapshotPrediction(
        row,
        row.actor.modelKey ?? row.actorId,
        questionOutcomeById.get(row.trialQuestionId ?? '') || 'Pending',
      ),
    )
    historyByMarketId.set(row.marketId, current)
  }

  for (const [marketId, history] of historyByMarketId.entries()) {
    historyByMarketId.set(marketId, sortHistoryDescending(history))
  }

  return historyByMarketId
}

export function selectPredictionFromHistory(
  history: PredictionHistoryEntry[],
  mode: LeaderboardPredictionMode,
): PredictionHistoryEntry | null {
  if (history.length === 0) return null
  const sorted = [...history].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return aTime - bTime
  })
  return mode === 'first' ? sorted[0] ?? null : sorted[sorted.length - 1] ?? null
}

type ProviderUsage = NonNullable<ModelDecisionGeneration['usage']>

type PersistedRunUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens: number | null
  estimatedCostUsd: number
  costSource: AICostSource
  cacheCreationInputTokens5m: number | null
  cacheCreationInputTokens1h: number | null
  cacheReadInputTokens: number | null
  webSearchRequests: number | null
  inferenceGeo: string | null
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.round(value))
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function resolveUsageForStorage(args: {
  modelId: ModelId
  promptText: string
  responseText: string
  providerUsage: ProviderUsage | null
  billingMode?: ModelDecisionGeneration['billingMode']
}): PersistedRunUsage {
  const providerInput = toNonNegativeInt(args.providerUsage?.inputTokens ?? null)
  const providerOutput = toNonNegativeInt(args.providerUsage?.outputTokens ?? null)
  const providerTotal = toNonNegativeInt(args.providerUsage?.totalTokens ?? null)
  const providerReasoning = toNonNegativeInt(args.providerUsage?.reasoningTokens ?? null)
  const providerCacheCreation5m = toNonNegativeInt(args.providerUsage?.cacheCreationInputTokens5m ?? null)
  const providerCacheCreation1h = toNonNegativeInt(args.providerUsage?.cacheCreationInputTokens1h ?? null)
  const providerCacheRead = toNonNegativeInt(args.providerUsage?.cacheReadInputTokens ?? null)
  const providerWebSearchRequests = toNonNegativeInt(args.providerUsage?.webSearchRequests ?? null)
  const providerInferenceGeo = toNullableString(args.providerUsage?.inferenceGeo ?? null)

  if (providerInput != null && providerOutput != null) {
    return {
      inputTokens: providerInput,
      outputTokens: providerOutput,
      totalTokens: providerTotal ?? (providerInput + providerOutput),
      reasoningTokens: providerReasoning,
      estimatedCostUsd: args.billingMode === 'subscription'
        ? 0
        : estimateCostFromTokenUsage({
            modelId: args.modelId,
            inputTokens: providerInput,
            outputTokens: providerOutput,
            cacheCreationInputTokens5m: providerCacheCreation5m,
            cacheCreationInputTokens1h: providerCacheCreation1h,
            cacheReadInputTokens: providerCacheRead,
            webSearchRequests: providerWebSearchRequests,
            inferenceGeo: providerInferenceGeo,
          }),
      costSource: args.billingMode === 'subscription' ? 'subscription' : 'provider',
      cacheCreationInputTokens5m: providerCacheCreation5m,
      cacheCreationInputTokens1h: providerCacheCreation1h,
      cacheReadInputTokens: providerCacheRead,
      webSearchRequests: providerWebSearchRequests,
      inferenceGeo: providerInferenceGeo,
    }
  }

  const estimated = estimateTextGenerationCost({
    modelId: args.modelId,
    promptText: args.promptText,
    responseText: args.responseText,
    profile: getCostEstimationProfileForModel(args.modelId),
  })

  return {
    inputTokens: estimated.inputTokens,
    outputTokens: estimated.outputTokens,
    totalTokens: estimated.inputTokens + estimated.outputTokens,
    reasoningTokens: null,
    estimatedCostUsd: args.billingMode === 'subscription' ? 0 : estimated.estimatedCostUsd,
    costSource: args.billingMode === 'subscription' ? 'subscription' : 'estimated',
    cacheCreationInputTokens5m: null,
    cacheCreationInputTokens1h: null,
    cacheReadInputTokens: null,
    webSearchRequests: estimated.webSearchRequests,
    inferenceGeo: null,
  }
}

type ModelDecisionSnapshotArgs = {
  runSource: DecisionRunSource
  runId?: string | null
  modelId: ModelId
  actorId: string
  recordedAt?: Date | null
  runDate: Date
  trial: typeof trials.$inferSelect
  trialQuestionId: string
  questionPrompt: string
  market: typeof predictionMarkets.$inferSelect
  account: typeof marketAccounts.$inferSelect
  position: typeof marketPositions.$inferSelect
  runtimeConfig: MarketRuntimeConfig
}

type StoredDecisionSnapshotResult = Promise<{
  snapshot: typeof modelDecisionSnapshots.$inferSelect
  decision: ModelDecisionResult
  prediction: Prediction
  input: ModelDecisionInput
}>

function buildModelDecisionSnapshotPrediction(args: {
  modelId: ModelId
  decision: ModelDecisionResult
  durationMs: number | null
  snapshot: typeof modelDecisionSnapshots.$inferSelect
  runSource: DecisionRunSource
}): Prediction {
  return {
    predictorId: args.modelId,
    prediction: args.decision.forecast.binaryCall,
    confidence: args.decision.forecast.confidence,
    reasoning: args.decision.forecast.reasoning,
    durationMs: args.durationMs,
    correct: computeCorrectness(args.decision.forecast.binaryCall, 'Pending'),
    createdAt: args.snapshot.createdAt?.toISOString(),
    source: 'snapshot',
    runSource: args.runSource,
    approvalProbability: args.decision.forecast.approvalProbability,
    yesProbability: args.decision.forecast.yesProbability ?? args.decision.forecast.approvalProbability,
    action: {
      type: args.decision.action.type,
      amountUsd: args.decision.action.amountUsd,
      explanation: args.decision.action.explanation,
    },
    linkedMarketActionId: null,
    history: [mapSnapshotPrediction(args.snapshot, args.modelId, 'Pending')],
  }
}

export function buildModelDecisionSnapshotInput(args: ModelDecisionSnapshotArgs): {
  input: ModelDecisionInput
  normalizedRunDate: Date
  tradeCaps: ReturnType<typeof calculateExecutableTradeCaps>
} {
  const normalizedRunDate = normalizeRunDate(args.runDate)
  const tradeCaps = calculateExecutableTradeCaps({
    state: {
      qYes: args.market.qYes,
      qNo: args.market.qNo,
      b: args.market.b,
    },
    accountCash: args.account.cashBalance,
    yesSharesHeld: args.position.yesShares,
    noSharesHeld: args.position.noShares,
  })

  const input: ModelDecisionInput = {
    meta: {
      eventId: args.trial.id,
      trialQuestionId: args.trialQuestionId,
      marketId: args.market.id,
      modelId: args.modelId,
      asOf: args.runDate.toISOString(),
      runDateIso: args.runDate.toISOString(),
    },
    trial: {
      shortTitle: args.trial.shortTitle,
      sponsorName: args.trial.sponsorName,
      sponsorTicker: args.trial.sponsorTicker ?? null,
      exactPhase: args.trial.exactPhase,
      estPrimaryCompletionDate: args.trial.estPrimaryCompletionDate.toISOString(),
      daysToPrimaryCompletion: getDaysUntilUtc(
        args.trial.estPrimaryCompletionDate,
        normalizedRunDate,
      ),
      indication: args.trial.indication,
      intervention: args.trial.intervention,
      primaryEndpoint: args.trial.primaryEndpoint,
      currentStatus: args.trial.currentStatus,
      briefSummary: args.trial.briefSummary,
      nctNumber: args.trial.nctNumber,
      questionPrompt: args.questionPrompt,
    },
    market: {
      yesPrice: args.market.priceYes,
      noPrice: 1 - args.market.priceYes,
    },
    portfolio: {
      cashAvailable: args.account.cashBalance,
      yesSharesHeld: args.position.yesShares,
      noSharesHeld: args.position.noShares,
      maxBuyUsd: tradeCaps.maxBuyUsd,
      maxSellYesUsd: tradeCaps.maxSellYesUsd,
      maxSellNoUsd: tradeCaps.maxSellNoUsd,
    },
    constraints: {
      allowedActions: ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
      explanationMaxChars: 220,
    },
  }

  return {
    input,
    normalizedRunDate,
    tradeCaps,
  }
}

async function insertStoredModelDecisionSnapshot(args: {
  snapshotArgs: ModelDecisionSnapshotArgs
  decision: ModelDecisionResult
  durationMs: number | null
  usage: PersistedRunUsage
  input: ModelDecisionInput
  tradeCaps: ReturnType<typeof calculateExecutableTradeCaps>
}): StoredDecisionSnapshotResult {
  const normalizedRunDate = normalizeRunDate(args.snapshotArgs.runDate)
  const [snapshot] = await db.insert(modelDecisionSnapshots).values({
    runId: args.snapshotArgs.runSource === 'cycle' ? args.snapshotArgs.runId ?? null : null,
    runDate: normalizedRunDate,
    marketId: args.snapshotArgs.market.id,
    trialQuestionId: args.snapshotArgs.trialQuestionId,
    actorId: args.snapshotArgs.actorId,
    runSource: args.snapshotArgs.runSource,
    approvalProbability: args.decision.forecast.approvalProbability,
    yesProbability: args.decision.forecast.yesProbability ?? args.decision.forecast.approvalProbability,
    binaryCall: args.decision.forecast.binaryCall,
    confidence: args.decision.forecast.confidence,
    reasoning: args.decision.forecast.reasoning,
    proposedActionType: args.decision.action.type,
    proposedAmountUsd: args.decision.action.amountUsd,
    proposedExplanation: args.decision.action.explanation,
    marketPriceYes: args.snapshotArgs.market.priceYes,
    marketPriceNo: 1 - args.snapshotArgs.market.priceYes,
    cashAvailable: args.snapshotArgs.account.cashBalance,
    yesSharesHeld: args.snapshotArgs.position.yesShares,
    noSharesHeld: args.snapshotArgs.position.noShares,
    maxBuyUsd: args.tradeCaps.maxBuyUsd,
    maxSellYesUsd: args.tradeCaps.maxSellYesUsd,
    maxSellNoUsd: args.tradeCaps.maxSellNoUsd,
    durationMs: args.durationMs,
    inputTokens: args.usage.inputTokens,
    outputTokens: args.usage.outputTokens,
    totalTokens: args.usage.totalTokens,
    reasoningTokens: args.usage.reasoningTokens,
    estimatedCostUsd: args.usage.estimatedCostUsd,
    costSource: args.usage.costSource,
    cacheCreationInputTokens5m: args.usage.cacheCreationInputTokens5m,
    cacheCreationInputTokens1h: args.usage.cacheCreationInputTokens1h,
    cacheReadInputTokens: args.usage.cacheReadInputTokens,
    webSearchRequests: args.usage.webSearchRequests,
    inferenceGeo: args.usage.inferenceGeo,
    createdAt: args.snapshotArgs.recordedAt ?? undefined,
  }).returning()

  return {
    snapshot,
    decision: args.decision,
    input: args.input,
    prediction: buildModelDecisionSnapshotPrediction({
      modelId: args.snapshotArgs.modelId,
      decision: args.decision,
      durationMs: args.durationMs,
      snapshot,
      runSource: args.snapshotArgs.runSource,
    }),
  }
}

export async function generateAndStoreModelDecisionSnapshot(
  args: ModelDecisionSnapshotArgs & { signal?: AbortSignal },
): StoredDecisionSnapshotResult {
  const generator = MODEL_DECISION_GENERATORS[args.modelId]
  if (!generator?.enabled()) {
    throw new Error(getModelDecisionGeneratorDisabledReason(args.modelId))
  }

  const { input, tradeCaps } = buildModelDecisionSnapshotInput(args)

  const prompt = buildModelDecisionPrompt(input)
  const startedAt = Date.now()
  const generated = await generator.generator(input, { signal: args.signal })
  const durationMs = Date.now() - startedAt
  const usage = resolveUsageForStorage({
    modelId: args.modelId,
    promptText: prompt,
    responseText: generated.rawResponse,
    providerUsage: generated.usage,
    billingMode: generated.billingMode,
  })

  return insertStoredModelDecisionSnapshot({
    snapshotArgs: args,
    decision: generated.result,
    durationMs,
    usage,
    input,
    tradeCaps,
  })
}

export async function storeImportedModelDecisionSnapshot(args: ModelDecisionSnapshotArgs & {
  decision: ModelDecisionResult
  durationMs?: number | null
}): StoredDecisionSnapshotResult {
  const { input, tradeCaps } = buildModelDecisionSnapshotInput(args)

  return insertStoredModelDecisionSnapshot({
    snapshotArgs: args,
    decision: args.decision,
    durationMs: args.durationMs ?? null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: null,
      estimatedCostUsd: 0,
      costSource: 'subscription',
      cacheCreationInputTokens5m: null,
      cacheCreationInputTokens1h: null,
      cacheReadInputTokens: null,
      webSearchRequests: null,
      inferenceGeo: null,
    },
    input,
    tradeCaps,
  })
}

export async function linkSnapshotToMarketAction(snapshotId: string, marketActionId: string | null): Promise<void> {
  await db.update(modelDecisionSnapshots)
    .set({ linkedMarketActionId: marketActionId })
    .where(eq(modelDecisionSnapshots.id, snapshotId))
}
