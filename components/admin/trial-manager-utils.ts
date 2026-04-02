import { MODEL_IDS, MODEL_INFO, OUTCOME_COLORS, type ModelId } from '@/lib/constants'
import type { AdminTrialRunSnapshot } from '@/lib/trial-run-logs'
import { DEFAULT_PHASE2_RESULTS_QUESTION } from '@/lib/trial-questions'
import type {
  DailyRunActivityPhase,
  DailyRunPlannedMarket,
  DailyRunResult,
  DailyRunStatus,
  DailyRunSummary,
} from '@/lib/markets/types'

export type { AdminTrialRunSnapshot } from '@/lib/trial-run-logs'

export interface AdminTrialEvent {
  id: string
  trialId: string
  trialQuestionId: string
  questionSlug: string
  questionPrompt: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string
  nctNumber: string
  decisionDate: string
  outcome: string
  questionStatus: 'live' | 'coming_soon'
  isBettable: boolean
  marketId: string | null
  marketStatus: 'OPEN' | 'RESOLVED' | null
  marketPriceYes: number | null
  marketOpenedAt: string | null
  estimatedModelRunCosts: Partial<Record<ModelId, number>>
}

export interface LastRunSummaryState {
  runDateLabel: string
  runCount: number
  durationSeconds: number
  ok: number
  error: number
  skipped: number
  openMarkets: number
  nonOkModels: string[]
}

export interface DailyRunProgressState {
  startedAtMs: number
  runDate: string | null
  modelOrder: ModelId[]
  orderedMarkets: DailyRunPlannedMarket[]
  openMarkets: number
  totalActions: number
  completedActions: number
  okCount: number
  errorCount: number
  skippedCount: number
  latestResult: DailyRunResult | null
  latestError: DailyRunResult | null
  currentActivity: string | null
}

export interface ErrorConsoleEntry {
  id: string
  utcTime: string
  message: string
}

type ExecutionStepStatus = 'queued' | 'running' | 'waiting' | 'ok' | 'error' | 'skipped'

export interface ExecutionPlanStep {
  key: string
  marketId: string
  trialQuestionId: string
  modelId: ModelId
  marketSequence: number
  modelSequence: number
  globalSequence: number
  status: ExecutionStepStatus
  detail: string | null
}

export interface ExecutionPlanTrial {
  marketId: string
  trialQuestionId: string
  trialId: string
  shortTitle: string
  sponsorName: string
  nctNumber: string
  questionPrompt: string
  decisionDate: string
  marketSequence: number
  steps: ExecutionPlanStep[]
  estimatedModelRunCosts: Partial<Record<ModelId, number>>
}

type AdminMarketRunSnapshot = AdminTrialRunSnapshot
type ExecutionPlanMarket = ExecutionPlanTrial

const DAY_MS = 24 * 60 * 60 * 1000

export function isAdminStoppedMessage(message: string | null | undefined): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return normalized.includes('stop requested by admin') || normalized.includes('stopped by admin')
}

function normalizeRunDateLocal(input?: string | Date | null): Date {
  const parsed = input ? new Date(input) : new Date()
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

export function rotateModelOrderLocal(runDate?: string | Date | null): ModelId[] {
  const normalized = normalizeRunDateLocal(runDate)
  const dayNumber = Math.floor(normalized.getTime() / DAY_MS)
  const offset = ((dayNumber % MODEL_IDS.length) + MODEL_IDS.length) % MODEL_IDS.length
  return MODEL_IDS.map((_, index) => MODEL_IDS[(index + offset) % MODEL_IDS.length])
}

function extractSnapshotModelOrder(snapshot: AdminMarketRunSnapshot): ModelId[] {
  const seen = new Set<ModelId>()
  const orderedModelIds: ModelId[] = []

  for (const log of [...snapshot.logs].reverse()) {
    const modelId = toModelId(log.modelId)
    if (!modelId || seen.has(modelId)) continue
    seen.add(modelId)
    orderedModelIds.push(modelId)
  }

  return orderedModelIds.length > 0 ? orderedModelIds : rotateModelOrderLocal(snapshot.runDate)
}

function extractSnapshotOrderedMarkets(
  events: AdminMarketEvent[],
  snapshot: AdminMarketRunSnapshot
): DailyRunPlannedMarket[] {
  const eventByMarketId = new Map(
    events
      .filter((event): event is AdminMarketEvent & { marketId: string } => typeof event.marketId === 'string')
      .map((event) => [event.marketId, event] as const)
  )

  const seen = new Set<string>()
  const orderedMarkets: DailyRunPlannedMarket[] = []

  for (const log of [...snapshot.logs].reverse()) {
    if (!log.marketId || seen.has(log.marketId)) continue
    const event = eventByMarketId.get(log.marketId)
    if (!event) continue

    seen.add(log.marketId)
    orderedMarkets.push({
      marketId: log.marketId,
      trialQuestionId: event.trialQuestionId,
      trialId: event.trialId,
      shortTitle: event.shortTitle,
      sponsorName: event.sponsorName,
      decisionDate: event.decisionDate,
    })
  }

  return orderedMarkets
}

function toPlannedMarket(event: AdminMarketEvent & { marketId: string }): DailyRunPlannedMarket {
  return {
    marketId: event.marketId,
    trialQuestionId: event.trialQuestionId,
    trialId: event.trialId,
    shortTitle: event.shortTitle,
    sponsorName: event.sponsorName,
    decisionDate: event.decisionDate,
  }
}

function mergeSnapshotMarketsWithOpenQueue(
  events: AdminMarketEvent[],
  snapshot: AdminMarketRunSnapshot
): DailyRunPlannedMarket[] {
  const touchedMarkets = extractSnapshotOrderedMarkets(events, snapshot)
  const openQueueMarkets = sortCycleEvents(events, ['OPEN']).map((event) => toPlannedMarket(event as AdminMarketEvent & { marketId: string }))
  const seen = new Set<string>()
  const merged: DailyRunPlannedMarket[] = []

  for (const market of touchedMarkets) {
    if (seen.has(market.marketId)) continue
    seen.add(market.marketId)
    merged.push(market)
  }

  for (const market of openQueueMarkets) {
    if (seen.has(market.marketId)) continue
    seen.add(market.marketId)
    merged.push(market)
  }

  return merged
}

function sortCycleEvents(
  events: AdminMarketEvent[],
  allowedStatuses: Array<AdminMarketEvent['marketStatus']> = ['OPEN']
): AdminMarketEvent[] {
  return [...events]
    .filter((event) => event.marketId && allowedStatuses.includes(event.marketStatus))
    .sort((a, b) => {
      const aDecisionTime = new Date(a.decisionDate).getTime()
      const bDecisionTime = new Date(b.decisionDate).getTime()
      if (aDecisionTime !== bDecisionTime) return aDecisionTime - bDecisionTime

      const aOpenedTime = a.marketOpenedAt ? new Date(a.marketOpenedAt).getTime() : 0
      const bOpenedTime = b.marketOpenedAt ? new Date(b.marketOpenedAt).getTime() : 0
      if (aOpenedTime !== bOpenedTime) return aOpenedTime - bOpenedTime

      return (a.marketId ?? a.id).localeCompare(b.marketId ?? b.id)
    })
}

export function buildExecutionPlan(input: {
  events: AdminMarketEvent[]
  runDate?: string | Date | null
  modelOrder?: ModelId[]
  orderedMarkets?: DailyRunPlannedMarket[] | null
  fallbackStatuses?: Array<AdminMarketEvent['marketStatus']>
}): ExecutionPlanMarket[] {
  const modelOrder = input.modelOrder && input.modelOrder.length > 0
    ? input.modelOrder
    : rotateModelOrderLocal(input.runDate)

  const marketById = new Map(
    input.events
      .filter((event): event is AdminMarketEvent & { marketId: string } => typeof event.marketId === 'string')
      .map((event) => [event.marketId, event] as const)
  )

  const orderedMarkets = input.orderedMarkets && input.orderedMarkets.length > 0
    ? input.orderedMarkets
    : sortCycleEvents(input.events, input.fallbackStatuses).map((event) => toPlannedMarket(event as AdminMarketEvent & { marketId: string }))

  let globalSequence = 0

  return orderedMarkets.map((market, marketIndex) => {
    const event = marketById.get(market.marketId)
    const steps = modelOrder.map((modelId, modelIndex) => {
      globalSequence += 1
      return {
        key: `${market.marketId}:${modelId}`,
        marketId: market.marketId,
        trialQuestionId: market.trialQuestionId,
        modelId,
        marketSequence: marketIndex + 1,
        modelSequence: modelIndex + 1,
        globalSequence,
        status: 'queued',
        detail: null,
      } satisfies ExecutionPlanStep
    })

    return {
      marketId: market.marketId,
      trialQuestionId: market.trialQuestionId,
      trialId: event?.trialId ?? market.trialId,
      shortTitle: event?.shortTitle ?? market.shortTitle,
      sponsorName: event?.sponsorName ?? market.sponsorName,
      nctNumber: event?.nctNumber ?? '',
      questionPrompt: event?.questionPrompt ?? DEFAULT_PHASE2_RESULTS_QUESTION,
      decisionDate: event?.decisionDate ?? market.decisionDate,
      marketSequence: marketIndex + 1,
      steps,
      estimatedModelRunCosts: event?.estimatedModelRunCosts ?? {},
    } satisfies ExecutionPlanMarket
  })
}

function clearActiveExecutionSteps(plan: ExecutionPlanMarket[]): ExecutionPlanMarket[] {
  return plan.map((market) => ({
    ...market,
    steps: market.steps.map((step) => (
      step.status === 'running' || step.status === 'waiting'
        ? { ...step, status: 'queued' as const }
        : step
    )),
  }))
}

function updateExecutionPlanStep(
  plan: ExecutionPlanMarket[],
  marketId: string,
  modelId: ModelId,
  updater: (step: ExecutionPlanStep) => ExecutionPlanStep
): ExecutionPlanMarket[] {
  let changed = false

  const nextPlan = plan.map((market) => ({
    ...market,
    steps: market.steps.map((step) => {
      if (step.marketId !== marketId || step.modelId !== modelId) return step
      changed = true
      return updater(step)
    }),
  }))

  return changed ? nextPlan : plan
}

export function applyActivityToExecutionPlan(
  plan: ExecutionPlanMarket[],
  input: {
    marketId?: string
    modelId?: ModelId
    phase?: DailyRunActivityPhase
    message: string
  }
): ExecutionPlanMarket[] {
  if (!input.marketId || !input.modelId || !input.phase) return plan
  const clearedPlan = clearActiveExecutionSteps(plan)
  const nextStatus: ExecutionStepStatus = input.phase === 'waiting' ? 'waiting' : 'running'

  return updateExecutionPlanStep(clearedPlan, input.marketId, input.modelId, (step) => ({
    ...step,
    status: nextStatus,
    detail: input.message,
  }))
}

export function applyProgressToExecutionPlan(plan: ExecutionPlanMarket[], result: DailyRunResult): ExecutionPlanMarket[] {
  const clearedPlan = clearActiveExecutionSteps(plan)
  return updateExecutionPlanStep(clearedPlan, result.marketId, result.modelId, (step) => ({
    ...step,
    status: result.status,
    detail: result.detail,
  }))
}

export function finalizeExecutionPlan(plan: ExecutionPlanMarket[]): ExecutionPlanMarket[] {
  return clearActiveExecutionSteps(plan)
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

export function summarizeCounts(results: DailyRunResult[]): DailyRunSummary {
  return results.reduce<DailyRunSummary>((acc, result) => {
    if (result.status === 'ok') acc.ok += 1
    if (result.status === 'error') acc.error += 1
    if (result.status === 'skipped') acc.skipped += 1
    return acc
  }, { ok: 0, error: 0, skipped: 0 })
}

export function summarizeNonOkModels(results: DailyRunResult[]): string[] {
  const entries = results.filter((result) => result.status !== 'ok')
  if (entries.length === 0) return []

  const grouped = new Map<string, { modelId: ModelId; status: DailyRunStatus; count: number }>()
  for (const result of entries) {
    const key = `${result.modelId}:${result.status}`
    const current = grouped.get(key)
    if (current) {
      current.count += 1
      continue
    }
    grouped.set(key, {
      modelId: result.modelId,
      status: result.status,
      count: 1,
    })
  }

  return Array.from(grouped.values()).map((entry) => {
    const modelName = MODEL_INFO[entry.modelId].fullName
    const statusText = entry.status === 'error' ? 'failed' : 'skipped'
    const suffix = entry.count > 1 ? ` x${entry.count}` : ''
    return `${modelName} ${statusText}${suffix}`
  })
}

export function formatProgressLog(result: DailyRunResult): string {
  const modelName = MODEL_INFO[result.modelId].fullName
  const amountPart = result.amountUsd > 0 ? ` ${formatMoney(result.amountUsd)}` : ''
  return `${modelName} ${result.action}${amountPart} (${result.status}) - ${truncateText(result.detail, 110)}`
}

export function statusLabel(status: DailyRunStatus): string {
  if (status === 'ok') return 'OK'
  if (status === 'error') return 'FAILED'
  return 'SKIPPED'
}

export function formatUtcLogPrefix(now: Date = new Date()): string {
  return now.toLocaleTimeString('en-US', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatUtcLogPrefixFromIso(value: string | null | undefined): string {
  if (!value) return formatUtcLogPrefix()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return formatUtcLogPrefix()
  return formatUtcLogPrefix(parsed)
}

function toModelId(value: string | null | undefined): ModelId | null {
  if (!value) return null
  return Object.prototype.hasOwnProperty.call(MODEL_INFO, value) ? value as ModelId : null
}

function getSnapshotCounts(snapshot: AdminMarketRunSnapshot): {
  completedActions: number
  totalActions: number
  okCount: number
  errorCount: number
  skippedCount: number
} {
  return {
    completedActions: snapshot.processedActions,
    totalActions: snapshot.totalActions,
    okCount: snapshot.okCount,
    errorCount: snapshot.errorCount,
    skippedCount: snapshot.skippedCount,
  }
}

export function buildRunLogFromSnapshot(snapshot: AdminMarketRunSnapshot | null): string[] {
  if (!snapshot) return []
  return snapshot.logs
    .map((entry) => `${formatUtcLogPrefixFromIso(entry.createdAt)} UTC  ${entry.message}`)
    .slice(0, 30)
}

export function buildErrorConsoleFromSnapshot(snapshot: AdminMarketRunSnapshot | null): ErrorConsoleEntry[] {
  if (!snapshot) return []

  const errors = snapshot.logs
    .filter((entry) => entry.logType === 'error' || entry.actionStatus === 'error')
    .map((entry) => ({
      id: entry.id,
      utcTime: formatUtcLogPrefixFromIso(entry.createdAt),
      message: entry.message,
    }))

  if (snapshot.status !== 'running' && snapshot.failureReason) {
    const exists = errors.some((entry) => entry.message.includes(snapshot.failureReason ?? ''))
    if (!exists) {
      errors.unshift({
        id: `${snapshot.runId}-failure`,
        utcTime: formatUtcLogPrefixFromIso(snapshot.updatedAt || snapshot.completedAt || snapshot.createdAt),
        message: `${isAdminStoppedMessage(snapshot.failureReason) ? 'RUN STOPPED' : 'RUN FAILED'} - ${snapshot.failureReason}`,
      })
    }
  }

  return errors.slice(0, 25)
}

export function buildRunSummaryFromSnapshot(snapshot: AdminMarketRunSnapshot | null): LastRunSummaryState | null {
  if (!snapshot || snapshot.status === 'running') return null

  const counts = getSnapshotCounts(snapshot)
  const startedAt = snapshot.createdAt ? new Date(snapshot.createdAt) : null
  const endedAt = snapshot.completedAt
    ? new Date(snapshot.completedAt)
    : snapshot.updatedAt
      ? new Date(snapshot.updatedAt)
      : null
  const durationSeconds = startedAt && endedAt
    ? Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
    : 1

  const syntheticResults: DailyRunResult[] = snapshot.logs
    .map((entry) => {
      const modelId = toModelId(entry.modelId)
      if (!modelId || !entry.action || !entry.actionStatus) return null

      return {
        marketId: '',
        trialQuestionId: entry.trialQuestionId ?? '',
        actorId: entry.actorId,
        modelId,
        action: entry.action,
        amountUsd: entry.amountUsd ?? 0,
        status: entry.actionStatus,
        detail: entry.message,
      } satisfies DailyRunResult
    })
    .filter((entry): entry is DailyRunResult => entry !== null)

  const nonOkModels = summarizeNonOkModels(syntheticResults)

  return {
    runDateLabel: new Date(snapshot.runDate).toLocaleString('en-US', { timeZone: 'UTC' }),
    runCount: snapshot.runCount,
    durationSeconds,
    ok: counts.okCount,
    error: counts.errorCount,
    skipped: counts.skippedCount,
    openMarkets: snapshot.openMarkets,
    nonOkModels,
  }
}

export function buildRunProgressFromSnapshot(snapshot: AdminMarketRunSnapshot | null): DailyRunProgressState | null {
  if (!snapshot) return null

  const counts = getSnapshotCounts(snapshot)
  const latestResultLog = snapshot.logs.find((entry) => {
    const modelId = toModelId(entry.modelId)
    return modelId != null && entry.action != null && entry.actionStatus != null
  })
  const latestErrorLog = snapshot.logs.find((entry) => entry.logType === 'error' || entry.actionStatus === 'error')

  const latestResult = latestResultLog
    ? (() => {
        const modelId = toModelId(latestResultLog.modelId)
        if (!modelId || !latestResultLog.action || !latestResultLog.actionStatus) return null
        return {
          marketId: '',
          trialQuestionId: latestResultLog.trialQuestionId ?? '',
          actorId: latestResultLog.actorId,
          modelId,
          action: latestResultLog.action,
          amountUsd: latestResultLog.amountUsd ?? 0,
          status: latestResultLog.actionStatus,
          detail: latestResultLog.message,
        } satisfies DailyRunResult
      })()
    : null

  const latestError = latestErrorLog
    ? (() => {
        const modelId = toModelId(latestErrorLog.modelId)
        if (!modelId || !latestErrorLog.action || !latestErrorLog.actionStatus) return null
        return {
          marketId: '',
          trialQuestionId: latestErrorLog.trialQuestionId ?? '',
          actorId: latestErrorLog.actorId,
          modelId,
          action: latestErrorLog.action,
          amountUsd: latestErrorLog.amountUsd ?? 0,
          status: latestErrorLog.actionStatus,
          detail: latestErrorLog.message,
        } satisfies DailyRunResult
      })()
    : null

  const activityLog = snapshot.logs.find((entry) => entry.logType !== 'error')
  const stopRequested = snapshot.status === 'running' && isAdminStoppedMessage(snapshot.failureReason)
  const defaultActivity = snapshot.status === 'running'
    ? (stopRequested ? snapshot.failureReason : 'Daily run is in progress...')
    : snapshot.status === 'completed'
      ? 'Daily trial cycle completed'
      : (isAdminStoppedMessage(snapshot.failureReason) ? 'Daily trial cycle stopped by admin' : 'Daily trial cycle failed')

  return {
    startedAtMs: snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : Date.now(),
    runDate: snapshot.runDate,
    modelOrder: extractSnapshotModelOrder(snapshot),
    orderedMarkets: [],
    openMarkets: snapshot.openMarkets,
    totalActions: counts.totalActions,
    completedActions: counts.completedActions,
    okCount: counts.okCount,
    errorCount: counts.errorCount,
    skippedCount: counts.skippedCount,
    latestResult,
    latestError,
    currentActivity: activityLog?.message ?? defaultActivity,
  }
}

export function buildExecutionPlanFromSnapshot(
  events: AdminMarketEvent[],
  snapshot: AdminMarketRunSnapshot | null
): ExecutionPlanMarket[] {
  if (!snapshot) {
    return buildExecutionPlan({
      events,
      runDate: new Date().toISOString(),
      fallbackStatuses: ['OPEN'],
    })
  }

  const orderedMarkets = mergeSnapshotMarketsWithOpenQueue(events, snapshot)

  let plan = buildExecutionPlan({
    events,
    runDate: snapshot.runDate,
    modelOrder: extractSnapshotModelOrder(snapshot),
    orderedMarkets: orderedMarkets.length > 0 ? orderedMarkets : undefined,
    fallbackStatuses: ['OPEN', 'RESOLVED'],
  })

  if (plan.length === 0) {
    plan = buildExecutionPlan({
      events,
      runDate: snapshot.runDate,
      fallbackStatuses: ['OPEN'],
    })
  }

  for (const log of [...snapshot.logs].reverse()) {
    const modelId = toModelId(log.modelId)

    if (log.actionStatus && modelId && log.marketId) {
      plan = applyProgressToExecutionPlan(plan, {
        marketId: log.marketId,
        trialQuestionId: log.trialQuestionId ?? '',
        actorId: log.actorId,
        modelId,
        action: log.action ?? 'HOLD',
        amountUsd: log.amountUsd ?? 0,
        status: log.actionStatus,
        detail: log.message,
      })
      continue
    }

    if (log.logType === 'activity' && modelId && log.marketId && log.activityPhase) {
      plan = applyActivityToExecutionPlan(plan, {
        marketId: log.marketId,
        modelId,
        phase: log.activityPhase,
        message: log.message,
      })
    }
  }

  return snapshot.status === 'running' ? plan : finalizeExecutionPlan(plan)
}

export function buildNextExecutionPlan(events: AdminMarketEvent[], runDate?: string | Date | null): ExecutionPlanMarket[] {
  return buildExecutionPlan({
    events,
    runDate: runDate ?? new Date().toISOString(),
    fallbackStatuses: ['OPEN'],
  })
}

export function getCurrentExecutionStep(plan: ExecutionPlanMarket[]): ExecutionPlanStep | null {
  for (const market of plan) {
    const activeStep = market.steps.find((step) => step.status === 'running' || step.status === 'waiting')
    if (activeStep) return activeStep
  }

  return null
}

export function getExecutionStepTone(status: ExecutionStepStatus): {
  container: string
  badge: string
  label: string
} {
  if (status === 'ok') {
    return {
      container: 'border-[#3a8a2e]/30 bg-[#3a8a2e]/10',
      badge: 'border-[#3a8a2e]/30 bg-white/80 text-[#2f6f24]',
      label: 'text-[#2f6f24]',
    }
  }

  if (status === 'error') {
    return {
      container: 'border-[#c43a2b]/30 bg-[#fff3f1]',
      badge: 'border-[#c43a2b]/30 bg-white/80 text-[#8d2c22]',
      label: 'text-[#8d2c22]',
    }
  }

  if (status === 'skipped') {
    return {
      container: 'border-[#b5aa9e]/45 bg-[#f5f2ed]',
      badge: 'border-[#d9ccbb] bg-white/80 text-[#6f665b]',
      label: 'text-[#6f665b]',
    }
  }

  if (status === 'running') {
    return {
      container: 'border-[#2d7cf6]/35 bg-[#2d7cf6]/12',
      badge: 'border-[#2d7cf6]/35 bg-white/85 text-[#1f5cb9]',
      label: 'text-[#1f5cb9]',
    }
  }

  if (status === 'waiting') {
    return {
      container: 'border-[#5BA5ED]/35 bg-[#5BA5ED]/10',
      badge: 'border-[#5BA5ED]/35 bg-white/85 text-[#265f8f]',
      label: 'text-[#265f8f]',
    }
  }

  return {
    container: 'border-[#e8ddd0] bg-white/75',
    badge: 'border-[#e8ddd0] bg-[#f8f4ee] text-[#8a8075]',
    label: 'text-[#8a8075]',
  }
}

export function getExecutionStatusLabel(status: ExecutionStepStatus): string {
  if (status === 'ok') return 'Done'
  if (status === 'error') return 'Failed'
  if (status === 'skipped') return 'Skipped'
  if (status === 'running') return 'Running'
  if (status === 'waiting') return 'Waiting'
  return 'Queued'
}

export function getTrialStatusTone(status: AdminMarketEvent['marketStatus']): string {
  if (status === 'OPEN') return 'text-[#3a8a2e] bg-[#3a8a2e]/10'
  if (status === 'RESOLVED') return 'text-[#b5aa9e] bg-[#b5aa9e]/15'
  return 'text-[#8a8075] bg-[#e8ddd0]/40'
}

export function getOutcomeStyle(outcome: string): string {
  const colors = OUTCOME_COLORS[outcome as keyof typeof OUTCOME_COLORS]
  return colors ? `${colors.bg} ${colors.text}` : 'bg-[#F5F2ED] text-[#8a8075]'
}

type AdminMarketEvent = AdminTrialEvent
