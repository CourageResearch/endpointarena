'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDate, MODEL_IDS, MODEL_INFO, type ModelId } from '@/lib/constants'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import type {
  DailyRunActivityPhase,
  DailyRunPayload,
  DailyRunPlannedMarket,
  DailyRunResult,
  DailyRunStatus,
  DailyRunSummary,
  DailyRunStreamEvent,
} from '@/lib/markets/types'
import type { AdminMarketRunSnapshot } from '@/lib/market-run-logs'

interface AdminMarketEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string
  pdufaDate: string
  outcome: string
  marketId: string | null
  marketStatus: 'OPEN' | 'RESOLVED' | null
  marketPriceYes: number | null
  marketOpenedAt: string | null
}

interface Props {
  events: AdminMarketEvent[]
  initialRunSnapshot: AdminMarketRunSnapshot | null
}

interface LastRunSummaryState {
  runDateLabel: string
  durationSeconds: number
  ok: number
  error: number
  skipped: number
  openMarkets: number
  nonOkModels: string[]
}

interface DailyRunProgressState {
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

interface ErrorConsoleEntry {
  id: string
  utcTime: string
  message: string
}

type ExecutionStepStatus = 'queued' | 'running' | 'waiting' | 'ok' | 'error' | 'skipped'

interface ExecutionPlanStep {
  key: string
  marketId: string
  fdaEventId: string
  modelId: ModelId
  marketSequence: number
  modelSequence: number
  globalSequence: number
  status: ExecutionStepStatus
  detail: string | null
}

interface ExecutionPlanMarket {
  marketId: string
  fdaEventId: string
  drugName: string
  companyName: string
  pdufaDate: string
  marketSequence: number
  steps: ExecutionPlanStep[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function normalizeRunDateLocal(input?: string | Date | null): Date {
  const parsed = input ? new Date(input) : new Date()
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

function rotateModelOrderLocal(runDate?: string | Date | null): ModelId[] {
  const normalized = normalizeRunDateLocal(runDate)
  const dayNumber = Math.floor(normalized.getTime() / DAY_MS)
  const offset = ((dayNumber % MODEL_IDS.length) + MODEL_IDS.length) % MODEL_IDS.length
  return MODEL_IDS.map((_, index) => MODEL_IDS[(index + offset) % MODEL_IDS.length])
}

function sortCycleEvents(
  events: AdminMarketEvent[],
  allowedStatuses: Array<AdminMarketEvent['marketStatus']> = ['OPEN']
): AdminMarketEvent[] {
  return [...events]
    .filter((event) => event.marketId && allowedStatuses.includes(event.marketStatus))
    .sort((a, b) => {
      const aPdufaTime = new Date(a.pdufaDate).getTime()
      const bPdufaTime = new Date(b.pdufaDate).getTime()
      if (aPdufaTime !== bPdufaTime) return aPdufaTime - bPdufaTime

      const aOpenedTime = a.marketOpenedAt ? new Date(a.marketOpenedAt).getTime() : 0
      const bOpenedTime = b.marketOpenedAt ? new Date(b.marketOpenedAt).getTime() : 0
      if (aOpenedTime !== bOpenedTime) return aOpenedTime - bOpenedTime

      return (a.marketId ?? a.id).localeCompare(b.marketId ?? b.id)
    })
}

function buildExecutionPlan(input: {
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
    : sortCycleEvents(input.events, input.fallbackStatuses).map((event) => ({
        marketId: event.marketId as string,
        fdaEventId: event.id,
        drugName: event.drugName,
        companyName: event.companyName,
        pdufaDate: event.pdufaDate,
      }))

  let globalSequence = 0

  return orderedMarkets.map((market, marketIndex) => {
    const event = marketById.get(market.marketId)
    const steps = modelOrder.map((modelId, modelIndex) => {
      globalSequence += 1
      return {
        key: `${market.marketId}:${modelId}`,
        marketId: market.marketId,
        fdaEventId: market.fdaEventId,
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
      fdaEventId: market.fdaEventId,
      drugName: event?.drugName ?? market.drugName,
      companyName: event?.companyName ?? market.companyName,
      pdufaDate: event?.pdufaDate ?? market.pdufaDate,
      marketSequence: marketIndex + 1,
      steps,
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

function applyActivityToExecutionPlan(
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

function applyProgressToExecutionPlan(plan: ExecutionPlanMarket[], result: DailyRunResult): ExecutionPlanMarket[] {
  const clearedPlan = clearActiveExecutionSteps(plan)
  return updateExecutionPlanStep(clearedPlan, result.marketId, result.modelId, (step) => ({
    ...step,
    status: result.status,
    detail: result.detail,
  }))
}

function finalizeExecutionPlan(plan: ExecutionPlanMarket[]): ExecutionPlanMarket[] {
  return clearActiveExecutionSteps(plan)
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

function summarizeCounts(results: DailyRunResult[]): DailyRunSummary {
  return results.reduce<DailyRunSummary>((acc, result) => {
    if (result.status === 'ok') acc.ok += 1
    if (result.status === 'error') acc.error += 1
    if (result.status === 'skipped') acc.skipped += 1
    return acc
  }, { ok: 0, error: 0, skipped: 0 })
}

function summarizeNonOkModels(results: DailyRunResult[]): string[] {
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

function formatProgressLog(result: DailyRunResult): string {
  const modelName = MODEL_INFO[result.modelId].fullName
  const amountPart = result.amountUsd > 0 ? ` ${formatMoney(result.amountUsd)}` : ''
  return `${modelName} ${result.action}${amountPart} (${result.status}) - ${truncateText(result.detail, 110)}`
}

function statusLabel(status: DailyRunStatus): string {
  if (status === 'ok') return 'OK'
  if (status === 'error') return 'FAILED'
  return 'SKIPPED'
}

function formatUtcLogPrefix(now: Date = new Date()): string {
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
  for (const log of snapshot.logs) {
    if (
      log.completedActions != null ||
      log.totalActions != null ||
      log.okCount != null ||
      log.errorCount != null ||
      log.skippedCount != null
    ) {
      return {
        completedActions: log.completedActions ?? snapshot.processedActions,
        totalActions: log.totalActions ?? snapshot.totalActions,
        okCount: log.okCount ?? snapshot.okCount,
        errorCount: log.errorCount ?? snapshot.errorCount,
        skippedCount: log.skippedCount ?? snapshot.skippedCount,
      }
    }
  }

  return {
    completedActions: snapshot.processedActions,
    totalActions: snapshot.totalActions,
    okCount: snapshot.okCount,
    errorCount: snapshot.errorCount,
    skippedCount: snapshot.skippedCount,
  }
}

function buildRunLogFromSnapshot(snapshot: AdminMarketRunSnapshot | null): string[] {
  if (!snapshot) return []
  return snapshot.logs
    .map((entry) => `${formatUtcLogPrefixFromIso(entry.createdAt)} UTC  ${entry.message}`)
    .slice(0, 30)
}

function buildErrorConsoleFromSnapshot(snapshot: AdminMarketRunSnapshot | null): ErrorConsoleEntry[] {
  if (!snapshot) return []

  const errors = snapshot.logs
    .filter((entry) => entry.logType === 'error' || entry.actionStatus === 'error')
    .map((entry) => ({
      id: entry.id,
      utcTime: formatUtcLogPrefixFromIso(entry.createdAt),
      message: entry.message,
    }))

  if (snapshot.failureReason) {
    const exists = errors.some((entry) => entry.message.includes(snapshot.failureReason ?? ''))
    if (!exists) {
      errors.unshift({
        id: `${snapshot.runId}-failure`,
        utcTime: formatUtcLogPrefixFromIso(snapshot.updatedAt || snapshot.completedAt || snapshot.createdAt),
        message: `RUN FAILED - ${snapshot.failureReason}`,
      })
    }
  }

  return errors.slice(0, 25)
}

function buildRunSummaryFromSnapshot(snapshot: AdminMarketRunSnapshot | null): LastRunSummaryState | null {
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
        fdaEventId: '',
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
    durationSeconds,
    ok: counts.okCount,
    error: counts.errorCount,
    skipped: counts.skippedCount,
    openMarkets: snapshot.openMarkets,
    nonOkModels,
  }
}

function buildRunProgressFromSnapshot(snapshot: AdminMarketRunSnapshot | null): DailyRunProgressState | null {
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
          fdaEventId: '',
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
          fdaEventId: '',
          modelId,
          action: latestErrorLog.action,
          amountUsd: latestErrorLog.amountUsd ?? 0,
          status: latestErrorLog.actionStatus,
          detail: latestErrorLog.message,
        } satisfies DailyRunResult
      })()
    : null

  const activityLog = snapshot.logs.find((entry) => entry.logType !== 'error')
  const defaultActivity = snapshot.status === 'running'
    ? 'Daily run is in progress...'
    : snapshot.status === 'completed'
      ? 'Daily market cycle completed'
      : 'Daily market cycle failed'

  return {
    startedAtMs: snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : Date.now(),
    runDate: snapshot.runDate,
    modelOrder: rotateModelOrderLocal(snapshot.runDate),
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

function buildExecutionPlanFromSnapshot(
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

  let plan = buildExecutionPlan({
    events,
    runDate: snapshot.runDate,
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
        fdaEventId: log.fdaEventId ?? '',
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

function buildNextExecutionPlan(events: AdminMarketEvent[], runDate?: string | Date | null): ExecutionPlanMarket[] {
  return buildExecutionPlan({
    events,
    runDate: runDate ?? new Date().toISOString(),
    fallbackStatuses: ['OPEN'],
  })
}

function getCurrentExecutionStep(plan: ExecutionPlanMarket[]): ExecutionPlanStep | null {
  for (const market of plan) {
    const activeStep = market.steps.find((step) => step.status === 'running' || step.status === 'waiting')
    if (activeStep) return activeStep
  }

  return null
}

function getExecutionStepTone(status: ExecutionStepStatus): {
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

function getExecutionStatusLabel(status: ExecutionStepStatus): string {
  if (status === 'ok') return 'Done'
  if (status === 'error') return 'Failed'
  if (status === 'skipped') return 'Skipped'
  if (status === 'running') return 'Running'
  if (status === 'waiting') return 'Waiting'
  return 'Queued'
}

export function AdminMarketManager({ events: initialEvents, initialRunSnapshot }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [search, setSearch] = useState('')
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null)
  const [runningDaily, setRunningDaily] = useState(initialRunSnapshot?.status === 'running')
  const [lastRunSummary, setLastRunSummary] = useState<LastRunSummaryState | null>(() => buildRunSummaryFromSnapshot(initialRunSnapshot))
  const [runProgress, setRunProgress] = useState<DailyRunProgressState | null>(() => buildRunProgressFromSnapshot(initialRunSnapshot))
  const [elapsedSeconds, setElapsedSeconds] = useState(() => buildRunSummaryFromSnapshot(initialRunSnapshot)?.durationSeconds ?? 0)
  const [runLog, setRunLog] = useState<string[]>(() => buildRunLogFromSnapshot(initialRunSnapshot))
  const [errorConsole, setErrorConsole] = useState<ErrorConsoleEntry[]>(() => buildErrorConsoleFromSnapshot(initialRunSnapshot))
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlanMarket[]>(() => (
    initialRunSnapshot?.status === 'running'
      ? buildExecutionPlanFromSnapshot(initialEvents, initialRunSnapshot)
      : buildNextExecutionPlan(initialEvents)
  ))
  const [preserveExecutionPlan, setPreserveExecutionPlan] = useState(initialRunSnapshot?.status === 'running')
  const [uiError, setUiError] = useState<string | null>(null)
  const [isStreamingRun, setIsStreamingRun] = useState(false)

  const runStartedAtMs = runProgress?.startedAtMs ?? null
  const currentExecutionStep = useMemo(() => getCurrentExecutionStep(executionPlan), [executionPlan])

  useEffect(() => {
    if (!runningDaily || runStartedAtMs === null) return

    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)))
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [runningDaily, runStartedAtMs])

  const applyRunSnapshot = (snapshot: AdminMarketRunSnapshot | null) => {
    if (!snapshot) {
      setPreserveExecutionPlan(false)
      setExecutionPlan(buildNextExecutionPlan(events))
      return
    }

    const nextProgress = buildRunProgressFromSnapshot(snapshot)
    const nextSummary = buildRunSummaryFromSnapshot(snapshot)

    setRunLog(buildRunLogFromSnapshot(snapshot))
    setErrorConsole(buildErrorConsoleFromSnapshot(snapshot))
    setRunProgress(nextProgress)
    setExecutionPlan(
      snapshot.status === 'running'
        ? buildExecutionPlanFromSnapshot(events, snapshot)
        : buildNextExecutionPlan(events, snapshot.runDate)
    )

    if (snapshot.status === 'running') {
      setPreserveExecutionPlan(true)
      setRunningDaily(true)
      setLastRunSummary(null)
      return
    }

    setRunningDaily(false)
    setLastRunSummary(nextSummary)
    setElapsedSeconds(nextSummary?.durationSeconds ?? 0)
  }

  useEffect(() => {
    if (runningDaily || preserveExecutionPlan) return
    setExecutionPlan(buildNextExecutionPlan(events))
  }, [events, preserveExecutionPlan, runningDaily])

  useEffect(() => {
    if (!runningDaily || isStreamingRun) return

    let cancelled = false

    const pollState = async () => {
      try {
        const response = await fetch('/api/admin/markets/run-state', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) return
        applyRunSnapshot(payload?.snapshot ?? null)
      } catch {
        // Keep existing client state if polling fails.
      }
    }

    void pollState()
    const timer = window.setInterval(() => {
      void pollState()
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isStreamingRun, runningDaily])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter((event) =>
      event.drugName.toLowerCase().includes(q) ||
      event.companyName.toLowerCase().includes(q) ||
      event.symbols.toLowerCase().includes(q)
    )
  }, [events, search])

  const openMarket = async (fdaEventId: string) => {
    setUiError(null)
    setLoadingEventId(fdaEventId)
    try {
      const response = await fetch('/api/markets/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fdaEventId }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiErrorMessage(data, 'Failed to open market'))

      setEvents((prev) => prev.map((event) => (
        event.id === fdaEventId
          ? {
              ...event,
              marketId: data.market.id,
              marketStatus: data.market.status,
              marketPriceYes: data.market.priceYes,
              marketOpenedAt: data.market.openedAt,
            }
          : event
      )))
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to open market')
    } finally {
      setLoadingEventId(null)
    }
  }

  const appendRunLog = (line: string) => {
    const prefix = formatUtcLogPrefix()
    setRunLog((prev) => [`${prefix} UTC  ${line}`, ...prev].slice(0, 10))
  }

  const appendErrorConsole = (message: string) => {
    const utcTime = formatUtcLogPrefix()
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setErrorConsole((prev) => [{ id, utcTime, message }, ...prev].slice(0, 25))
  }

  const setSummaryFromPayload = (payload: DailyRunPayload, startedAtMs: number) => {
    const counts = payload.summary ?? summarizeCounts(payload.results)
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000))
    const runDateLabel = new Date(payload.runDate).toLocaleString('en-US', { timeZone: 'UTC' })
    const nonOkModels = summarizeNonOkModels(payload.results)

    setLastRunSummary({
      runDateLabel,
      durationSeconds,
      ok: counts.ok,
      error: counts.error,
      skipped: counts.skipped,
      openMarkets: payload.openMarkets,
      nonOkModels,
    })
  }

  const runDailyCycle = async () => {
    const startedAtMs = Date.now()
    let keepPersistedRunningState = false

    setUiError(null)
    setIsStreamingRun(true)
    setPreserveExecutionPlan(true)
    setRunningDaily(true)
    setLastRunSummary(null)
    setElapsedSeconds(0)
    setRunLog([`${formatUtcLogPrefix(new Date(startedAtMs))} UTC  Starting daily market cycle...`])
    setErrorConsole([])
    setRunProgress({
      startedAtMs,
      runDate: null,
      modelOrder: rotateModelOrderLocal(new Date(startedAtMs)),
      orderedMarkets: [],
      openMarkets: 0,
      totalActions: 0,
      completedActions: 0,
      okCount: 0,
      errorCount: 0,
      skippedCount: 0,
      latestResult: null,
      latestError: null,
      currentActivity: 'Initializing daily run...',
    })
    setExecutionPlan(buildExecutionPlan({
      events,
      runDate: new Date(startedAtMs),
      fallbackStatuses: ['OPEN'],
    }))

    try {
      const response = await fetch('/api/markets/run-daily?stream=1', { method: 'POST' })

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, 'Failed daily run'))
      }

      if (!response.body) {
        throw new Error('Live run stream is not available in this browser')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let donePayload: DailyRunPayload | null = null

      const handleStreamEvent = (event: DailyRunStreamEvent): void => {
        if (event.type === 'start') {
          setRunProgress((prev) => prev ? {
            ...prev,
            runDate: event.runDate,
            modelOrder: event.modelOrder,
            orderedMarkets: event.orderedMarkets,
            openMarkets: event.openMarkets,
            totalActions: event.totalActions,
            currentActivity: `Discovered ${event.openMarkets} open markets (${event.totalActions} actions)`,
          } : prev)
          setExecutionPlan(buildExecutionPlan({
            events,
            runDate: event.runDate,
            modelOrder: event.modelOrder,
            orderedMarkets: event.orderedMarkets,
            fallbackStatuses: ['OPEN'],
          }))
          appendRunLog(`Found ${event.openMarkets} open markets (${event.totalActions} model actions)`)
          return
        }

        if (event.type === 'progress') {
          setRunProgress((prev) => {
            if (!prev) return prev

            const next = {
              ...prev,
              completedActions: event.completedActions,
              totalActions: event.totalActions,
              latestResult: event.result,
              currentActivity: `Completed ${MODEL_INFO[event.result.modelId].fullName}: ${event.result.action} (${statusLabel(event.result.status)})`,
            }

            if (event.result.status === 'ok') next.okCount += 1
            if (event.result.status === 'error') {
              next.errorCount += 1
              next.latestError = event.result
              appendErrorConsole(formatProgressLog(event.result))
            }
            if (event.result.status === 'skipped') next.skippedCount += 1

            return next
          })
          setExecutionPlan((prev) => applyProgressToExecutionPlan(prev, event.result))
          appendRunLog(formatProgressLog(event.result))
          return
        }

        if (event.type === 'activity') {
          setRunProgress((prev) => prev ? {
            ...prev,
            completedActions: event.completedActions,
            totalActions: event.totalActions,
            currentActivity: event.message,
          } : prev)
          setExecutionPlan((prev) => applyActivityToExecutionPlan(prev, {
            marketId: event.marketId,
            modelId: event.modelId,
            phase: event.phase,
            message: event.message,
          }))
          appendRunLog(event.message)
          return
        }

        if (event.type === 'done') {
          donePayload = event.payload
          setRunProgress((prev) => prev ? {
            ...prev,
            completedActions: event.payload.processedActions,
            totalActions: event.payload.totalActions,
            modelOrder: event.payload.modelOrder,
            orderedMarkets: event.payload.orderedMarkets,
            okCount: event.payload.summary.ok,
            errorCount: event.payload.summary.error,
            skippedCount: event.payload.summary.skipped,
            currentActivity: 'Daily market cycle completed',
          } : prev)
          setExecutionPlan((prev) => finalizeExecutionPlan(prev))
          setSummaryFromPayload(event.payload, startedAtMs)
          appendRunLog('Daily market cycle completed')
          return
        }

        throw new Error(event.message || 'Failed daily run')
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue

          let event: DailyRunStreamEvent
          try {
            event = JSON.parse(line) as DailyRunStreamEvent
          } catch {
            continue
          }

          handleStreamEvent(event)
        }
      }

      const trailingLine = buffer.trim()
      if (trailingLine) {
        const event = JSON.parse(trailingLine) as DailyRunStreamEvent
        handleStreamEvent(event)
      }

      if (!donePayload) {
        throw new Error('Daily run ended before completion status was received')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed daily run'
      setUiError(message)
      setRunProgress((prev) => prev ? {
        ...prev,
        currentActivity: `Daily market cycle failed: ${message}`,
      } : prev)
      setExecutionPlan((prev) => finalizeExecutionPlan(prev))
      appendErrorConsole(`RUN FAILED - ${message}`)

      if (message.toLowerCase().includes('already running')) {
        try {
          const response = await fetch('/api/admin/markets/run-state', { cache: 'no-store' })
          const payload = await response.json().catch(() => ({}))
          if (response.ok) {
            applyRunSnapshot(payload?.snapshot ?? null)
            keepPersistedRunningState = payload?.snapshot?.status === 'running'
          } else {
            setRunningDaily(false)
          }
        } catch {
          setRunningDaily(false)
        }
      }
    } finally {
      setIsStreamingRun(false)
      if (!keepPersistedRunningState) {
        setRunningDaily(false)
      }
    }
  }

  const progressPercent = runProgress && runProgress.totalActions > 0
    ? Math.min(100, Math.round((runProgress.completedActions / runProgress.totalActions) * 100))
    : 0
  const pendingActions = runProgress
    ? Math.max(0, (runProgress.totalActions || 0) - runProgress.completedActions)
    : 0
  const displayElapsedSeconds = runningDaily
    ? elapsedSeconds
    : (lastRunSummary?.durationSeconds ?? elapsedSeconds)
  const executionPlanStepCount = executionPlan.reduce((sum, market) => sum + market.steps.length, 0)
  const queuedExecutionSteps = executionPlan.reduce(
    (sum, market) => sum + market.steps.filter((step) => step.status === 'queued').length,
    0
  )
  const executionPlanHeading = runningDaily
    ? 'Execution Plan'
    : preserveExecutionPlan
      ? 'Latest Run Plan'
      : 'Next Run Plan'
  const currentExecutionMarket = currentExecutionStep
    ? executionPlan.find((market) => market.marketId === currentExecutionStep.marketId) ?? null
    : null

  return (
    <div className="space-y-6">
      {uiError && (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {uiError}
        </div>
      )}
      <div className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Daily Market Cycle</h3>
            <p className="text-xs text-[#8a8075] mt-1">Runs model actions for every OPEN market. Target schedule: 6:00 AM ET.</p>
          </div>
          <button
            onClick={runDailyCycle}
            disabled={runningDaily}
            className="px-4 py-2 rounded-none text-sm bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50"
          >
            {runningDaily
              ? (runProgress?.totalActions ? `Running... ${progressPercent}%` : 'Running...')
              : 'Run Daily Cycle Now'}
          </button>
        </div>
        {runProgress && (
          <div className="mt-3 rounded-none border border-[#e8ddd0] bg-white/70 p-3 space-y-3">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Run Overview</p>
              <p className="text-xs text-[#8a8075]">
                {runProgress.runDate
                  ? `Run ${new Date(runProgress.runDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })} UTC`
                  : 'Initializing run'} • {runProgress.openMarkets} open market{runProgress.openMarkets === 1 ? '' : 's'} • {runProgress.completedActions}/{runProgress.totalActions || '?'} actions • {displayElapsedSeconds}s elapsed
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="rounded-none border border-[#e8ddd0] bg-white px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Completed</p>
                <p className="text-sm font-semibold text-[#1a1a1a]">{runProgress.completedActions}</p>
              </div>
              <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/10 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#2f6f24]">Worked</p>
                <p className="text-sm font-semibold text-[#2f6f24]">{runProgress.okCount}</p>
              </div>
              <div className="rounded-none border border-[#c43a2b]/30 bg-[#c43a2b]/10 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8d2c22]">Failed</p>
                <p className="text-sm font-semibold text-[#8d2c22]">{runProgress.errorCount}</p>
              </div>
              <div className="rounded-none border border-[#b5aa9e]/40 bg-[#f5f2ed] px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Skipped</p>
                <p className="text-sm font-semibold text-[#6f665b]">{runProgress.skippedCount}</p>
              </div>
              <div className="rounded-none border border-[#e8ddd0] bg-white px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Remaining</p>
                <p className="text-sm font-semibold text-[#1a1a1a]">{pendingActions}</p>
              </div>
            </div>
            <div className="h-2 rounded-none bg-[#e8ddd0] overflow-hidden">
              <div
                className="h-full bg-[#1a1a1a] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {runProgress.currentActivity && (
                <div className="rounded-none border border-[#5BA5ED]/35 bg-[#5BA5ED]/10 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#265f8f]">Current Step</p>
                  <p className="mt-1 text-xs text-[#2e5a7a]">{runProgress.currentActivity}</p>
                </div>
              )}
              {runProgress.latestResult && (
                <div className="rounded-none border border-[#e8ddd0] bg-white px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Latest Result</p>
                  <p className="mt-1 text-xs text-[#5f564c]">
                    {statusLabel(runProgress.latestResult.status)}: {formatProgressLog(runProgress.latestResult)}
                  </p>
                </div>
              )}
            </div>
            {runProgress.errorCount > 0 && runProgress.latestError && (
              <div className="rounded-none border border-[#c43a2b]/35 bg-[#c43a2b]/10 px-2 py-1.5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d2c22]">Latest Failure</p>
                <p className="mt-1 text-xs text-[#8d2c22]">{formatProgressLog(runProgress.latestError)}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 rounded-none border border-[#e8ddd0] bg-white/70 p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">{executionPlanHeading}</p>
              <p className="text-xs text-[#8a8075]">
                {executionPlan.length} drug{executionPlan.length === 1 ? '' : 's'} • {executionPlanStepCount} model step{executionPlanStepCount === 1 ? '' : 's'}
                {!runningDaily && !preserveExecutionPlan && executionPlanStepCount > 0 ? ` • ${queuedExecutionSteps} queued for the next run` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['queued', 'waiting', 'running', 'ok', 'skipped', 'error'] as const).map((status) => {
                const tone = getExecutionStepTone(status)
                return (
                  <span
                    key={status}
                    className={`rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${tone.badge}`}
                  >
                    {getExecutionStatusLabel(status)}
                  </span>
                )
              })}
            </div>
          </div>

          {currentExecutionStep && currentExecutionMarket && (
            <div className="mt-3 rounded-none border border-[#2d7cf6]/35 bg-[#2d7cf6]/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#1f5cb9]">Now In Flight</p>
              <p className="mt-1 text-sm text-[#1f5cb9]">
                {MODEL_INFO[currentExecutionStep.modelId].fullName} on {currentExecutionMarket.drugName}
              </p>
              <p className="mt-1 text-xs text-[#265f8f]">
                Drug {currentExecutionMarket.marketSequence} of {executionPlan.length} • model {currentExecutionStep.modelSequence} of {currentExecutionMarket.steps.length}
              </p>
            </div>
          )}

          {!currentExecutionStep && !runningDaily && !preserveExecutionPlan && executionPlanStepCount > 0 && (
            <div className="mt-3 rounded-none border border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Queued Next</p>
              <p className="mt-1 text-sm text-[#5f564c]">
                {MODEL_INFO[executionPlan[0].steps[0].modelId].fullName} on {executionPlan[0].drugName}
              </p>
            </div>
          )}

          <div className="mt-3 space-y-3">
            {executionPlan.length > 0 ? executionPlan.map((market) => {
              const marketDoneCount = market.steps.filter((step) => step.status === 'ok' || step.status === 'skipped' || step.status === 'error').length

              return (
                <div key={market.marketId} className="rounded-none border border-[#e8ddd0] bg-white p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#1a1a1a]">
                        {market.marketSequence}. {market.drugName}
                      </p>
                      <p className="mt-1 text-xs text-[#8a8075]">
                        {market.companyName} • PDUFA {formatDate(market.pdufaDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">
                      {marketDoneCount}/{market.steps.length} step{market.steps.length === 1 ? '' : 's'} closed
                    </p>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {market.steps.map((step) => {
                      const tone = getExecutionStepTone(step.status)
                      const detail = step.detail
                        ? truncateText(step.detail, 120)
                        : `Run slot ${step.globalSequence} of ${executionPlanStepCount}`

                      return (
                        <div
                          key={step.key}
                          className={`rounded-none border px-3 py-2 ${tone.container}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Model {step.modelSequence}</p>
                              <p className="mt-1 text-sm font-medium text-[#1a1a1a]">
                                {MODEL_INFO[step.modelId].fullName}
                              </p>
                            </div>
                            <span className={`rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${tone.badge}`}>
                              {getExecutionStatusLabel(step.status)}
                            </span>
                          </div>
                          <p className={`mt-2 text-xs ${tone.label}`}>
                            {detail}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }) : (
              <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-3 text-sm text-[#8a8075]">
                No open markets are queued for the next daily cycle yet.
              </div>
            )}
          </div>
        </div>

        {(runLog.length > 0 || errorConsole.length > 0) && (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {runLog.length > 0 && (
              <div className="rounded-none border border-[#e8ddd0] bg-white/70 p-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">
                  {runningDaily ? 'Live Activity Feed' : 'Recent Activity Feed'}
                </p>
                <div className="reasoning-scrollbox mt-2 max-h-44 overflow-y-auto space-y-1">
                  {runLog.map((line, index) => (
                    <p key={`${line}-${index}`} className="text-xs text-[#6f665b]">{line}</p>
                  ))}
                </div>
              </div>
            )}

            {errorConsole.length > 0 && (
              <div className="rounded-none border border-[#c43a2b]/40 bg-[#2a1311] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#f5b5ae]">
                    {runningDaily ? 'Error Feed (Live)' : 'Error Feed (Last Run)'}
                  </p>
                  <p className="text-[11px] text-[#f5b5ae]/80">
                    {errorConsole.length} issue{errorConsole.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="reasoning-scrollbox mt-2 max-h-44 overflow-y-auto space-y-1">
                  {errorConsole.map((entry) => (
                    <p key={entry.id} className="text-xs text-[#ffd1cb]">
                      {entry.utcTime} UTC {entry.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {lastRunSummary && (
          <div className={`mt-3 rounded-none border px-3 py-3 ${lastRunSummary.error > 0 ? 'border-[#c43a2b]/35 bg-[#c43a2b]/10' : 'border-[#e8ddd0] bg-white/70'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-[11px] uppercase tracking-[0.08em] ${lastRunSummary.error > 0 ? 'text-[#8d2c22]' : 'text-[#8a8075]'}`}>
                Run Recap
              </p>
              <p className={`text-xs ${lastRunSummary.error > 0 ? 'text-[#8d2c22]' : 'text-[#8a8075]'}`}>
                {lastRunSummary.runDateLabel} UTC
              </p>
            </div>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="rounded-none border border-[#e8ddd0] bg-white/70 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Duration</p>
                <p className="text-xs font-medium text-[#1a1a1a]">{lastRunSummary.durationSeconds}s</p>
              </div>
              <div className="rounded-none border border-[#e8ddd0] bg-white/70 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Open Markets</p>
                <p className="text-xs font-medium text-[#1a1a1a]">{lastRunSummary.openMarkets}</p>
              </div>
              <div className="rounded-none border border-[#e8ddd0] bg-white/70 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Total Non-OK Models</p>
                <p className="text-xs font-medium text-[#1a1a1a]">{lastRunSummary.nonOkModels.length}</p>
              </div>
            </div>
            {lastRunSummary.nonOkModels.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d2c22]">Model Issues</p>
                <div className="flex flex-wrap gap-1.5">
                  {lastRunSummary.nonOkModels.map((entry, index) => (
                    (() => {
                      const normalized = entry.toLowerCase()
                      const isSkipped = normalized.includes('skipped')
                      const chipClass = isSkipped
                        ? 'rounded-none border border-[#b5aa9e]/40 bg-[#f5f2ed] px-2 py-0.5 text-xs text-[#6f665b]'
                        : 'rounded-none border border-[#c43a2b]/30 bg-[#fff3f1] px-2 py-0.5 text-xs text-[#8d2c22]'

                      return (
                        <span key={`${entry}-${index}`} className={chipClass}>
                          {entry}
                        </span>
                      )
                    })()
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
        <input
          type="text"
          placeholder="Search drug, company, ticker"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-[#e8ddd0] bg-white/90 px-3 py-2 text-sm placeholder-[#b5aa9e] focus:border-[#8a8075] focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((event) => {
          const statusTone = event.marketStatus === 'OPEN'
            ? 'text-[#3a8a2e] bg-[#3a8a2e]/10'
            : event.marketStatus === 'RESOLVED'
              ? 'text-[#b5aa9e] bg-[#b5aa9e]/15'
              : 'text-[#8a8075] bg-[#e8ddd0]/40'

          return (
            <div key={event.id} className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#1a1a1a]">{event.drugName}</div>
                  <div className="text-xs text-[#8a8075] mt-1">
                    {event.companyName} {event.symbols ? `(${event.symbols})` : ''} • PDUFA {formatDate(event.pdufaDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-none ${statusTone}`}>
                    {event.marketStatus || 'NO MARKET'}
                  </span>
                  {event.marketPriceYes !== null && (
                    <span className="text-xs text-[#8a8075]">
                      YES {(event.marketPriceYes * 100).toFixed(1)}%
                    </span>
                  )}
                  <button
                    onClick={() => openMarket(event.id)}
                    disabled={loadingEventId === event.id || event.marketStatus !== null || event.outcome !== 'Pending'}
                    className="px-3 py-1.5 rounded-none text-xs bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50"
                  >
                    {loadingEventId === event.id ? 'Opening...' : 'Open Market'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a] mb-2">Model Starting Bankroll</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {MODEL_IDS.map((modelId) => (
            <div key={modelId} className="flex items-center justify-between border border-[#e8ddd0] rounded-none p-2 bg-white/70">
              <span className="text-[#8a8075]">{MODEL_INFO[modelId].fullName}</span>
              <span className="font-medium text-[#1a1a1a]">{formatMoney(100000)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
