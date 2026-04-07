'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getDaysUntil, MODEL_INFO, type ModelId } from '@/lib/constants'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import { formatUtcDate } from '@/lib/date'
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
  getExecutionStepDurationLabel,
  getExecutionStatusLabel,
  getExecutionStepTone,
  getTrialStatusTone,
  getOutcomeStyle,
  isAdminStoppedMessage,
  rotateModelOrderLocal,
  statusLabel,
  summarizeCounts,
  summarizeNonOkModels,
  truncateText,
  type AdminTrialEvent,
  type AdminTrialRunSnapshot,
  type DailyRunProgressState,
  type ErrorConsoleEntry,
  type ExecutionPlanTrial,
  type LastRunSummaryState,
} from '@/components/admin/trial-manager-utils'
import type {
  DailyRunPayload,
  DailyRunStreamEvent,
} from '@/lib/markets/types'
import {
  getDailyRunAutomationModelLabel,
  getDailyRunAutomationSourceLabel,
  type DailyRunAutomationPreview,
  type DailyRunAutomationSource,
} from '@/lib/markets/automation-handoff-shared'

interface Props {
  events: AdminTrialEvent[]
  initialRunSnapshot?: AdminTrialRunSnapshot | null
  sections?: AdminTrialManagerSection[]
  labels?: Partial<AdminTrialManagerLabels>
}

interface AdminTrialManagerLabels {
  searchPlaceholder: string
  openMarketsTitle: string
  openMarketsDescription: string
  openMarketsEmptyState: string
  needsMarketTitle: string
  needsMarketDescription: string
  resolvedMarketsTitle: string
  resolvedMarketsDescription: string
  resolvedMarketsEmptyState: string
}

export type AdminTrialManagerSection =
  | 'dailyCycle'
  | 'search'
  | 'openMarkets'
  | 'needsMarket'
  | 'resolvedMarkets'

const DEFAULT_SECTIONS: AdminTrialManagerSection[] = [
  'dailyCycle',
  'search',
  'openMarkets',
  'needsMarket',
  'resolvedMarkets',
]

const DEFAULT_LABELS: AdminTrialManagerLabels = {
  searchPlaceholder: 'Search trial, sponsor, ticker, endpoint',
  openMarketsTitle: 'Open Trials',
  openMarketsDescription: 'Trials that are currently live.',
  openMarketsEmptyState: 'No open trials match the current filter.',
  needsMarketTitle: 'Trials Not Yet Open',
  needsMarketDescription: 'Live Phase 2 questions that still need to be opened for trading.',
  resolvedMarketsTitle: 'Resolved Trials',
  resolvedMarketsDescription: 'Trials that have already been resolved.',
  resolvedMarketsEmptyState: 'No resolved trials match the current filter.',
}

type RunDailyCycleOptions = {
  nctNumber?: string
  modelIds?: ModelId[]
}

type AutomationExportState = {
  filePath: string
  exportsDir: string
  decisionsDir: string
  archiveDir: string
  taskCount: number
  modelLabel: string
}

type AutomationApplyState = {
  archivePath: string
  readyCount: number
  duplicateCount: number
}

const DEFAULT_AUTOMATION_SOURCE: DailyRunAutomationSource = 'claude-code-subscription'

function normalizeScopedNctNumberInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function parseScopedNctNumber(value: string): string | null {
  const normalized = normalizeScopedNctNumberInput(value)
  return /^NCT\d{8}$/.test(normalized) ? normalized : null
}

function formatUsdEstimate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0'
  }

  const maximumFractionDigits = value >= 1
    ? 2
    : value >= 0.1
      ? 3
      : value >= 0.01
        ? 4
        : 5

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

function filterEventsForRun(events: AdminTrialEvent[], nctNumber?: string): AdminTrialEvent[] {
  if (!nctNumber) {
    return events
  }

  return events.filter((event) => event.nctNumber.trim().toUpperCase() === nctNumber)
}

export function AdminTrialManager({
  events: initialEvents,
  initialRunSnapshot = null,
  sections = DEFAULT_SECTIONS,
  labels,
}: Props) {
  const router = useRouter()
  const [events, setEvents] = useState(initialEvents)
  const [search, setSearch] = useState('')
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [updatingOutcome, setUpdatingOutcome] = useState<Record<string, boolean>>({})
  const [runningDaily, setRunningDaily] = useState(initialRunSnapshot?.status === 'running')
  const [lastRunSummary, setLastRunSummary] = useState<LastRunSummaryState | null>(() => buildRunSummaryFromSnapshot(initialRunSnapshot))
  const [runProgress, setRunProgress] = useState<DailyRunProgressState | null>(() => buildRunProgressFromSnapshot(initialRunSnapshot))
  const [elapsedSeconds, setElapsedSeconds] = useState(() => buildRunSummaryFromSnapshot(initialRunSnapshot)?.durationSeconds ?? 0)
  const [runLog, setRunLog] = useState<string[]>(() => buildRunLogFromSnapshot(initialRunSnapshot))
  const [errorConsole, setErrorConsole] = useState<ErrorConsoleEntry[]>(() => buildErrorConsoleFromSnapshot(initialRunSnapshot))
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlanTrial[]>(() => (
    initialRunSnapshot
      ? buildExecutionPlanFromSnapshot(initialEvents, initialRunSnapshot)
      : buildNextExecutionPlan(initialEvents)
  ))
  const [preserveExecutionPlan, setPreserveExecutionPlan] = useState(Boolean(initialRunSnapshot))
  const [uiError, setUiError] = useState<string | null>(null)
  const [isStoppingDaily, setIsStoppingDaily] = useState(initialRunSnapshot?.status === 'running' && isAdminStoppedMessage(initialRunSnapshot?.failureReason))
  const [isStreamingRun, setIsStreamingRun] = useState(false)
  const [scopedClaudeNctInput, setScopedClaudeNctInput] = useState('')
  const [executionStepNowMs, setExecutionStepNowMs] = useState<number | null>(null)
  const [automationSource, setAutomationSource] = useState<DailyRunAutomationSource>(DEFAULT_AUTOMATION_SOURCE)
  const [isExportingAutomation, setIsExportingAutomation] = useState(false)
  const [automationExportState, setAutomationExportState] = useState<AutomationExportState | null>(null)
  const [automationDecisionFile, setAutomationDecisionFile] = useState<File | null>(null)
  const [automationDecisionText, setAutomationDecisionText] = useState('')
  const [automationPreview, setAutomationPreview] = useState<DailyRunAutomationPreview | null>(null)
  const [isPreviewingAutomation, setIsPreviewingAutomation] = useState(false)
  const [isApplyingAutomation, setIsApplyingAutomation] = useState(false)
  const [automationApplyState, setAutomationApplyState] = useState<AutomationApplyState | null>(null)

  const runStartedAtMs = runProgress?.startedAtMs ?? null
  const currentExecutionStep = useMemo(() => getCurrentExecutionStep(executionPlan), [executionPlan])
  const scopedClaudeNctNumber = useMemo(() => parseScopedNctNumber(scopedClaudeNctInput), [scopedClaudeNctInput])
  const scopedClaudeEvents = useMemo(() => (
    scopedClaudeNctNumber ? filterEventsForRun(events, scopedClaudeNctNumber) : []
  ), [events, scopedClaudeNctNumber])
  const scopedClaudeOpenMarketCount = useMemo(() => (
    scopedClaudeEvents.filter((event) => event.marketStatus === 'OPEN' && event.marketId).length
  ), [scopedClaudeEvents])
  const automationSourceLabel = useMemo(() => getDailyRunAutomationSourceLabel(automationSource), [automationSource])
  const automationModelLabel = useMemo(() => getDailyRunAutomationModelLabel(automationSource), [automationSource])
  const enabledSections = new Set(sections)
  const showDailyCycle = enabledSections.has('dailyCycle')
  const showSearch = enabledSections.has('search')
  const showOpenMarkets = enabledSections.has('openMarkets')
  const showNeedsMarket = enabledSections.has('needsMarket')
  const showResolvedMarkets = enabledSections.has('resolvedMarkets')
  const sectionLabels = { ...DEFAULT_LABELS, ...labels }

  const navigateToMarket = (marketId: string | null) => {
    if (!marketId) return
    router.push(`/trials/${marketId}`)
  }

  const handleMarketRowKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    marketId: string | null
  ) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToMarket(marketId)
  }

  useEffect(() => {
    if (!runningDaily || runStartedAtMs === null) return

    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)))
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [runningDaily, runStartedAtMs])

  useEffect(() => {
    if (!currentExecutionStep || (currentExecutionStep.status !== 'running' && currentExecutionStep.status !== 'waiting')) {
      setExecutionStepNowMs(null)
      return
    }

    setExecutionStepNowMs(Date.now())
    const timer = window.setInterval(() => {
      setExecutionStepNowMs(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [currentExecutionStep?.key, currentExecutionStep?.status])

  const applyRunSnapshot = (snapshot: AdminTrialRunSnapshot | null) => {
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
    setExecutionPlan(buildExecutionPlanFromSnapshot(events, snapshot))

    if (snapshot.status === 'running') {
      setPreserveExecutionPlan(true)
      setRunningDaily(true)
      setIsStoppingDaily(isAdminStoppedMessage(snapshot.failureReason))
      setLastRunSummary(null)
      return
    }

    setRunningDaily(false)
    setPreserveExecutionPlan(true)
    setIsStoppingDaily(false)
    setLastRunSummary(nextSummary)
    setElapsedSeconds(nextSummary?.durationSeconds ?? 0)
  }

  useEffect(() => {
    if (runningDaily || preserveExecutionPlan) return
    setExecutionPlan(buildNextExecutionPlan(events))
  }, [events, preserveExecutionPlan, runningDaily])

  useEffect(() => {
    if (!showDailyCycle || !runningDaily || isStreamingRun) return

    let cancelled = false

    const pollState = async () => {
      try {
      const response = await fetch('/api/admin/trials/run-state', { cache: 'no-store' })
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
  }, [isStreamingRun, runningDaily, showDailyCycle])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter((event) =>
      event.shortTitle.toLowerCase().includes(q) ||
      event.sponsorName.toLowerCase().includes(q) ||
      event.sponsorTicker.toLowerCase().includes(q) ||
      event.questionPrompt.toLowerCase().includes(q)
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

  const openMarket = async (trialQuestionId: string) => {
    setUiError(null)
    setLoadingEventId(trialQuestionId)
    try {
      const response = await fetch('/api/trials/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trialQuestionId }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiErrorMessage(data, 'Failed to open trial'))

      setEvents((prev) => prev.map((event) => (
        event.id === trialQuestionId
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
      setUiError(error instanceof Error ? error.message : 'Failed to open trial')
    } finally {
      setLoadingEventId(null)
    }
  }

  const updateOutcome = async (trialQuestionId: string, outcome: string) => {
    setUiError(null)
    setUpdatingOutcome((prev) => ({ ...prev, [trialQuestionId]: true }))

    try {
      const response = await fetch(`/api/trial-questions/${trialQuestionId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiErrorMessage(data, 'Failed to update outcome'))

      setEvents((prev) => prev.map((event) => (
        event.id === trialQuestionId
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
      setUpdatingOutcome((prev) => ({ ...prev, [trialQuestionId]: false }))
    }
  }

  const deleteDrug = async (trialQuestionId: string, shortTitle: string) => {
    const confirmed = window.confirm(`Delete "${shortTitle}" from admin? This removes the drug/question and any linked market data.`)
    if (!confirmed) return

    setUiError(null)
    setDeletingEventId(trialQuestionId)

    try {
      const response = await fetch(`/api/admin/trial-questions/${trialQuestionId}`, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiErrorMessage(data, 'Failed to delete drug'))

      setEvents((prev) => prev.filter((event) => event.id !== trialQuestionId))
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to delete drug')
    } finally {
      setDeletingEventId(null)
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
      const response = await fetch('/api/admin/trials/cancel-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to stop daily trial cycle'))
      }
    } catch (error) {
      setIsStoppingDaily(false)
      setUiError(error instanceof Error ? error.message : 'Failed to stop daily trial cycle')
    }
  }

  const readAutomationImportContents = async (): Promise<{
    contents: string
    filename: string | null
  }> => {
    if (automationDecisionFile) {
      const fileText = (await automationDecisionFile.text()).trim()
      if (!fileText) {
        throw new Error('Selected decision file is empty')
      }

      return {
        contents: fileText,
        filename: automationDecisionFile.name,
      }
    }

    const pastedText = automationDecisionText.trim()
    if (!pastedText) {
      throw new Error('Choose a decision JSON file or paste decision JSON first')
    }

    return {
      contents: pastedText,
      filename: null,
    }
  }

  const refreshLatestRunSnapshot = async () => {
    const response = await fetch('/api/admin/trials/run-state', { cache: 'no-store' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(getApiErrorMessage(payload, 'Failed to refresh latest run state'))
    }

    applyRunSnapshot(payload?.snapshot ?? null)
  }

  const exportAutomationPacket = async () => {
    setUiError(null)
    setAutomationApplyState(null)
    setAutomationPreview(null)
    setIsExportingAutomation(true)

    try {
      const response = await fetch('/api/admin/trials/automation-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: automationSource,
          nctNumber: scopedClaudeNctNumber ?? undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to export automation packet'))
      }

      setAutomationExportState({
        filePath: payload.filePath,
        exportsDir: payload.paths?.exportsDir ?? '',
        decisionsDir: payload.paths?.decisionsDir ?? '',
        archiveDir: payload.paths?.archiveDir ?? '',
        taskCount: payload.packet?.taskCount ?? 0,
        modelLabel: automationModelLabel,
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to export automation packet')
    } finally {
      setIsExportingAutomation(false)
    }
  }

  const runAutomationImport = async (mode: 'dry-run' | 'apply') => {
    setUiError(null)
    if (mode === 'dry-run') {
      setAutomationApplyState(null)
      setIsPreviewingAutomation(true)
    } else {
      setIsApplyingAutomation(true)
    }

    try {
      const { contents, filename } = await readAutomationImportContents()
      const response = await fetch(`/api/admin/trials/automation-import?mode=${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: automationSource,
          contents,
          filename,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, `Failed to ${mode === 'dry-run' ? 'preview' : 'apply'} automation decisions`))
      }

      setAutomationPreview(payload.preview ?? null)

      if (mode === 'apply') {
        setAutomationApplyState({
          archivePath: payload.archivePath ?? '',
          readyCount: payload.preview?.readyCount ?? 0,
          duplicateCount: payload.preview?.duplicateCount ?? 0,
        })
        await refreshLatestRunSnapshot()
        router.refresh()
      }
    } catch (error) {
      setUiError(error instanceof Error ? error.message : `Failed to ${mode === 'dry-run' ? 'preview' : 'apply'} automation decisions`)
    } finally {
      if (mode === 'dry-run') {
        setIsPreviewingAutomation(false)
      } else {
        setIsApplyingAutomation(false)
      }
    }
  }

  const setSummaryFromPayload = (payload: DailyRunPayload, startedAtMs: number) => {
    const counts = payload.summary ?? summarizeCounts(payload.results)
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000))
    const runDateLabel = new Date(payload.runDate).toLocaleString('en-US', { timeZone: 'UTC' })
    const nonOkModels = summarizeNonOkModels(payload.results)

    setLastRunSummary({
      runDateLabel,
      runCount: 1,
      durationSeconds,
      ok: counts.ok,
      error: counts.error,
      skipped: counts.skipped,
      openMarkets: payload.openMarkets,
      nonOkModels,
    })
  }

  const runDailyCycle = async (options: RunDailyCycleOptions = {}) => {
    const startedAtMs = Date.now()
    let keepPersistedRunningState = false
    const controller = new AbortController()
    const runDescriptionBase = options.nctNumber && options.modelIds?.length === 1 && options.modelIds[0] === 'claude-opus'
      ? `Claude Opus 4.6 via Anthropic API on ${options.nctNumber}`
      : 'daily trial cycle'
    const runDescription = runDescriptionBase
    const relevantEvents = filterEventsForRun(events, options.nctNumber)
    const effectiveRunDateSeed = new Date(startedAtMs).toISOString()
    const initialModelOrder = options.modelIds && options.modelIds.length > 0
      ? options.modelIds
      : rotateModelOrderLocal(effectiveRunDateSeed)
    const requestBody = {
      nctNumber: options.nctNumber,
      modelIds: options.modelIds,
    }

    setUiError(null)
    setIsStoppingDaily(false)
    setIsStreamingRun(true)
    setPreserveExecutionPlan(true)
    setRunningDaily(true)
    setLastRunSummary(null)
    setElapsedSeconds(0)
    setRunLog([`${formatUtcLogPrefix(new Date(startedAtMs))} UTC  Starting ${runDescription}...`])
    setErrorConsole([])
    setRunProgress({
      startedAtMs,
      runDate: null,
      modelOrder: initialModelOrder,
      orderedMarkets: [],
      openMarkets: 0,
      totalActions: 0,
      completedActions: 0,
      okCount: 0,
      errorCount: 0,
      skippedCount: 0,
      latestResult: null,
      latestError: null,
      currentActivity: `Initializing ${runDescription}...`,
    })
    setExecutionPlan(buildExecutionPlan({
      events: relevantEvents,
      runDate: effectiveRunDateSeed,
      modelOrder: initialModelOrder,
      fallbackStatuses: ['OPEN'],
    }))

    try {
      const response = await fetch('/api/trials/run-daily?stream=1', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
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
      let pausedMessage: string | null = null

      const handleStreamEvent = (event: DailyRunStreamEvent): void => {
        if (event.type === 'start') {
          setRunProgress((prev) => prev ? {
            ...prev,
            runDate: event.runDate,
            modelOrder: event.modelOrder,
            orderedMarkets: event.orderedMarkets,
            openMarkets: event.openMarkets,
            totalActions: event.totalActions,
            currentActivity: `Discovered ${event.openMarkets} open trials (${event.totalActions} actions)`,
          } : prev)
          setExecutionPlan(buildExecutionPlan({
            events: relevantEvents,
            runDate: event.runDate,
            modelOrder: event.modelOrder,
            orderedMarkets: event.orderedMarkets,
            fallbackStatuses: ['OPEN'],
          }))
          appendRunLog(`Found ${event.openMarkets} open trials (${event.totalActions} model actions)`)
          return
        }

        if (event.type === 'progress') {
          const occurredAtMs = Date.now()
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
          setExecutionPlan((prev) => applyProgressToExecutionPlan(prev, event.result, occurredAtMs))
          appendRunLog(formatProgressLog(event.result))
          return
        }

        if (event.type === 'activity') {
          const occurredAtMs = Date.now()
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
            occurredAtMs,
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
            currentActivity: `${runDescription} completed`,
          } : prev)
          setExecutionPlan((prev) => finalizeExecutionPlan(prev))
          setSummaryFromPayload(event.payload, startedAtMs)
          appendRunLog(`${runDescription} completed`)
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

        if (event.type === 'paused') {
          pausedMessage = event.message
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

      if (cancelledMessage || pausedMessage) {
        try {
          const response = await fetch('/api/admin/trials/run-state', { cache: 'no-store' })
          const payload = await response.json().catch(() => ({}))
          if (response.ok) {
            applyRunSnapshot(payload?.snapshot ?? null)
          }
        } catch {
          // Preserve local stopped/paused state if the snapshot refresh fails.
        }
        return
      }

      if (!donePayload) {
        throw new Error('Daily run ended before completion status was received')
      }

      try {
        const response = await fetch('/api/admin/trials/run-state', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) {
          applyRunSnapshot(payload?.snapshot ?? null)
        }
      } catch {
        // Keep local completion state if the snapshot refresh fails.
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        try {
      const response = await fetch('/api/admin/trials/run-state', { cache: 'no-store' })
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
        currentActivity: `${runDescription} failed: ${message}`,
      } : prev)
      setExecutionPlan((prev) => finalizeExecutionPlan(prev))
      appendErrorConsole(`RUN FAILED - ${message}`)

      if (message.toLowerCase().includes('already running')) {
        try {
      const response = await fetch('/api/admin/trials/run-state', { cache: 'no-store' })
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
  const showingLastRunResults = !runningDaily && preserveExecutionPlan && Boolean(lastRunSummary)
  const executionPlanHeading = runningDaily
    ? 'Execution Plan'
    : showingLastRunResults
      ? 'Last Run Results'
      : preserveExecutionPlan
      ? 'Latest Run Plan'
      : 'Next Run Plan'
  const currentExecutionMarket = currentExecutionStep
    ? executionPlan.find((market) => market.marketId === currentExecutionStep.marketId) ?? null
    : null
  const executionModelOrder = executionPlan[0]?.steps.map((step) => step.modelId) ?? runProgress?.modelOrder ?? []
  const executionEstimatedCostUsd = useMemo(() => (
    executionPlan.reduce((total, market) => (
      total + executionModelOrder.reduce((marketTotal, modelId) => (
        marketTotal + (market.estimatedModelRunCosts[modelId] ?? 0)
      ), 0)
    ), 0)
  ), [executionModelOrder, executionPlan])
  const averageModelRowCost = useMemo(() => (
    executionModelOrder.reduce<Partial<Record<ModelId, number>>>((acc, modelId) => {
      let total = 0
      let count = 0

      for (const market of executionPlan) {
        const cost = market.estimatedModelRunCosts[modelId]
        if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) continue
        total += cost
        count += 1
      }

      if (count > 0) {
        acc[modelId] = total / count
      }

      return acc
    }, {})
  ), [executionModelOrder, executionPlan])
  const getExecutionStepFallbackDetail = (status: 'queued' | 'running' | 'waiting' | 'ok' | 'error' | 'skipped') => {
    switch (status) {
      case 'queued':
        return null
      case 'running':
        return 'In progress'
      case 'waiting':
        return 'Waiting on turn'
      case 'ok':
        return 'Completed'
      case 'error':
        return 'Needs review'
      case 'skipped':
        return 'Skipped'
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {uiError && (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {uiError}
        </div>
      )}
      {showDailyCycle ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-start gap-2">
            <button
              onClick={() => {
                void runDailyCycle()
              }}
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
          <div className="rounded-none border border-[#e8ddd0] bg-white/75 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={scopedClaudeNctInput}
                onChange={(event) => setScopedClaudeNctInput(normalizeScopedNctNumberInput(event.target.value))}
                placeholder="NCT06870240"
                inputMode="text"
                spellCheck={false}
                className="min-w-[180px] flex-1 rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-2 text-sm text-[#1a1a1a] outline-none placeholder:text-[#a39789] focus:border-[#b8aa98]"
              />
              <button
                type="button"
                onClick={() => {
                  if (!scopedClaudeNctNumber) return
                  void runDailyCycle({
                    nctNumber: scopedClaudeNctNumber,
                    modelIds: ['claude-opus'],
                  })
                }}
                disabled={runningDaily || !scopedClaudeNctNumber || scopedClaudeOpenMarketCount === 0}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#6f665b] transition-colors hover:bg-[#f5eee5] hover:text-[#3b342c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Run Claude Opus
              </button>
            </div>
            {scopedClaudeNctInput && !scopedClaudeNctNumber ? (
              <p className="text-xs text-[#8d2c22]">Enter an NCT id like NCT06870240.</p>
            ) : null}
            {scopedClaudeNctNumber && scopedClaudeOpenMarketCount === 0 ? (
        <p className="text-xs text-[#8d2c22]">No open trial currently matches {scopedClaudeNctNumber}.</p>
            ) : null}
            {scopedClaudeNctNumber && scopedClaudeOpenMarketCount > 0 ? (
              <p className="text-xs text-[#2f6f24]">
          Ready to run Claude Opus 4.6 via Anthropic API for {scopedClaudeNctNumber} across {scopedClaudeOpenMarketCount} open trial{scopedClaudeOpenMarketCount === 1 ? '' : 's'}.
              </p>
            ) : null}
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white/75 p-3 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[#1a1a1a]">Automation Handoff</h3>
              <p className="mt-1 text-xs text-[#8a8075]">
                Export a subscription-backed research packet for {automationSourceLabel}, let the automation write decisions JSON, then dry-run or apply it here.
              </p>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <label className="flex min-w-[220px] flex-col gap-1 text-xs text-[#8a8075]">
                <span>Automation Source</span>
                <select
                  value={automationSource}
                  onChange={(event) => {
                    setAutomationSource(event.target.value as DailyRunAutomationSource)
                    setAutomationPreview(null)
                    setAutomationApplyState(null)
                  }}
                  className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-2 text-sm text-[#1a1a1a] outline-none"
                >
                  <option value="claude-code-subscription">Claude Code subscription</option>
                  <option value="codex-subscription">Codex subscription</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  void exportAutomationPacket()
                }}
                disabled={isExportingAutomation || runningDaily || isPreviewingAutomation || isApplyingAutomation || (Boolean(scopedClaudeNctInput) && !scopedClaudeNctNumber)}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#6f665b] transition-colors hover:bg-[#f5eee5] hover:text-[#3b342c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExportingAutomation ? 'Exporting...' : `Export ${automationModelLabel} Packet`}
              </button>
            </div>
            <p className="text-xs text-[#8a8075]">
              Scope: {scopedClaudeNctNumber ? `${scopedClaudeNctNumber}` : 'all open trials'} for {automationModelLabel}.
            </p>
            {automationExportState ? (
              <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/8 px-3 py-2 text-xs text-[#2f6f24]">
                <p>
                  Exported {automationExportState.taskCount} task{automationExportState.taskCount === 1 ? '' : 's'} to {automationExportState.filePath}
                </p>
                <p className="mt-1 text-[#5f564c]">
                  Drop automation outputs into {automationExportState.decisionsDir}. Applied files are archived in {automationExportState.archiveDir}.
                </p>
              </div>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-[#8a8075]">
                <span>Decision JSON File</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setAutomationDecisionFile(file)
                    setAutomationPreview(null)
                    setAutomationApplyState(null)
                  }}
                  className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-2 text-sm text-[#1a1a1a] outline-none file:mr-3 file:border-0 file:bg-transparent file:px-0 file:py-0 file:text-sm file:font-medium"
                />
                {automationDecisionFile ? (
                  <span className="text-[11px] text-[#6f665b]">{automationDecisionFile.name}</span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#8a8075]">
                <span>Or Paste Decision JSON</span>
                <textarea
                  value={automationDecisionText}
                  onChange={(event) => {
                    setAutomationDecisionText(event.target.value)
                    setAutomationDecisionFile(null)
                    setAutomationPreview(null)
                    setAutomationApplyState(null)
                  }}
                  rows={5}
                  placeholder='{"workflow":"admin-ai-automation-handoff","source":"codex-subscription","decisions":[...]}'
                  className="min-h-[120px] rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-2 text-sm text-[#1a1a1a] outline-none placeholder:text-[#a39789]"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void runAutomationImport('dry-run')
                }}
                disabled={isPreviewingAutomation || isApplyingAutomation || runningDaily}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#6f665b] transition-colors hover:bg-[#f5eee5] hover:text-[#3b342c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPreviewingAutomation ? 'Previewing...' : 'Dry Run Import'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void runAutomationImport('apply')
                }}
                disabled={isApplyingAutomation || isPreviewingAutomation || runningDaily}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isApplyingAutomation ? 'Applying...' : 'Apply Imported Decisions'}
              </button>
            </div>
            {automationPreview ? (
              <div className="rounded-none border border-[#e8ddd0] bg-white/70 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <div className="rounded-none border border-[#e8ddd0] bg-white px-2 py-1">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Source</p>
                    <p className="text-xs font-medium text-[#1a1a1a]">{automationPreview.sourceLabel}</p>
                  </div>
                  <div className="rounded-none border border-[#e8ddd0] bg-white px-2 py-1">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Model</p>
                    <p className="text-xs font-medium text-[#1a1a1a]">{automationPreview.modelLabel}</p>
                  </div>
                  <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/10 px-2 py-1">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#2f6f24]">Ready</p>
                    <p className="text-xs font-medium text-[#2f6f24]">{automationPreview.readyCount}</p>
                  </div>
                  <div className="rounded-none border border-[#b5aa9e]/40 bg-[#f5f2ed] px-2 py-1">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Duplicate</p>
                    <p className="text-xs font-medium text-[#6f665b]">{automationPreview.duplicateCount}</p>
                  </div>
                  <div className="rounded-none border border-[#c43a2b]/30 bg-[#c43a2b]/10 px-2 py-1">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#8d2c22]">Invalid</p>
                    <p className="text-xs font-medium text-[#8d2c22]">{automationPreview.invalidCount}</p>
                  </div>
                </div>
                <p className="text-xs text-[#8a8075]">
                  {automationPreview.totalDecisions} imported decision{automationPreview.totalDecisions === 1 ? '' : 's'} for {new Date(automationPreview.runDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })} UTC.
                </p>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {automationPreview.items.map((item) => (
                    <div key={item.taskKey} className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-[#1a1a1a]">{item.shortTitle}</p>
                        <span className={`rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                          item.status === 'ready'
                            ? 'border-[#3a8a2e]/30 bg-[#3a8a2e]/10 text-[#2f6f24]'
                            : item.status === 'duplicate'
                              ? 'border-[#b5aa9e]/40 bg-[#f5f2ed] text-[#6f665b]'
                              : 'border-[#c43a2b]/30 bg-[#fff3f1] text-[#8d2c22]'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[#6f665b]">
                        {item.nctNumber ? `${item.nctNumber} • ` : ''}{item.actionType} ${item.amountUsd.toFixed(2)}
                      </p>
                      <p className="mt-1 text-[#8a8075]">{item.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {automationApplyState ? (
              <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/8 px-3 py-2 text-xs text-[#2f6f24]">
                <p>
                  Applied {automationApplyState.readyCount} imported decision{automationApplyState.readyCount === 1 ? '' : 's'}.
                  {automationApplyState.duplicateCount > 0 ? ` ${automationApplyState.duplicateCount} duplicate step${automationApplyState.duplicateCount === 1 ? '' : 's'} were left as-is.` : ''}
                </p>
                <p className="mt-1 text-[#5f564c]">Archived input at {automationApplyState.archivePath}</p>
              </div>
            ) : null}
          </div>
          <div className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
            <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Daily Trial Cycle</h3>
              <p className="mt-1 text-xs text-[#8a8075]">Manual run or imported subscription-backed decision file.</p>
            </div>
          {runProgress && (
            <div className="mt-3 rounded-none border border-[#e8ddd0] bg-white/70 p-3 space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Run Overview</p>
                <p className="text-xs text-[#8a8075]">
                  {runProgress.runDate
                    ? `Run ${new Date(runProgress.runDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })} UTC`
                    : 'Initializing run'} • {runProgress.openMarkets} open trial{runProgress.openMarkets === 1 ? '' : 's'} • {runProgress.completedActions}/{runProgress.totalActions || '?'} actions • {displayElapsedSeconds}s elapsed
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
                {executionEstimatedCostUsd > 0 ? (
                  <p className="text-[11px] text-[#8a8075]">
                    {formatUsdEstimate(executionEstimatedCostUsd)} estimated list-price cost across the displayed steps.
                  </p>
                ) : null}
                {executionPlanStepCount > 0 ? (
                  <p className="text-[11px] text-[#8a8075]">
                    Fresh estimate using current API list prices and this row&apos;s prompt shape. Search-enabled models assume one tool-backed search pass.
                  </p>
                ) : null}
                <p className="text-xs text-[#8a8075]">
                  {executionPlan.length} trial{executionPlan.length === 1 ? '' : 's'} • {executionPlanStepCount} model step{executionPlanStepCount === 1 ? '' : 's'}
                  {showingLastRunResults
                    ? (lastRunSummary?.runCount && lastRunSummary.runCount > 1
                        ? ` • combined from ${lastRunSummary.runCount} runs on this run date`
                        : ' • preserved from the latest completed run')
                    : (!runningDaily && !preserveExecutionPlan && executionPlanStepCount > 0 ? ` • ${queuedExecutionSteps} queued for the next run` : '')}
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

            {!currentExecutionStep && !runningDaily && !preserveExecutionPlan && executionPlanStepCount > 0 && (
              <div className="mt-3 rounded-none border border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Queued Next</p>
                <p className="mt-1 text-sm text-[#5f564c]">
                  {MODEL_INFO[executionPlan[0].steps[0].modelId].fullName} on {executionPlan[0].shortTitle}
                </p>
              </div>
            )}

            <div className="mt-3">
              {executionPlan.length > 0 ? (
                <div className="max-h-[72vh] overflow-auto rounded-none border border-[#e8ddd0] bg-white">
                  <table className="min-w-[1700px] w-full border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-[#f8f4ee]">
                        <th className="sticky left-0 top-0 z-30 min-w-[260px] border-b border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8075] shadow-[1px_0_0_0_#e8ddd0]">
                          Trial
                        </th>
                        <th className="sticky top-0 z-20 min-w-[128px] border-b border-l border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8075]">
                          Progress
                        </th>
                        {executionModelOrder.map((modelId, index) => (
                          <th
                            key={modelId}
                            className="sticky top-0 z-20 min-w-[180px] border-b border-l border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2 text-left align-top"
                          >
                            <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">
                              Model {index + 1}
                            </p>
                            <p className="mt-1 text-xs font-medium text-[#1a1a1a]">
                              {MODEL_INFO[modelId].fullName}
                            </p>
                            {averageModelRowCost[modelId] ? (
                              <p className="mt-1 text-[11px] text-[#6f665b]">
                                {formatUsdEstimate(averageModelRowCost[modelId] ?? 0)}/row
                              </p>
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {executionPlan.map((market) => {
                        const marketDoneCount = market.steps.filter((step) => step.status === 'ok' || step.status === 'skipped' || step.status === 'error').length
                        const stepByModel = new Map(market.steps.map((step) => [step.modelId, step] as const))
                        const isCurrentMarket = currentExecutionMarket?.marketId === market.marketId
                        const marketEstimatedCostUsd = executionModelOrder.reduce((total, modelId) => (
                          total + (market.estimatedModelRunCosts[modelId] ?? 0)
                        ), 0)

                        return (
                          <tr key={market.marketId} className="align-top">
                            <td className="sticky left-0 z-10 min-w-[260px] border-t border-[#e8ddd0] bg-white px-3 py-3 shadow-[1px_0_0_0_#e8ddd0]">
                              <p className="text-sm font-medium text-[#1a1a1a]">
                                {market.marketSequence}. {market.shortTitle}
                              </p>
                              <p className="mt-1 text-xs text-[#8a8075]">
                                {formatUtcDate(market.decisionDate, { month: '2-digit', day: '2-digit', year: '2-digit' })}
                                {market.nctNumber ? ` • ${market.nctNumber}` : ''}
                              </p>
                            </td>
                            <td className="border-l border-t border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
                              <p className="text-sm font-medium text-[#1a1a1a]">
                                {marketDoneCount}/{market.steps.length}
                              </p>
                              <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">
                                steps closed
                              </p>
                              {marketEstimatedCostUsd > 0 ? (
                                <p className="mt-2 text-xs text-[#6f665b]">
                                  {formatUsdEstimate(marketEstimatedCostUsd)} est.
                                </p>
                              ) : null}
                              {isCurrentMarket && currentExecutionStep && (
                                <p className="mt-2 text-xs text-[#1f5cb9]">
                                  Live on {MODEL_INFO[currentExecutionStep.modelId].name}
                                </p>
                              )}
                            </td>
                            {executionModelOrder.map((modelId) => {
                              const step = stepByModel.get(modelId)

                              if (!step) {
                                return (
                                  <td
                                    key={`${market.marketId}:${modelId}`}
                                    className="border-l border-t border-[#e8ddd0] bg-white px-3 py-3"
                                  >
                                    <p className="text-xs text-[#8a8075]">Not scheduled</p>
                                  </td>
                                )
                              }

                              const tone = getExecutionStepTone(step.status)
                              const detail = step.detail
                                ? truncateText(step.detail, 88)
                                : getExecutionStepFallbackDetail(step.status)
                              const durationLabel = getExecutionStepDurationLabel(step, executionStepNowMs)
                              const estimatedStepCostUsd = market.estimatedModelRunCosts[modelId] ?? 0

                              return (
                                <td
                                  key={step.key}
                                  className={`border-l border-t px-3 py-3 align-top ${tone.container}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className={`rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${tone.badge}`}>
                                      {getExecutionStatusLabel(step.status)}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">
                                      {step.globalSequence}/{executionPlanStepCount}
                                    </span>
                                  </div>
                                  {detail ? (
                                    <p className={`mt-2 text-xs leading-5 ${tone.label}`}>
                                      {detail}
                                    </p>
                                  ) : null}
                                  {durationLabel ? (
                                    <p className="mt-2 text-[11px] text-[#6f665b]">
                                      {durationLabel}
                                    </p>
                                  ) : null}
                                  {estimatedStepCostUsd > 0 ? (
                                    <p className="mt-2 text-[11px] text-[#8a8075]">
                                      {formatUsdEstimate(estimatedStepCostUsd)} est.
                                    </p>
                                  ) : null}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-3 text-sm text-[#8a8075]">
                  {showingLastRunResults
                    ? 'No trials were processed in the latest completed run.'
                    : 'No open trials are queued for the next daily cycle yet.'}
                </div>
              )}
            </div>
          </div>

          {(runLog.length > 0 || errorConsole.length > 0) && (
            <div className={`mt-3 grid gap-3 ${runLog.length > 0 && errorConsole.length > 0 ? 'lg:grid-cols-2' : ''}`}>
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
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Open Trials</p>
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
        </div>
      ) : null}

      {showSearch ? (
        <div className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
          <input
            type="text"
            placeholder={sectionLabels.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-[#e8ddd0] bg-white/90 px-3 py-2 text-sm placeholder-[#b5aa9e] focus:border-[#8a8075] focus:outline-none"
          />
        </div>
      ) : null}

      {showOpenMarkets || showNeedsMarket || showResolvedMarkets ? (
        <div className="space-y-5">
          {showOpenMarkets ? (
            <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  {sectionLabels.openMarketsTitle ? (
                    <h3 className="text-sm font-semibold text-[#1a1a1a]">{sectionLabels.openMarketsTitle}</h3>
                  ) : null}
                  {sectionLabels.openMarketsDescription ? (
                    <p className="mt-1 text-xs text-[#8a8075]">{sectionLabels.openMarketsDescription}</p>
                  ) : null}
                </div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">{openEvents.length} shown</p>
              </div>

              <div className="mt-3 space-y-3">
                {openEvents.length === 0 ? (
                  <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
                    {sectionLabels.openMarketsEmptyState}
                  </div>
                ) : openEvents.map((event) => {
                  const statusTone = getTrialStatusTone(event.marketStatus)
                  const days = getDaysUntil(event.decisionDate)
                  const isClickable = Boolean(event.marketId)

                  return (
                    <div
                      key={event.id}
                      role={isClickable ? 'link' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onClick={isClickable ? () => navigateToMarket(event.marketId) : undefined}
                      onKeyDown={isClickable ? (input) => handleMarketRowKeyDown(input, event.marketId) : undefined}
                      className={`rounded-none border border-[#e8ddd0] bg-white/80 p-4 ${isClickable ? 'cursor-pointer transition-colors hover:bg-[#fdfbf8] focus:outline-none focus:ring-1 focus:ring-[#8a8075]' : ''}`}
                    >
                      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#1a1a1a]">{event.shortTitle}</div>
                          {event.nctNumber ? (
                            <div className="mt-1 text-xs text-[#8a8075]">{event.nctNumber}</div>
                          ) : null}
                        </div>
                        <div
                          className="grid grid-flow-col auto-cols-max items-center justify-end gap-3"
                          onClick={(input) => input.stopPropagation()}
                        >
                          <span className={`rounded-none px-2 py-1 text-xs ${statusTone}`}>
                            {event.marketStatus || 'NO MARKET'}
                          </span>
                          <div className="min-w-[56px] text-right">
                            <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                              {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
                            </div>
                          </div>

                          <div className="relative">
                            <select
                              value={event.outcome}
                              onChange={(input) => updateOutcome(event.id, input.target.value)}
                              disabled={updatingOutcome[event.id]}
                              className={`max-w-full appearance-none cursor-pointer rounded-none border-0 px-3 py-1.5 pr-8 text-sm font-medium ${getOutcomeStyle(event.outcome)} ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
                            >
                              <option value="Pending" className="bg-white text-[#D39D2E]">Pending</option>
                              <option value="YES" className="bg-white text-[#3a8a2e]">YES</option>
                              <option value="NO" className="bg-white text-[#EF6F67]">NO</option>
                            </select>
                            <svg
                              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b5aa9e]"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteDrug(event.id, event.shortTitle)}
                            disabled={deletingEventId === event.id}
                            className="whitespace-nowrap rounded-none border border-[#efc2be] bg-[#fff6f5] px-3 py-1.5 text-xs font-medium text-[#8d2c22] transition-colors hover:bg-[#fde9e7] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingEventId === event.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {showNeedsMarket && needsMarketEvents.length > 0 ? (
            <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a]">{sectionLabels.needsMarketTitle}</h3>
                  <p className="mt-1 text-xs text-[#8a8075]">{sectionLabels.needsMarketDescription}</p>
                </div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">{needsMarketEvents.length} shown</p>
              </div>

              <div className="mt-3 space-y-3">
                {needsMarketEvents.map((event) => {
                  const isOpening = loadingEventId === event.id
                  const days = getDaysUntil(event.decisionDate)

                  return (
                    <div key={`needs-market-${event.id}`} className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
                      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#1a1a1a]">{event.shortTitle}</div>
                          {event.nctNumber ? (
                            <div className="mt-1 text-xs text-[#8a8075]">{event.nctNumber}</div>
                          ) : null}
                        </div>
                        <div className="grid grid-flow-col auto-cols-max items-center justify-end gap-3">
                          <div className="min-w-[56px] text-right">
                            <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                              {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
                            </div>
                          </div>
                          <span className="rounded-none px-2 py-1 text-xs text-[#8a8075] bg-[#e8ddd0]/40">
                            NO MARKET
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteDrug(event.id, event.shortTitle)}
                            disabled={deletingEventId === event.id}
                            className="whitespace-nowrap rounded-none border border-[#efc2be] bg-[#fff6f5] px-3 py-1.5 text-xs font-medium text-[#8d2c22] transition-colors hover:bg-[#fde9e7] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingEventId === event.id ? 'Deleting...' : 'Delete'}
                          </button>
                          <button
                            onClick={() => openMarket(event.id)}
                            disabled={isOpening}
                            className="whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isOpening ? 'Opening...' : 'Open Trial'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {showResolvedMarkets ? (
            <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a]">{sectionLabels.resolvedMarketsTitle}</h3>
                  <p className="mt-1 text-xs text-[#8a8075]">{sectionLabels.resolvedMarketsDescription}</p>
                </div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">{adjudicationEvents.length} shown</p>
              </div>

              <div className="mt-3 space-y-3">
                {adjudicationEvents.length === 0 ? (
                  <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
                    {sectionLabels.resolvedMarketsEmptyState}
                  </div>
                ) : adjudicationEvents.map((event) => {
                  const days = getDaysUntil(event.decisionDate)
                  const statusTone = getTrialStatusTone(event.marketStatus)
                  const isClickable = Boolean(event.marketId)

                  return (
                    <div
                      key={`adjudication-${event.id}`}
                      role={isClickable ? 'link' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onClick={isClickable ? () => navigateToMarket(event.marketId) : undefined}
                      onKeyDown={isClickable ? (input) => handleMarketRowKeyDown(input, event.marketId) : undefined}
                      className={`rounded-none border border-[#e8ddd0] bg-white/80 p-4 ${isClickable ? 'cursor-pointer transition-colors hover:bg-[#fdfbf8] focus:outline-none focus:ring-1 focus:ring-[#8a8075]' : ''}`}
                    >
                      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-[#1a1a1a]">{event.shortTitle}</div>
                            <span className={`rounded-none px-2 py-1 text-xs ${statusTone}`}>
                              {event.marketStatus}
                            </span>
                          </div>
                          {event.nctNumber ? (
                            <div className="mt-1 text-xs text-[#8a8075]">{event.nctNumber}</div>
                          ) : null}
                        </div>

                        <div
                          className="grid grid-flow-col auto-cols-max items-center justify-end gap-3"
                          onClick={(input) => input.stopPropagation()}
                        >
                          <div className="min-w-[56px] text-right">
                            <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                              {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
                            </div>
                          </div>

                          <div className="relative">
                            <select
                              value={event.outcome}
                              onChange={(input) => updateOutcome(event.id, input.target.value)}
                              disabled={updatingOutcome[event.id]}
                              className={`max-w-full appearance-none cursor-pointer rounded-none border-0 px-3 py-1.5 pr-8 text-sm font-medium ${getOutcomeStyle(event.outcome)} ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
                            >
                              <option value="Pending" className="bg-white text-[#D39D2E]">Pending</option>
                              <option value="YES" className="bg-white text-[#3a8a2e]">YES</option>
                              <option value="NO" className="bg-white text-[#EF6F67]">NO</option>
                            </select>
                            <svg
                              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b5aa9e]"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteDrug(event.id, event.shortTitle)}
                            disabled={deletingEventId === event.id}
                            className="whitespace-nowrap rounded-none border border-[#efc2be] bg-[#fff6f5] px-3 py-1.5 text-xs font-medium text-[#8d2c22] transition-colors hover:bg-[#fde9e7] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingEventId === event.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
