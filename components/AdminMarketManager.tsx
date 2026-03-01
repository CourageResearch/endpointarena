'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDate, MODEL_INFO, type ModelId } from '@/lib/constants'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import type { DailyRunPayload, DailyRunResult, DailyRunStatus, DailyRunSummary, DailyRunStreamEvent } from '@/lib/markets/types'

interface AdminMarketEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string
  pdufaDate: string
  outcome: string
  marketStatus: 'OPEN' | 'RESOLVED' | null
  marketPriceYes: number | null
}

interface Props {
  events: AdminMarketEvent[]
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
  openMarkets: number
  totalActions: number
  completedActions: number
  okCount: number
  errorCount: number
  skippedCount: number
  latestResult: DailyRunResult | null
  latestError: DailyRunResult | null
}

interface ErrorConsoleEntry {
  id: string
  utcTime: string
  message: string
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

export function AdminMarketManager({ events: initialEvents }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [search, setSearch] = useState('')
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null)
  const [runningDaily, setRunningDaily] = useState(false)
  const [lastRunSummary, setLastRunSummary] = useState<LastRunSummaryState | null>(null)
  const [runProgress, setRunProgress] = useState<DailyRunProgressState | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [runLog, setRunLog] = useState<string[]>([])
  const [errorConsole, setErrorConsole] = useState<ErrorConsoleEntry[]>([])
  const [uiError, setUiError] = useState<string | null>(null)

  const runStartedAtMs = runProgress?.startedAtMs ?? null

  useEffect(() => {
    if (!runningDaily || runStartedAtMs === null) return

    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)))
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [runningDaily, runStartedAtMs])

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
              marketStatus: data.market.status,
              marketPriceYes: data.market.priceYes,
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

    setUiError(null)
    setRunningDaily(true)
    setLastRunSummary(null)
    setElapsedSeconds(0)
    setRunLog([`${formatUtcLogPrefix(new Date(startedAtMs))} UTC  Starting daily market cycle...`])
    setErrorConsole([])
    setRunProgress({
      startedAtMs,
      runDate: null,
      openMarkets: 0,
      totalActions: 0,
      completedActions: 0,
      okCount: 0,
      errorCount: 0,
      skippedCount: 0,
      latestResult: null,
      latestError: null,
    })

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
            openMarkets: event.openMarkets,
            totalActions: event.totalActions,
          } : prev)
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
          appendRunLog(formatProgressLog(event.result))
          return
        }

        if (event.type === 'done') {
          donePayload = event.payload
          setRunProgress((prev) => prev ? {
            ...prev,
            completedActions: event.payload.processedActions,
            totalActions: event.payload.totalActions,
            okCount: event.payload.summary.ok,
            errorCount: event.payload.summary.error,
            skippedCount: event.payload.summary.skipped,
          } : prev)
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
      appendErrorConsole(`RUN FAILED - ${message}`)
    } finally {
      setRunningDaily(false)
      setRunProgress(null)
    }
  }

  const progressPercent = runProgress && runProgress.totalActions > 0
    ? Math.min(100, Math.round((runProgress.completedActions / runProgress.totalActions) * 100))
    : 0
  const pendingActions = runProgress
    ? Math.max(0, (runProgress.totalActions || 0) - runProgress.completedActions)
    : 0

  return (
    <div className="space-y-6">
      {uiError && (
        <div className="rounded-lg border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {uiError}
        </div>
      )}
      <div className="bg-white/80 border border-[#e8ddd0] rounded-lg p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Daily Market Cycle</h3>
            <p className="text-xs text-[#8a8075] mt-1">Runs model actions for every OPEN market. Target schedule: 6:00 AM ET.</p>
          </div>
          <button
            onClick={runDailyCycle}
            disabled={runningDaily}
            className="px-4 py-2 rounded-lg text-sm bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50"
          >
            {runningDaily
              ? (runProgress?.totalActions ? `Running... ${progressPercent}%` : 'Running...')
              : 'Run Daily Cycle Now'}
          </button>
        </div>
        {runningDaily && runProgress && (
          <div className="mt-3 rounded-lg border border-[#e8ddd0] bg-white/70 p-3 space-y-2">
            <p className="text-xs text-[#8a8075]">
              {runProgress.runDate
                ? `Run ${new Date(runProgress.runDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })} UTC`
                : 'Initializing run'} • {runProgress.completedActions}/{runProgress.totalActions || '?'} actions • {elapsedSeconds}s elapsed
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="rounded border border-[#e8ddd0] bg-white px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Completed</p>
                <p className="text-sm font-semibold text-[#1a1a1a]">{runProgress.completedActions}</p>
              </div>
              <div className="rounded border border-[#3a8a2e]/30 bg-[#3a8a2e]/10 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#2f6f24]">Worked</p>
                <p className="text-sm font-semibold text-[#2f6f24]">{runProgress.okCount}</p>
              </div>
              <div className="rounded border border-[#c43a2b]/30 bg-[#c43a2b]/10 px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8d2c22]">Failed</p>
                <p className="text-sm font-semibold text-[#8d2c22]">{runProgress.errorCount}</p>
              </div>
              <div className="rounded border border-[#b5aa9e]/40 bg-[#f5f2ed] px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Skipped</p>
                <p className="text-sm font-semibold text-[#6f665b]">{runProgress.skippedCount}</p>
              </div>
              <div className="rounded border border-[#e8ddd0] bg-white px-2 py-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Remaining</p>
                <p className="text-sm font-semibold text-[#1a1a1a]">{pendingActions}</p>
              </div>
            </div>
            <div className="h-2 rounded bg-[#e8ddd0] overflow-hidden">
              <div
                className="h-full bg-[#1a1a1a] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {runProgress.latestResult && (
              <p className="text-xs text-[#5f564c]">
                Latest ({statusLabel(runProgress.latestResult.status)}): {formatProgressLog(runProgress.latestResult)}
              </p>
            )}
            {runProgress.errorCount > 0 && runProgress.latestError && (
              <div className="rounded border border-[#c43a2b]/35 bg-[#c43a2b]/10 px-2 py-1.5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d2c22]">Latest Failure</p>
                <p className="mt-1 text-xs text-[#8d2c22]">{formatProgressLog(runProgress.latestError)}</p>
              </div>
            )}
          </div>
        )}
        {runLog.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#e8ddd0] bg-white/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">
              {runningDaily ? 'Live Activity' : 'Recent Activity'}
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {runLog.map((line, index) => (
                <p key={`${line}-${index}`} className="text-xs text-[#6f665b]">{line}</p>
              ))}
            </div>
          </div>
        )}
        {lastRunSummary && (
          <div className={`mt-3 rounded-lg border px-3 py-2 ${lastRunSummary.error > 0 ? 'border-[#c43a2b]/35 bg-[#c43a2b]/10' : 'border-[#e8ddd0] bg-white/70'}`}>
            <p className={`text-xs ${lastRunSummary.error > 0 ? 'text-[#8d2c22]' : 'text-[#8a8075]'}`}>
              Run {lastRunSummary.runDateLabel} UTC ({lastRunSummary.durationSeconds}s) •
              {' '}Worked {lastRunSummary.ok} •
              {' '}Failed {lastRunSummary.error} •
              {' '}Skipped {lastRunSummary.skipped} •
              {' '}Open Markets {lastRunSummary.openMarkets}
            </p>
            {lastRunSummary.nonOkModels.length > 0 && (
              <p className="mt-1 text-xs text-[#8d2c22]">
                Issues: {lastRunSummary.nonOkModels.join(', ')}
              </p>
            )}
          </div>
        )}

        {errorConsole.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#c43a2b]/40 bg-[#2a1311] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#f5b5ae]">
                {runningDaily ? 'Error Console (Live)' : 'Error Console (Last Run)'}
              </p>
              <p className="text-[11px] text-[#f5b5ae]/80">
                {errorConsole.length} issue{errorConsole.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="mt-2 max-h-44 overflow-y-auto space-y-1">
              {errorConsole.map((entry) => (
                <p key={entry.id} className="text-xs text-[#ffd1cb]">
                  {entry.utcTime} UTC {entry.message}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white/80 border border-[#e8ddd0] rounded-lg p-4">
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
            <div key={event.id} className="bg-white/80 border border-[#e8ddd0] rounded-lg p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#1a1a1a]">{event.drugName}</div>
                  <div className="text-xs text-[#8a8075] mt-1">
                    {event.companyName} {event.symbols ? `(${event.symbols})` : ''} • PDUFA {formatDate(event.pdufaDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${statusTone}`}>
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
                    className="px-3 py-1.5 rounded text-xs bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50"
                  >
                    {loadingEventId === event.id ? 'Opening...' : 'Open Market'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white/80 border border-[#e8ddd0] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a] mb-2">Model Starting Bankroll</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {(['claude-opus', 'gpt-5.2', 'grok-4', 'gemini-2.5'] as ModelId[]).map((modelId) => (
            <div key={modelId} className="flex items-center justify-between border border-[#e8ddd0] rounded p-2 bg-white/70">
              <span className="text-[#8a8075]">{MODEL_INFO[modelId].fullName}</span>
              <span className="font-medium text-[#1a1a1a]">{formatMoney(100000)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
