import { desc, eq, inArray } from 'drizzle-orm'
import { estimateCostFromTokenUsage, estimateTextGenerationCost, getCostEstimationProfileForModel, type AICostSource } from '@/lib/ai-costs'
import { type ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import {
  db,
  marketAccounts,
  marketPositions,
  modelDecisionSnapshots,
  phase2Trials,
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
  type ModelDecisionGeneratorOptions,
} from '@/lib/predictions/model-decision-generators'
import { buildModelDecisionPrompt, type ModelDecisionInput, type ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'

type DecisionRunSource = 'manual' | 'cycle'
export type LeaderboardPredictionMode = 'first' | 'final'

type UnifiedPredictionHistoryMap = Map<string, Map<string, PredictionHistoryEntry[]>>

function computeCorrectness(prediction: string, eventOutcome: string): boolean | null {
  if (
    eventOutcome !== 'Approved' &&
    eventOutcome !== 'Rejected' &&
    eventOutcome !== 'YES' &&
    eventOutcome !== 'NO'
  ) {
    return null
  }

  return (
    (prediction === 'approved' && eventOutcome === 'Approved') ||
    (prediction === 'rejected' && eventOutcome === 'Rejected') ||
    (prediction === 'yes' && eventOutcome === 'YES') ||
    (prediction === 'no' && eventOutcome === 'NO')
  )
}

function mapSnapshotPrediction(
  row: typeof modelDecisionSnapshots.$inferSelect,
  predictorId: string,
  eventOutcome: string,
): PredictionHistoryEntry {
  return {
    id: row.id,
    predictorId,
    prediction: row.binaryCall,
    confidence: row.confidence,
    reasoning: row.reasoning,
    durationMs: row.durationMs,
    correct: computeCorrectness(row.binaryCall, eventOutcome),
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

export async function getUnifiedPredictionHistoriesByEventIds(
  eventIds: string[],
  eventOutcomeById: Map<string, string>,
): Promise<UnifiedPredictionHistoryMap> {
  if (eventIds.length === 0) {
    return new Map()
  }

  const [snapshotRows] = await Promise.all([
    db.query.modelDecisionSnapshots.findMany({
      where: inArray(modelDecisionSnapshots.trialQuestionId, eventIds),
      orderBy: [desc(modelDecisionSnapshots.createdAt)],
      with: {
        actor: true,
      },
    }),
  ])

  const historyByEventId = new Map<string, Map<string, PredictionHistoryEntry[]>>()

  const pushHistory = (eventId: string, predictorId: string, entry: PredictionHistoryEntry) => {
    const eventMap = historyByEventId.get(eventId) || new Map<string, PredictionHistoryEntry[]>()
    const current = eventMap.get(predictorId) || []
    current.push(entry)
    eventMap.set(predictorId, current)
    historyByEventId.set(eventId, eventMap)
  }

  for (const row of snapshotRows) {
    if (isMockMarketSnapshotLike(row)) continue
    const predictorId = row.actor.modelKey ?? row.actorId
    const ownerId = row.trialQuestionId
    if (!ownerId) continue
    pushHistory(
      ownerId,
      predictorId,
      mapSnapshotPrediction(row, predictorId, eventOutcomeById.get(ownerId) || 'Pending'),
    )
  }

  for (const eventMap of historyByEventId.values()) {
    for (const [predictorId, history] of eventMap.entries()) {
      eventMap.set(predictorId, sortHistoryDescending(history))
    }
  }

  return historyByEventId
}

export async function attachUnifiedPredictionsToEvents<T extends { id: string; outcome: string }>(events: T[]): Promise<Array<T & { predictions: Prediction[] }>> {
  const eventIds = events.map((event) => event.id)
  const eventOutcomeById = new Map(events.map((event) => [event.id, event.outcome]))
  const historyByEventId = await getUnifiedPredictionHistoriesByEventIds(eventIds, eventOutcomeById)

  return events.map((event) => {
    const eventHistory = historyByEventId.get(event.id)
    const predictions = eventHistory
      ? Array.from(eventHistory.values())
          .map((history) => buildLatestPrediction(history))
          .filter((prediction): prediction is Prediction => prediction != null)
      : []

    return {
      ...event,
      predictions,
    }
  })
}

export async function getMarketDecisionHistoryByMarketIds(
  marketIds: string[],
  eventOutcomeById: Map<string, string>,
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
        eventOutcomeById.get(row.trialQuestionId ?? '') || 'Pending',
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

export async function generateAndStoreModelDecisionSnapshot(args: {
  runSource: DecisionRunSource
  runId?: string | null
  modelId: ModelId
  actorId: string
  runDate: Date
  trial: typeof phase2Trials.$inferSelect
  trialQuestionId?: string | null
  questionPrompt: string
  market: typeof predictionMarkets.$inferSelect
  account: typeof marketAccounts.$inferSelect
  position: typeof marketPositions.$inferSelect
  runtimeConfig: MarketRuntimeConfig
  generatorOptions?: ModelDecisionGeneratorOptions
}): Promise<{
  snapshot: typeof modelDecisionSnapshots.$inferSelect
  decision: ModelDecisionResult
  prediction: Prediction
  input: ModelDecisionInput
}> {
  const generator = MODEL_DECISION_GENERATORS[args.modelId]
  if (!generator?.enabled(args.generatorOptions)) {
    throw new Error(getModelDecisionGeneratorDisabledReason(args.modelId, args.generatorOptions))
  }

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
    marketOpenedAt: args.market.openedAt,
    runDate: normalizedRunDate,
    config: args.runtimeConfig,
  })

  const input: ModelDecisionInput = {
    meta: {
      eventId: args.trial.id,
      trialQuestionId: args.trialQuestionId ?? null,
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

  const prompt = buildModelDecisionPrompt(input)
  const startedAt = Date.now()
  const generated = await generator.generator(input, args.generatorOptions)
  const durationMs = Date.now() - startedAt
  const usage = resolveUsageForStorage({
    modelId: args.modelId,
    promptText: prompt,
    responseText: generated.rawResponse,
    providerUsage: generated.usage,
    billingMode: generated.billingMode,
  })

  const [snapshot] = await db.insert(modelDecisionSnapshots).values({
    runId: args.runSource === 'cycle' ? args.runId ?? null : null,
    runDate: normalizedRunDate,
    marketId: args.market.id,
    trialQuestionId: args.trialQuestionId ?? null,
    actorId: args.actorId,
    runSource: args.runSource,
    approvalProbability: generated.result.forecast.approvalProbability,
    yesProbability: generated.result.forecast.yesProbability ?? generated.result.forecast.approvalProbability,
    binaryCall: generated.result.forecast.binaryCall,
    confidence: generated.result.forecast.confidence,
    reasoning: generated.result.forecast.reasoning,
    proposedActionType: generated.result.action.type,
    proposedAmountUsd: generated.result.action.amountUsd,
    proposedExplanation: generated.result.action.explanation,
    marketPriceYes: args.market.priceYes,
    marketPriceNo: 1 - args.market.priceYes,
    cashAvailable: args.account.cashBalance,
    yesSharesHeld: args.position.yesShares,
    noSharesHeld: args.position.noShares,
    maxBuyUsd: tradeCaps.maxBuyUsd,
    maxSellYesUsd: tradeCaps.maxSellYesUsd,
    maxSellNoUsd: tradeCaps.maxSellNoUsd,
    durationMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    costSource: usage.costSource,
    cacheCreationInputTokens5m: usage.cacheCreationInputTokens5m,
    cacheCreationInputTokens1h: usage.cacheCreationInputTokens1h,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    webSearchRequests: usage.webSearchRequests,
    inferenceGeo: usage.inferenceGeo,
  }).returning()

  return {
    snapshot,
    decision: generated.result,
    input,
    prediction: {
      predictorId: args.modelId,
      prediction: generated.result.forecast.binaryCall,
      confidence: generated.result.forecast.confidence,
      reasoning: generated.result.forecast.reasoning,
      durationMs,
      correct: computeCorrectness(generated.result.forecast.binaryCall, 'Pending'),
      createdAt: snapshot.createdAt?.toISOString(),
      source: 'snapshot',
      runSource: args.runSource,
      approvalProbability: generated.result.forecast.approvalProbability,
      yesProbability: generated.result.forecast.yesProbability ?? generated.result.forecast.approvalProbability,
      action: {
        type: generated.result.action.type,
        amountUsd: generated.result.action.amountUsd,
        explanation: generated.result.action.explanation,
      },
      linkedMarketActionId: null,
      history: [mapSnapshotPrediction(snapshot, args.modelId, 'Pending')],
    },
  }
}

export async function linkSnapshotToMarketAction(snapshotId: string, marketActionId: string | null): Promise<void> {
  await db.update(modelDecisionSnapshots)
    .set({ linkedMarketActionId: marketActionId })
    .where(eq(modelDecisionSnapshots.id, snapshotId))
}
