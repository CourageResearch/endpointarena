'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDate, getDaysUntil, MODEL_INFO } from '@/lib/constants'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import {
  applyActivityToExecutionPlan,
  applyProgressToExecutionPlan,
  buildErrorConsoleFromSnapshot,
  buildExecutionPlan,
  buildExecutionPlanFromSnapshot,
  buildNextExecutionPlan,
  buildRunLogFromSnapshot,
  buildRunProgressFromSnapshot,
  buildRunSummaryFromSnapshot,
  finalizeExecutionPlan,
  formatProgressLog,
  formatUtcLogPrefix,
  getCurrentExecutionStep,
  getExecutionStatusLabel,
  getExecutionStepTone,
  getMarketStatusTone,
  getOutcomeStyle,
  isAdminStoppedMessage,
  rotateModelOrderLocal,
  statusLabel,
  summarizeCounts,
  summarizeNonOkModels,
  truncateText,
  type AdminMarketEvent,
  type DailyRunProgressState,
  type ErrorConsoleEntry,
  type ExecutionPlanMarket,
  type LastRunSummaryState,
} from '@/components/admin/market-manager-utils'
import type {
  DailyRunPayload,
  DailyRunStreamEvent,
} from '@/lib/markets/types'
import type { AdminMarketRunSnapshot } from '@/lib/market-run-logs'

interface Props {
  events: AdminMarketEvent[]
  initialRunSnapshot: AdminMarketRunSnapshot | null
}

export function AdminMarketManager({ events: initialEvents, initialRunSnapshot }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [search, setSearch] = useState('')
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null)
  const [updatingOutcome, setUpdatingOutcome] = useState<Record<string, boolean>>({})
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
  const [isStoppingDaily, setIsStoppingDaily] = useState(initialRunSnapshot?.status === 'running' && isAdminStoppedMessage(initialRunSnapshot?.failureReason))
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
      setIsStoppingDaily(false)
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
      setIsStoppingDaily(isAdminStoppedMessage(snapshot.failureReason))
      setLastRunSummary(null)
      return
    }

    setRunningDaily(false)
    setIsStoppingDaily(false)
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

  const openEvents = useMemo(
    () => filtered.filter((event) => event.marketStatus === 'OPEN'),
    [filtered],
  )

  const adjudicationEvents = useMemo(
    () => filtered.filter((event) => event.marketStatus !== null && event.marketStatus !== 'OPEN'),
    [filtered],
  )

  const needsMarketEvents = useMemo(
    () => filtered.filter((event) => event.marketStatus === null && event.outcome === 'Pending'),
    [filtered],
  )

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

  const updateOutcome = async (eventId: string, outcome: string) => {
    setUiError(null)
    setUpdatingOutcome((prev) => ({ ...prev, [eventId]: true }))

    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiErrorMessage(data, 'Failed to update outcome'))

      setEvents((prev) => prev.map((event) => (
        event.id === eventId
          ? {
              ...event,
              outcome,
              marketStatus: event.marketId
                ? (outcome === 'Pending' ? 'OPEN' : 'RESOLVED')
                : event.marketStatus,
            }
          : event
      )))
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to update outcome')
    } finally {
      setUpdatingOutcome((prev) => ({ ...prev, [eventId]: false }))
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

  const pauseDailyCycle = async () => {
    if (isStoppingDaily) return

    setIsStoppingDaily(true)
    setUiError(null)
    setRunProgress((prev) => prev ? {
      ...prev,
      currentActivity: 'Stop requested by admin. Waiting for the current model step to finish.',
    } : prev)
    appendRunLog('Stop requested by admin; waiting for the current model step to finish')

    try {
      const response = await fetch('/api/admin/markets/cancel-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to stop daily market cycle'))
      }
    } catch (error) {
      setIsStoppingDaily(false)
      setUiError(error instanceof Error ? error.message : 'Failed to stop daily market cycle')
    }
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
    const controller = new AbortController()

    setUiError(null)
    setIsStoppingDaily(false)
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
      const response = await fetch('/api/markets/run-daily?stream=1', {
        method: 'POST',
        signal: controller.signal,
      })

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
      let cancelledMessage: string | null = null

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
          setIsStoppingDaily(false)
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

        if (event.type === 'cancelled') {
          cancelledMessage = event.message
          setIsStoppingDaily(false)
          setRunProgress((prev) => prev ? {
            ...prev,
            currentActivity: event.message,
          } : prev)
          setExecutionPlan((prev) => finalizeExecutionPlan(prev))
          appendRunLog(event.message)
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

      if (cancelledMessage) {
        try {
          const response = await fetch('/api/admin/markets/run-state', { cache: 'no-store' })
          const payload = await response.json().catch(() => ({}))
          if (response.ok) {
            applyRunSnapshot(payload?.snapshot ?? null)
          }
        } catch {
          // Preserve local stopped state if the snapshot refresh fails.
        }
        return
      }

      if (!donePayload) {
        throw new Error('Daily run ended before completion status was received')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        try {
          const response = await fetch('/api/admin/markets/run-state', { cache: 'no-store' })
          const payload = await response.json().catch(() => ({}))
          if (response.ok) {
            applyRunSnapshot(payload?.snapshot ?? null)
            keepPersistedRunningState = payload?.snapshot?.status === 'running'
          } else {
            setIsStoppingDaily(false)
            setRunningDaily(false)
          }
        } catch {
          setIsStoppingDaily(false)
          setRunningDaily(false)
        }
        return
      }

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
            setIsStoppingDaily(false)
            setRunningDaily(false)
          }
        } catch {
          setIsStoppingDaily(false)
          setRunningDaily(false)
        }
      }
    } finally {
      setIsStreamingRun(false)
      if (!keepPersistedRunningState) {
        setIsStoppingDaily(false)
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runDailyCycle}
              disabled={runningDaily}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#6f665b] transition-colors hover:bg-[#f5eee5] hover:text-[#3b342c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runningDaily
                ? (runProgress?.totalActions ? `Running... ${progressPercent}%` : 'Running...')
                : 'Run Daily Cycle Now'}
            </button>
            {runningDaily ? (
                <button
                  type="button"
                  onClick={pauseDailyCycle}
                  disabled={isStoppingDaily}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                >
                  {isStoppingDaily ? 'Stopping...' : 'Pause'}
                </button>
              ) : null}
          </div>
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

      <div className="space-y-5">
        <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#1a1a1a]">Open Markets</h3>
              <p className="mt-1 text-xs text-[#8a8075]">Markets that are currently live.</p>
            </div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">{openEvents.length} shown</p>
          </div>

          <div className="mt-3 space-y-3">
            {openEvents.length === 0 ? (
              <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
                No open markets match the current filter.
              </div>
            ) : openEvents.map((event) => {
              const statusTone = getMarketStatusTone(event.marketStatus)
              const days = getDaysUntil(event.pdufaDate)

              return (
                <div key={event.id} className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#1a1a1a]">{event.drugName}</div>
                      <div className="mt-1 text-xs text-[#8a8075]">
                        {event.companyName} {event.symbols ? `(${event.symbols})` : ''} • PDUFA {formatDate(event.pdufaDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className={`rounded-none px-2 py-1 text-xs ${statusTone}`}>
                        {event.marketStatus || 'NO MARKET'}
                      </span>
                      {event.marketPriceYes !== null ? (
                        <span className="text-xs text-[#8a8075]">
                          YES {(event.marketPriceYes * 100).toFixed(1)}%
                        </span>
                      ) : null}

                      <div className="min-w-[56px] text-left sm:text-right">
                        <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                          {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
                        </div>
                        <div className="text-xs text-[#b5aa9e]">{formatDate(event.pdufaDate)}</div>
                      </div>

                      <select
                        value={event.outcome}
                        onChange={(input) => updateOutcome(event.id, input.target.value)}
                        disabled={updatingOutcome[event.id]}
                        className={`max-w-full cursor-pointer rounded-none border-0 px-3 py-1.5 text-sm font-medium ${getOutcomeStyle(event.outcome)} ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
                      >
                        <option value="Pending" className="bg-white text-[#D39D2E]">Pending</option>
                        <option value="Approved" className="bg-white text-[#3a8a2e]">Approved</option>
                        <option value="Rejected" className="bg-white text-[#EF6F67]">Rejected</option>
                      </select>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {needsMarketEvents.length > 0 ? (
          <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#1a1a1a]">Needs Market</h3>
                <p className="mt-1 text-xs text-[#8a8075]">Pending FDA events that still need a market opened.</p>
              </div>
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">{needsMarketEvents.length} shown</p>
            </div>

            <div className="mt-3 space-y-3">
              {needsMarketEvents.map((event) => {
                const isOpening = loadingEventId === event.id

                return (
                  <div key={`needs-market-${event.id}`} className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
                    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#1a1a1a]">{event.drugName}</div>
                        <div className="mt-1 text-xs text-[#8a8075]">
                          {event.companyName} {event.symbols ? `(${event.symbols})` : ''} • PDUFA {formatDate(event.pdufaDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-none px-2 py-1 text-xs text-[#8a8075] bg-[#e8ddd0]/40">
                          NO MARKET
                        </span>
                        <button
                          onClick={() => openMarket(event.id)}
                          disabled={isOpening}
                          className="whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isOpening ? 'Opening...' : 'Open Market'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#1a1a1a]">Resolved Markets</h3>
              <p className="mt-1 text-xs text-[#8a8075]">Markets that have already been resolved.</p>
            </div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">{adjudicationEvents.length} shown</p>
          </div>

          <div className="mt-3 space-y-3">
            {adjudicationEvents.length === 0 ? (
              <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
                No resolved markets match the current filter.
              </div>
            ) : adjudicationEvents.map((event) => {
              const days = getDaysUntil(event.pdufaDate)
              const statusTone = getMarketStatusTone(event.marketStatus)

              return (
                <div key={`adjudication-${event.id}`} className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-[#1a1a1a]">{event.drugName}</div>
                        <span className={`rounded-none px-2 py-1 text-xs ${statusTone}`}>
                          {event.marketStatus}
                        </span>
                        {event.marketPriceYes !== null ? (
                          <span className="text-xs text-[#8a8075]">YES {(event.marketPriceYes * 100).toFixed(1)}%</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-[#8a8075]">
                        {event.companyName} {event.symbols ? `(${event.symbols})` : ''} • PDUFA {formatDate(event.pdufaDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <div className="min-w-[56px] text-left sm:text-right">
                        <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                          {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
                        </div>
                        <div className="text-xs text-[#b5aa9e]">{formatDate(event.pdufaDate)}</div>
                      </div>

                      <select
                        value={event.outcome}
                        onChange={(input) => updateOutcome(event.id, input.target.value)}
                        disabled={updatingOutcome[event.id]}
                        className={`max-w-full cursor-pointer rounded-none border-0 px-3 py-1.5 text-sm font-medium ${getOutcomeStyle(event.outcome)} ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
                      >
                        <option value="Pending" className="bg-white text-[#D39D2E]">Pending</option>
                        <option value="Approved" className="bg-white text-[#3a8a2e]">Approved</option>
                        <option value="Rejected" className="bg-white text-[#EF6F67]">Rejected</option>
                      </select>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

    </div>
  )
}
