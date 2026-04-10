'use client'

import Link from 'next/link'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'
import { formatLocalDateTime } from '@/lib/date'
import { AdminTrialOutcomeHistory, type AdminTrialOutcomeHistoryEntry } from '@/components/AdminTrialOutcomeHistory'

type TrialMonitorConfigDto = {
  enabled: boolean
  runIntervalHours: number
  lookaheadDays: number
  overdueRecheckHours: number
  maxQuestionsPerRun: number
  cronProcessingConcurrency: number
  manualProcessingConcurrency: number
  verifierModelKey: string
  minCandidateConfidence: number
  updatedAt: string
}

type Candidate = {
  id: string
  marketId: string | null
  proposedOutcome: 'YES' | 'NO' | 'NO_DECISION'
  confidence: number
  verifierModelLabel: string
  summary: string
  createdAt: string
  questionPrompt: string
  trial: {
    shortTitle: string
    sponsorName: string
    sponsorTicker: string | null
    exactPhase: string
    nctNumber: string | null
    estPrimaryCompletionDate: string
  }
  evidence: Array<{
    id: string
    sourceType: 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search'
    title: string
    url: string
    publishedAt: string | null
    excerpt: string
    domain: string
  }>
}

type TrialMonitorQuestionSelection = 'eligible_queue' | 'all_open_trials' | 'specific_nct'

type RunRow = {
  id: string
  triggerSource: 'cron' | 'manual'
  status: 'running' | 'completed' | 'failed' | 'paused'
  questionSelection: TrialMonitorQuestionSelection
  verifierModelLabel: string
  scopedNctNumber: string | null
  questionsScanned: number
  candidatesCreated: number
  errorSummary: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
  stopRequestedAt: string | null
}

type EligibleQuestion = {
  id: string
  prompt: string
  trial: {
    shortTitle: string
    sponsorName: string
    sponsorTicker: string | null
    nctNumber: string | null
    estPrimaryCompletionDate: string
    lastMonitoredAt: string | null
  }
}

interface Props {
  initialConfig: TrialMonitorConfigDto
  verifierModelOptions: Array<{
    value: string
    label: string
  }>
  initialCandidates: Candidate[]
  recentRuns: RunRow[]
  initialEligibleQuestions: EligibleQuestion[]
  allOpenTrialCount: number
  historyEntries: AdminTrialOutcomeHistoryEntry[]
  initialScopedNctNumber?: string | null
  autoRunScopedNctNumber?: string | null
}

type ConfigFormState = {
  enabled: boolean
  runIntervalHours: string
  lookaheadDays: string
  maxQuestionsPerRun: string
  cronProcessingConcurrency: string
  manualProcessingConcurrency: string
  verifierModelKey: string
}

type ConfigSavePayload = {
  enabled: boolean
  runIntervalHours: number
  lookaheadDays: number
  maxQuestionsPerRun: number
  cronProcessingConcurrency: number
  manualProcessingConcurrency: number
  verifierModelKey: string
}

type TrialMonitorRunResult = {
  executed: boolean
  reason?: 'disabled' | 'not_due'
  status?: 'completed' | 'paused'
  questionSelection?: TrialMonitorQuestionSelection
  questionsScanned: number
  candidatesCreated: number
  errors: string[]
  nextEligibleAt?: string
  scopedNctNumber?: string
}

type ConfigStatusTone = 'muted' | 'saving' | 'saved' | 'invalid' | 'error'

function toFormState(config: TrialMonitorConfigDto): ConfigFormState {
  return {
    enabled: config.enabled,
    runIntervalHours: String(config.runIntervalHours),
    lookaheadDays: String(config.lookaheadDays),
    maxQuestionsPerRun: String(config.maxQuestionsPerRun),
    cronProcessingConcurrency: String(config.cronProcessingConcurrency),
    manualProcessingConcurrency: String(config.manualProcessingConcurrency),
    verifierModelKey: config.verifierModelKey,
  }
}

function toConfigSavePayload(config: TrialMonitorConfigDto): ConfigSavePayload {
  return {
    enabled: config.enabled,
    runIntervalHours: config.runIntervalHours,
    lookaheadDays: config.lookaheadDays,
    maxQuestionsPerRun: config.maxQuestionsPerRun,
    cronProcessingConcurrency: config.cronProcessingConcurrency,
    manualProcessingConcurrency: config.manualProcessingConcurrency,
    verifierModelKey: config.verifierModelKey,
  }
}

function serializeConfigPayload(payload: ConfigSavePayload): string {
  return JSON.stringify(payload)
}

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = Math.round(parsed)
  if (rounded < min || rounded > max) return null
  return rounded
}

function normalizeScopedNctNumberInput(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '')
}

function parseScopedNctNumber(value: string): string | null {
  const normalized = normalizeScopedNctNumberInput(value)
  return /^NCT\d{8}$/.test(normalized) ? normalized : null
}

function matchesScopedNctNumber(value: string | null | undefined, scopedNctNumber: string | null): boolean {
  if (!scopedNctNumber) {
    return true
  }

  return parseScopedNctNumber(value ?? '') === scopedNctNumber
}

function getConfigValidationMessage(form: ConfigFormState): string | null {
  if (parseBoundedInteger(form.runIntervalHours, 1, 168) == null) {
    return 'Cron interval must be between 1 and 168 hours.'
  }
  if (parseBoundedInteger(form.lookaheadDays, 0, 365) == null) {
    return 'Lookahead window must be between 0 and 365 days.'
  }
  if (parseBoundedInteger(form.maxQuestionsPerRun, 1, 500) == null) {
    return 'Max questions per run must be between 1 and 500.'
  }
  if (parseBoundedInteger(form.cronProcessingConcurrency, 1, 12) == null) {
    return 'Cron parallelism must be between 1 and 12 workers.'
  }
  if (parseBoundedInteger(form.manualProcessingConcurrency, 1, 12) == null) {
    return 'Manual parallelism must be between 1 and 12 workers.'
  }
  if (!form.verifierModelKey.trim()) {
    return 'Verifier model is required.'
  }
  return null
}

function getConfigPayloadFromForm(form: ConfigFormState): ConfigSavePayload | null {
  const runIntervalHours = parseBoundedInteger(form.runIntervalHours, 1, 168)
  const lookaheadDays = parseBoundedInteger(form.lookaheadDays, 0, 365)
  const maxQuestionsPerRun = parseBoundedInteger(form.maxQuestionsPerRun, 1, 500)
  const cronProcessingConcurrency = parseBoundedInteger(form.cronProcessingConcurrency, 1, 12)
  const manualProcessingConcurrency = parseBoundedInteger(form.manualProcessingConcurrency, 1, 12)
  const verifierModelKey = form.verifierModelKey.trim()

  if (
    runIntervalHours == null ||
    lookaheadDays == null ||
    maxQuestionsPerRun == null ||
    cronProcessingConcurrency == null ||
    manualProcessingConcurrency == null ||
    !verifierModelKey
  ) {
    return null
  }

  return {
    enabled: form.enabled,
    runIntervalHours,
    lookaheadDays,
    maxQuestionsPerRun,
    cronProcessingConcurrency,
    manualProcessingConcurrency,
    verifierModelKey,
  }
}

function getRunStatusTone(run: Pick<RunRow, 'status' | 'stopRequestedAt'>): string {
  if (run.status === 'running' && run.stopRequestedAt) {
    return 'bg-[#D39D2E]/10 text-[#8b6b21]'
  }

  switch (run.status) {
    case 'completed':
      return 'bg-[#3a8a2e]/10 text-[#2f6f24]'
    case 'failed':
      return 'bg-[#EF6F67]/10 text-[#8d2c22]'
    case 'paused':
      return 'bg-[#D39D2E]/10 text-[#8b6b21]'
    default:
      return 'bg-[#5BA5ED]/10 text-[#265f8f]'
  }
}

function getRunStatusLabel(run: Pick<RunRow, 'status' | 'stopRequestedAt'>): string {
  if (run.status === 'running' && run.stopRequestedAt) {
    return 'Pause Requested'
  }
  if (run.status === 'paused') {
    return 'Paused'
  }
  if (run.status === 'failed') {
    return 'Failed'
  }
  if (run.status === 'completed') {
    return 'Completed'
  }
  return 'Running'
}

function splitRunErrors(summary: string): string[] {
  return summary
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
}

function isSettlementCandidate(candidate: Candidate): boolean {
  return candidate.proposedOutcome === 'YES' || candidate.proposedOutcome === 'NO'
}

function compareCandidatesForReview(left: Candidate, right: Candidate): number {
  const leftSettlement = isSettlementCandidate(left)
  const rightSettlement = isSettlementCandidate(right)

  if (leftSettlement !== rightSettlement) {
    return leftSettlement ? -1 : 1
  }

  const leftCreatedAt = new Date(left.createdAt).getTime()
  const rightCreatedAt = new Date(right.createdAt).getTime()
  if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
    return rightCreatedAt - leftCreatedAt
  }

  return left.trial.shortTitle.localeCompare(right.trial.shortTitle)
}

function getCandidateBadge(candidate: Candidate): { label: string; className: string } {
  if (candidate.proposedOutcome === 'YES') {
    return {
      label: 'YES',
      className: 'bg-[#3a8a2e]/10 text-[#2f6f24]',
    }
  }

  if (candidate.proposedOutcome === 'NO') {
    return {
      label: 'NO',
      className: 'bg-[#EF6F67]/10 text-[#8d2c22]',
    }
  }

  return {
    label: 'NO DECISION / EVIDENCE ONLY',
    className: 'bg-[#D39D2E]/10 text-[#8b6b21]',
  }
}

function getRunSelectionLabel(input: {
  questionSelection?: TrialMonitorQuestionSelection
  scopedNctNumber?: string | null
}): string {
  if (input.scopedNctNumber) {
    return `One-off run for ${input.scopedNctNumber}`
  }

  switch (input.questionSelection) {
    case 'all_open_trials':
      return 'All-open-trials run'
    case 'specific_nct':
      return 'One-off run'
    default:
      return 'Eligible-queue run'
  }
}

function getRunSelectionBadgeLabel(questionSelection: TrialMonitorQuestionSelection): string {
  switch (questionSelection) {
    case 'all_open_trials':
      return 'All Open Trials'
    case 'specific_nct':
      return 'Specific NCT'
    default:
      return 'Eligible Queue'
  }
}

const monitorSettingControlClassName =
  'h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors focus:border-[#1a1a1a]'

function MonitorSettingsGroup({
  title,
  description,
  stackFields = false,
  children,
}: {
  title: string
  description: string
  stackFields?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col gap-3 border border-[#e8ddd0] bg-[#fcfaf7] p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-[#1a1a1a]">{title}</h4>
        <p className="text-xs leading-5 text-[#6f6458]">{description}</p>
      </div>
      <div className={stackFields ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
        {children}
      </div>
    </div>
  )
}

function MonitorSettingsField({
  label,
  description,
  children,
  fullWidth = false,
  inlineControl = false,
}: {
  label: string
  description: string
  children: ReactNode
  fullWidth?: boolean
  inlineControl?: boolean
}) {
  return (
    <label
      className={[
        inlineControl
          ? 'grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-3 rounded-none border border-[#e6dbce] bg-white px-3 py-3'
          : 'flex flex-col gap-2 rounded-none border border-[#e6dbce] bg-white px-3 py-3',
        fullWidth ? 'sm:col-span-2' : '',
      ].join(' ').trim()}
    >
      <div className={inlineControl ? '' : 'space-y-1'}>
        <span className="block text-sm font-medium text-[#1a1a1a]">{label}</span>
        {description ? (
          <span className="block text-xs leading-5 text-[#7b7065]">{description}</span>
        ) : null}
      </div>
      <div className={inlineControl ? 'w-full justify-self-end' : ''}>
        {children}
      </div>
    </label>
  )
}

function MonitorSettingsNumberInput({
  value,
  onChange,
  min,
  max,
  unit,
}: {
  value: string
  onChange: (value: string) => void
  min: number
  max: number
  unit?: string
}) {
  if (!unit) {
    return (
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={monitorSettingControlClassName}
      />
    )
  }

  return (
    <div className="flex items-center rounded-none border border-[#d9cdbf] bg-white transition-colors focus-within:border-[#1a1a1a]">
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full border-0 bg-transparent px-3 text-sm text-[#1a1a1a] outline-none"
      />
      <span className="shrink-0 border-l border-[#e8ddd0] bg-[#fcfaf7] px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[#7b7065]">
        {unit}
      </span>
    </div>
  )
}

export function AdminTrialOutcomeReview({
  initialConfig,
  verifierModelOptions,
  initialCandidates,
  recentRuns,
  initialEligibleQuestions,
  allOpenTrialCount,
  historyEntries,
  initialScopedNctNumber = null,
  autoRunScopedNctNumber = null,
}: Props) {
  const router = useRouter()
  const [form, setForm] = useState<ConfigFormState>(() => toFormState(initialConfig))
  const [candidates, setCandidates] = useState(initialCandidates)
  const [runs, setRuns] = useState(recentRuns)
  const [eligibleQuestions, setEligibleQuestions] = useState(initialEligibleQuestions)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [configStatusMessage, setConfigStatusMessage] = useState('Changes save automatically.')
  const [configStatusTone, setConfigStatusTone] = useState<ConfigStatusTone>('muted')
  const [lastSavedConfigSignature, setLastSavedConfigSignature] = useState(() => serializeConfigPayload(toConfigSavePayload(initialConfig)))
  const [isRunningMonitor, setIsRunningMonitor] = useState(false)
  const [isStoppingRun, setIsStoppingRun] = useState(false)
  const [scopedNctNumber, setScopedNctNumber] = useState(initialScopedNctNumber ?? '')
  const autosaveTimerRef = useRef<number | null>(null)
  const activeConfigSaveRef = useRef<Promise<void> | null>(null)
  const autoRunHandledRef = useRef(false)
  const scopedViewNctNumber = parseScopedNctNumber(initialScopedNctNumber ?? '')
  const visibleCandidates = [...(scopedViewNctNumber
    ? candidates.filter((candidate) => matchesScopedNctNumber(candidate.trial.nctNumber, scopedViewNctNumber))
    : candidates)]
    .sort(compareCandidatesForReview)
  const visibleRuns = scopedViewNctNumber
    ? runs.filter((run) => matchesScopedNctNumber(run.scopedNctNumber, scopedViewNctNumber))
    : runs
  const visibleEligibleQuestions = scopedViewNctNumber
    ? eligibleQuestions.filter((question) => matchesScopedNctNumber(question.trial.nctNumber, scopedViewNctNumber))
    : eligibleQuestions
  const visibleHistoryEntries = scopedViewNctNumber
    ? historyEntries.filter((entry) => matchesScopedNctNumber(entry.trial.nctNumber, scopedViewNctNumber))
    : historyEntries
  const activeRun = runs.find((run) => run.status === 'running') ?? null
  const isRunActive = isRunningMonitor || Boolean(activeRun)
  const isPauseRequested = isStoppingRun || Boolean(activeRun?.stopRequestedAt)

  useEffect(() => {
    if (!isRunActive) return

    const timer = window.setInterval(() => {
      router.refresh()
    }, 4000)

    return () => window.clearInterval(timer)
  }, [isRunActive, router])

  useEffect(() => {
    setForm(toFormState(initialConfig))
    setLastSavedConfigSignature(serializeConfigPayload(toConfigSavePayload(initialConfig)))
    setConfigStatusMessage('Changes save automatically.')
    setConfigStatusTone('muted')
  }, [initialConfig])

  useEffect(() => {
    setCandidates(initialCandidates)
  }, [initialCandidates])

  useEffect(() => {
    setRuns(recentRuns)
  }, [recentRuns])

  useEffect(() => {
    setEligibleQuestions(initialEligibleQuestions)
  }, [initialEligibleQuestions])

  useEffect(() => {
    setScopedNctNumber(initialScopedNctNumber ?? '')
  }, [initialScopedNctNumber])

  useEffect(() => {
    if (!isRunActive) {
      setIsStoppingRun(false)
    }
  }, [isRunActive])

  const formatRunResult = (result: TrialMonitorRunResult): string => {
    const runLabel = getRunSelectionLabel({
      questionSelection: result.questionSelection,
      scopedNctNumber: result.scopedNctNumber ?? null,
    })

    if (!result.executed) {
      if (result.reason === 'disabled') {
        return 'Trial monitor is disabled, so no run was started.'
      }
      if (result.reason === 'not_due') {
        const nextEligible = result.nextEligibleAt ? formatLocalDateTime(result.nextEligibleAt) : 'later'
        return `${runLabel} skipped because the next scheduled run is not due until ${nextEligible}.`
      }
      return `${runLabel} skipped.`
    }

    if (result.status === 'paused') {
      const base = `${runLabel} paused after scanning ${result.questionsScanned} question${result.questionsScanned === 1 ? '' : 's'} and creating ${result.candidatesCreated} queue item${result.candidatesCreated === 1 ? '' : 's'}.`
      if (result.errors.length === 0) return base
      return `${base} ${result.errors.length} question${result.errors.length === 1 ? '' : 's'} had errors before the pause.`
    }

    const base = `${runLabel} finished: scanned ${result.questionsScanned} question${result.questionsScanned === 1 ? '' : 's'} and created ${result.candidatesCreated} queue item${result.candidatesCreated === 1 ? '' : 's'}.`
    if (result.errors.length === 0) return base
    return `${base} ${result.errors.length} question${result.errors.length === 1 ? '' : 's'} had errors.`
  }

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [])

  const saveConfig = async (payload: ConfigSavePayload, signature: string) => {
    setIsSavingConfig(true)
    setConfigStatusMessage('Saving changes automatically...')
    setConfigStatusTone('saving')

    try {
      const response = await fetch('/api/admin/trial-monitor-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const responsePayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(responsePayload, 'Failed to save trial monitor settings'))
      }

      const nextConfig = responsePayload.config as TrialMonitorConfigDto
      setForm(toFormState(nextConfig))
      setLastSavedConfigSignature(signature)
      setConfigStatusMessage('All changes saved.')
      setConfigStatusTone('saved')
      router.refresh()
    } catch (saveError) {
      setConfigStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save trial monitor settings.')
      setConfigStatusTone('error')
    } finally {
      setIsSavingConfig(false)
    }
  }

  const persistConfigNow = async (payload: ConfigSavePayload, signature: string) => {
    const savePromise = saveConfig(payload, signature)
    activeConfigSaveRef.current = savePromise

    try {
      await savePromise
    } finally {
      if (activeConfigSaveRef.current === savePromise) {
        activeConfigSaveRef.current = null
      }
    }
  }

  useEffect(() => {
    const validationMessage = getConfigValidationMessage(form)
    const payload = getConfigPayloadFromForm(form)
    const signature = payload ? serializeConfigPayload(payload) : null

    if (signature === lastSavedConfigSignature) {
      if (!isSavingConfig && (configStatusTone === 'invalid' || configStatusTone === 'error')) {
        setConfigStatusMessage('Changes save automatically.')
        setConfigStatusTone('muted')
      }
      return
    }

    if (validationMessage || !payload || !signature) {
      setConfigStatusMessage(validationMessage ?? 'Enter valid settings to save automatically.')
      setConfigStatusTone('invalid')
      return
    }

    if (isSavingConfig) {
      return
    }

    setConfigStatusMessage('Saving changes automatically...')
    setConfigStatusTone('saving')

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void persistConfigNow(payload, signature)
    }, 700)

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [configStatusTone, form, isSavingConfig, lastSavedConfigSignature, router])

  const runMonitor = async (options: {
    questionSelection?: TrialMonitorQuestionSelection
    nctNumber?: string | null
  } = {}) => {
    setError(null)
    setSuccessMessage(null)
    setRunMessage(null)

    try {
      const normalizedScopedNctNumber = parseScopedNctNumber(options.nctNumber ?? '')
      const questionSelection = options.questionSelection ?? (normalizedScopedNctNumber ? 'specific_nct' : 'eligible_queue')

      if (options.nctNumber && !normalizedScopedNctNumber) {
        throw new Error('Use an NCT number like NCT01234567 for a one-off run.')
      }
      if (questionSelection === 'specific_nct' && !normalizedScopedNctNumber) {
        throw new Error('Use an NCT number like NCT01234567 for a one-off run.')
      }
      if (questionSelection !== 'specific_nct' && normalizedScopedNctNumber) {
        throw new Error('NCT numbers are only used for one-off runs.')
      }

      const validationMessage = getConfigValidationMessage(form)
      const configPayload = getConfigPayloadFromForm(form)
      const signature = configPayload ? serializeConfigPayload(configPayload) : null

      if (validationMessage || !configPayload || !signature) {
        throw new Error(validationMessage ?? 'Enter valid settings before running the monitor.')
      }

      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }

      if (activeConfigSaveRef.current) {
        await activeConfigSaveRef.current
      } else if (signature !== lastSavedConfigSignature) {
        await persistConfigNow(configPayload, signature)
      }

      setIsRunningMonitor(true)

      const response = await fetch('/api/admin/trial-monitor/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: true,
          scope: questionSelection,
          nctNumber: questionSelection === 'specific_nct' ? normalizedScopedNctNumber ?? undefined : undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to run trial monitor'))
      }

      setRunMessage(formatRunResult(payload.result as TrialMonitorRunResult))
      router.refresh()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run trial monitor')
    } finally {
      setIsRunningMonitor(false)
    }
  }

  const triggerScopedAutoRun = useEffectEvent(async (nctNumber: string) => {
    setScopedNctNumber(nctNumber)
    router.replace(`/admin/outcomes?nct=${encodeURIComponent(nctNumber)}`)
    await runMonitor({ questionSelection: 'specific_nct', nctNumber })
  })

  useEffect(() => {
    if (!autoRunScopedNctNumber || autoRunHandledRef.current) {
      return
    }

    autoRunHandledRef.current = true
    void triggerScopedAutoRun(autoRunScopedNctNumber)
  }, [autoRunScopedNctNumber, triggerScopedAutoRun])

  const reviewCandidate = async (candidateId: string, action: 'accept' | 'reject' | 'dismiss' | 'clear_for_rerun') => {
    setError(null)
    setSuccessMessage(null)
    setRunMessage(null)
    setLoadingId(candidateId)

    try {
      const response = await fetch(`/api/admin/trial-outcome-candidates/${candidateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to review oracle item'))
      }

      setCandidates((prev) => prev.filter((candidate) => candidate.id !== candidateId))
      if (action === 'clear_for_rerun') {
        setSuccessMessage('Queue item cleared. This trial will be eligible again on the next monitor run.')
      }
      router.refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Failed to review oracle item')
    } finally {
      setLoadingId(null)
    }
  }

  const deleteRun = async (runId: string) => {
    setError(null)
    setSuccessMessage(null)
    setRunMessage(null)
    setDeletingRunId(runId)

    try {
      const response = await fetch(`/api/admin/trial-monitor-runs/${runId}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to delete monitor run'))
      }

      setRuns((prev) => prev.filter((run) => run.id !== runId))
      setSuccessMessage('Monitor run deleted.')
      router.refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete monitor run')
    } finally {
      setDeletingRunId(null)
    }
  }

  const pauseMonitor = async (runId?: string) => {
    if (isStoppingRun) return

    setError(null)
    setSuccessMessage(null)
    setRunMessage('Pause requested. The current in-flight trial check will finish, then the monitor will halt.')
    setIsStoppingRun(true)

    try {
      const response = await fetch('/api/admin/trial-monitor/cancel-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runId ? { runId } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to pause trial monitor'))
      }

      const stoppedRunId = typeof payload.runId === 'string' ? payload.runId : runId ?? null
      if (stoppedRunId) {
        const stopRequestedAt = new Date().toISOString()
        setRuns((prev) => prev.map((run) => (
          run.id === stoppedRunId
            ? { ...run, stopRequestedAt }
            : run
        )))
      }

      setRunMessage(
        typeof payload.message === 'string'
          ? payload.message
          : 'Pause requested. The current in-flight trial check will finish, then the monitor will halt.'
      )
      router.refresh()
    } catch (pauseError) {
      setIsStoppingRun(false)
      setError(pauseError instanceof Error ? pauseError.message : 'Failed to pause trial monitor')
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-none border border-[#c43a2b]/35 bg-[#fff3f1] px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-none border border-[#3a8a2e]/35 bg-[#f4fbf2] px-3 py-2 text-sm text-[#2f6f24]">
          {successMessage}
        </div>
      ) : null}

      {runMessage ? (
        <div className="rounded-none border border-[#5BA5ED]/35 bg-[#f3f8fe] px-3 py-2 text-sm text-[#245f94]">
          {runMessage}
        </div>
      ) : null}

      {scopedViewNctNumber ? (
        <div className="rounded-none border border-[#d9cdbf] bg-[#fffdf9] px-3 py-2 text-sm text-[#6f665b]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Scoped Trial View</div>
              <p className="mt-1">Showing oracle data for {scopedViewNctNumber} only.</p>
            </div>
            <Link
              href="/admin/outcomes"
              className="inline-flex rounded-none border border-[#d9cdbf] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
            >
              View Full Oracle Queue
            </Link>
          </div>
        </div>
      ) : null}

      {isRunActive ? (
        <section className="rounded-none border border-[#5BA5ED]/35 bg-[#f3f8fe] p-4 text-[#245f94]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#1f5a8c]">Monitor Run In Progress</h3>
              <p className="mt-1 text-sm">
                {isPauseRequested
                  ? 'Pause requested. The monitor is finishing any in-flight trial checks before it halts.'
                  : activeRun
                    ? `${activeRun.scopedNctNumber
                      ? `Scoped to ${activeRun.scopedNctNumber}. `
                      : activeRun.questionSelection === 'all_open_trials'
                        ? 'Running across all open trials. '
                        : 'Running across the current eligible queue. '}Scanned ${activeRun.questionsScanned} question${activeRun.questionsScanned === 1 ? '' : 's'} and created ${activeRun.candidatesCreated} queue item${activeRun.candidatesCreated === 1 ? '' : 's'} so far.`
                  : 'Starting the monitor run and waiting for the first heartbeat from the server.'}
              </p>
              <p className="mt-2 text-xs text-[#5b7ea6]">
                The page refreshes automatically every few seconds while the monitor is running.
              </p>
            </div>

            <div className="flex flex-col gap-3 text-sm lg:min-w-[320px]">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-none border border-[#5BA5ED]/25 bg-white/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#5b7ea6]">Started</div>
                  <div className="mt-1 font-medium text-[#245f94]">
                    {activeRun ? formatLocalDateTime(activeRun.startedAt) : 'Starting...'}
                  </div>
                </div>
                <div className="rounded-none border border-[#5BA5ED]/25 bg-white/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#5b7ea6]">Last Heartbeat</div>
                  <div className="mt-1 font-medium text-[#245f94]">
                    {activeRun ? formatLocalDateTime(activeRun.updatedAt) : 'Waiting...'}
                  </div>
                </div>
                <div className="rounded-none border border-[#5BA5ED]/25 bg-white/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#5b7ea6]">Queue Items Created</div>
                  <div className="mt-1 font-medium text-[#245f94]">
                    {activeRun ? activeRun.candidatesCreated : '—'}
                  </div>
                </div>
                <div className="rounded-none border border-[#5BA5ED]/25 bg-white/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#5b7ea6]">Questions Scanned</div>
                  <div className="mt-1 font-medium text-[#245f94]">
                    {activeRun ? activeRun.questionsScanned : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-3">
        <div className="flex flex-col gap-2.5">
          <div className="max-w-3xl">
            <h3 className="text-base font-semibold text-[#1a1a1a]">Monitor settings</h3>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <MonitorSettingsGroup
              title="Schedule"
              description=""
              stackFields
            >
              <MonitorSettingsField
                label="Enabled"
                description="Turns the automatic trial monitor on or off."
              >
                <select
                  value={form.enabled ? 'true' : 'false'}
                  onChange={(event) => {
                    const nextEnabled = event.target.value === 'true'
                    setForm((current) => ({ ...current, enabled: nextEnabled }))
                  }}
                  className={monitorSettingControlClassName}
                >
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </MonitorSettingsField>

              <MonitorSettingsField
                label="Run every"
                description="How often the scheduled Railway job should scan for new oracle work."
              >
                <MonitorSettingsNumberInput
                  value={form.runIntervalHours}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, runIntervalHours: value }))
                  }}
                  min={1}
                  max={168}
                  unit="hours"
                />
              </MonitorSettingsField>

              <MonitorSettingsField
                label="Scan ahead"
                description=""
              >
                <MonitorSettingsNumberInput
                  value={form.lookaheadDays}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, lookaheadDays: value }))
                  }}
                  min={0}
                  max={365}
                  unit="days"
                />
              </MonitorSettingsField>
            </MonitorSettingsGroup>

            <MonitorSettingsGroup
              title="Processing"
              description=""
              stackFields
            >
              <MonitorSettingsField
                label="Question cap"
                description=""
                inlineControl
              >
                <MonitorSettingsNumberInput
                  value={form.maxQuestionsPerRun}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, maxQuestionsPerRun: value }))
                  }}
                  min={1}
                  max={500}
                />
              </MonitorSettingsField>

              <MonitorSettingsField
                label="Scheduled worker"
                description=""
                inlineControl
              >
                <MonitorSettingsNumberInput
                  value={form.cronProcessingConcurrency}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, cronProcessingConcurrency: value }))
                  }}
                  min={1}
                  max={12}
                />
              </MonitorSettingsField>

              <MonitorSettingsField
                label="Manual worker"
                description=""
                inlineControl
              >
                <MonitorSettingsNumberInput
                  value={form.manualProcessingConcurrency}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, manualProcessingConcurrency: value }))
                  }}
                  min={1}
                  max={12}
                />
              </MonitorSettingsField>
            </MonitorSettingsGroup>

            <MonitorSettingsGroup
              title="Verification"
              description=""
            >
              <MonitorSettingsField
                label="Verifier model"
                description=""
                fullWidth
              >
                <select
                  value={form.verifierModelKey}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, verifierModelKey: event.target.value }))
                  }}
                  className={monitorSettingControlClassName}
                >
                  {verifierModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </MonitorSettingsField>
            </MonitorSettingsGroup>
          </div>
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Monitor Actions</h3>
            {isRunActive ? (
              <p className="mt-1 text-xs text-[#8a8075]">
                {isPauseRequested
                  ? 'Pause requested. Progress above updates automatically while the current in-flight trial checks finish.'
                  : 'The monitor is currently running. Progress above updates automatically and new queue items will land here once the run finishes.'}
              </p>
            ) : (
              <p className="mt-1 text-xs text-[#8a8075]">
                Run the Phase 2 oracle monitor manually to refresh the review queue without waiting for Railway cron.
              </p>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
              <div className="flex h-full flex-col gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Eligible Queue</div>
                  <p className="mt-1 text-xs leading-5 text-[#8a8075]">
                    Scan only the trials that are currently due under the lookahead and overdue recheck rules.
                  </p>
                </div>
                <div className="mt-auto space-y-2">
                  <button
                    type="button"
                    onClick={() => void runMonitor({ questionSelection: 'eligible_queue' })}
                    disabled={isRunActive || isSavingConfig}
                    className="w-full rounded-none bg-[#1a1a1a] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRunActive ? 'Monitor Running...' : isSavingConfig ? 'Saving Settings...' : 'Run Eligible Queue'}
                  </button>
                  {isRunActive ? (
                    <button
                      type="button"
                      onClick={() => void pauseMonitor(activeRun?.id ?? undefined)}
                      disabled={isPauseRequested}
                      className="w-full rounded-none border border-[#d2ba8b] bg-[#fff9ef] px-3 py-2 text-xs font-medium text-[#8b6b21] transition-colors hover:bg-[#fff2d6] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isPauseRequested ? 'Pause Requested...' : 'Pause After Current Check'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
              <div className="flex h-full flex-col gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">All Open Trials</div>
                  <p className="mt-1 text-xs leading-5 text-[#8a8075]">
                    Bypass the queue filters and scan every open trial with a live pending outcome question.
                  </p>
                </div>
                <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Open Right Now</div>
                  <div className="mt-1 text-lg font-semibold text-[#1a1a1a]">{allOpenTrialCount}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void runMonitor({ questionSelection: 'all_open_trials' })}
                  disabled={isRunActive || isSavingConfig}
                  className="mt-auto w-full rounded-none border border-[#1a1a1a] bg-white px-3 py-2 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run All Open Trials
                </button>
              </div>
            </div>

            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">One-Off NCT</div>
                  <p className="mt-1 text-xs leading-5 text-[#8a8075]">
                    Bypass the normal lookahead and recheck window, then scan only the live pending trial question for that trial.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={scopedNctNumber}
                    onChange={(event) => {
                      setScopedNctNumber(normalizeScopedNctNumberInput(event.target.value))
                    }}
                    placeholder="NCT01234567"
                    inputMode="text"
                    spellCheck={false}
                    className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm uppercase tracking-[0.06em] text-[#1a1a1a] outline-none transition-colors placeholder:tracking-normal focus:border-[#1a1a1a]"
                  />
                  <button
                    type="button"
                    onClick={() => void runMonitor({ questionSelection: 'specific_nct', nctNumber: scopedNctNumber })}
                    disabled={isRunActive || isSavingConfig || !parseScopedNctNumber(scopedNctNumber)}
                    className="rounded-none border border-[#d9cdbf] bg-white px-3 py-2 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Run
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Eligible Queue</h3>
            <p className="mt-1 text-xs leading-5 text-[#8a8075]">
              These are the trials the monitor would scan right now if you run the eligible queue with the current settings.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Eligible Now</div>
              <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{visibleEligibleQuestions.length}</div>
            </div>
            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">All Open Trials</div>
              <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{allOpenTrialCount}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {visibleEligibleQuestions.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
              {scopedViewNctNumber
                ? 'This trial is not currently eligible for the next monitor pass.'
                : 'No trial questions are currently eligible for the next monitor pass.'}
            </div>
          ) : visibleEligibleQuestions.map((question) => {
            const normalizedQuestionNctNumber = parseScopedNctNumber(question.trial.nctNumber ?? '')

            return (
            <div key={question.id} className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#1a1a1a]">{question.trial.shortTitle}</div>
                  <div className="mt-1 text-xs text-[#8a8075]">
                    {question.trial.nctNumber ?? 'No NCT'}
                  </div>
                  <div className="mt-2 text-sm text-[#5b5148]">{question.prompt}</div>
                </div>
                <div className="grid gap-2 text-right text-sm lg:min-w-[280px]">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Primary Completion</div>
                    <div className="mt-1 font-medium text-[#1a1a1a]">{formatLocalDateTime(question.trial.estPrimaryCompletionDate)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Last Checked</div>
                    <div className="mt-1 font-medium text-[#1a1a1a]">{formatLocalDateTime(question.trial.lastMonitoredAt)}</div>
                  </div>
                  {normalizedQuestionNctNumber ? (
                    <button
                      type="button"
                      onClick={() => {
                        setScopedNctNumber(normalizedQuestionNctNumber)
                        void runMonitor({ questionSelection: 'specific_nct', nctNumber: normalizedQuestionNctNumber })
                      }}
                      disabled={isRunActive || isSavingConfig}
                      className="rounded-none border border-[#d9cdbf] bg-white px-3 py-2 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Run Just This NCT
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Oracle Queue</h3>
            <p className="mt-1 text-xs text-[#8a8075]">
              Settlement items only resolve a market after admin acceptance. Evidence-only items can be dismissed without settling.
            </p>
          </div>
          <div className="text-sm text-[#8a8075]">{visibleCandidates.length} pending</div>
        </div>

        <div className="mt-4 space-y-4">
          {visibleCandidates.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
              {scopedViewNctNumber
                ? (
                    isRunActive
                      ? 'No pending oracle items for this trial yet. This run is still in progress, and new queue items will appear here automatically if the verifier finds any.'
                      : 'No pending oracle items for this trial yet. Run the monitor to pull fresh evidence and populate this queue.'
                  )
                : (
                    isRunActive
                      ? 'No pending oracle items yet. This run is still in progress, and new queue items will appear here automatically if the verifier finds any.'
                      : 'No pending oracle items yet. Run the monitor to pull fresh evidence and populate this queue.'
                  )}
            </div>
          ) : visibleCandidates.map((candidate) => (
            <article key={candidate.id} className="rounded-none border border-[#e8ddd0] bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {candidate.marketId ? (
                      <Link
                        href={`/trials/${encodeURIComponent(candidate.marketId)}`}
                        className="text-sm font-semibold text-[#1a1a1a] transition-colors hover:text-[#5b5148] hover:underline"
                      >
                        {candidate.trial.shortTitle}
                      </Link>
                    ) : (
                      <h4 className="text-sm font-semibold text-[#1a1a1a]">{candidate.trial.shortTitle}</h4>
                    )}
                    {(() => {
                      const badge = getCandidateBadge(candidate)
                      return (
                        <span className={`rounded-none px-2 py-1 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      )
                    })()}
                    {candidate.confidence > 0 ? (
                      <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 text-xs text-[#8a8075]">
                        {Math.round(candidate.confidence * 100)}% confidence
                      </span>
                    ) : null}
                    <span className="rounded-none border border-[#d8ccb9] bg-[#faf7f2] px-2 py-1 text-xs text-[#7a7065]">
                      {candidate.verifierModelLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#8a8075]">
                    {candidate.trial.sponsorName}{candidate.trial.sponsorTicker ? ` (${candidate.trial.sponsorTicker})` : ''} · {candidate.trial.exactPhase}
                    {candidate.trial.nctNumber ? ` · ${candidate.trial.nctNumber}` : ''}
                  </p>
                  <p className="mt-2 text-sm text-[#6f665b]">{candidate.questionPrompt}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#5b5148]">{candidate.summary}</p>
                  <p className="mt-2 text-xs text-[#8a8075]">
                    Primary completion {formatLocalDateTime(candidate.trial.estPrimaryCompletionDate)} · Queued {formatLocalDateTime(candidate.createdAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {isSettlementCandidate(candidate) ? (
                    <>
                      <button
                        type="button"
                        disabled={loadingId === candidate.id}
                        onClick={() => reviewCandidate(candidate.id, 'clear_for_rerun')}
                        className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Clear for Rerun
                      </button>
                      <button
                        type="button"
                        disabled={loadingId === candidate.id}
                        onClick={() => reviewCandidate(candidate.id, 'accept')}
                        className="rounded-none bg-[#3a8a2e] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2f6f24] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={loadingId === candidate.id}
                        onClick={() => reviewCandidate(candidate.id, 'reject')}
                        className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={loadingId === candidate.id}
                        onClick={() => reviewCandidate(candidate.id, 'clear_for_rerun')}
                        className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Clear for Rerun
                      </button>
                      <button
                        type="button"
                        disabled={loadingId === candidate.id}
                        onClick={() => reviewCandidate(candidate.id, 'dismiss')}
                        className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {candidate.evidence.map((evidence) => (
                  <a
                    key={evidence.id}
                    href={evidence.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-4 transition-colors hover:bg-[#f5eee5]"
                  >
                    <div className="text-xs uppercase tracking-[0.08em] text-[#b5aa9e]">{evidence.sourceType}</div>
                    <div className="mt-1 text-base font-medium leading-7 text-[#1a1a1a]">{evidence.title}</div>
                    <div className="mt-1 break-all text-xs text-[#8a8075]">
                      {evidence.domain} · {formatLocalDateTime(evidence.publishedAt)}
                    </div>
                    <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#6f665b]">{evidence.excerpt}</div>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <AdminTrialOutcomeHistory entries={visibleHistoryEntries} />

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Recent Monitor Runs</h3>
        <div className="mt-4 space-y-3">
          {visibleRuns.length === 0 ? (
            <div className="text-sm text-[#8a8075]">
              {scopedViewNctNumber ? 'No monitor runs for this trial yet.' : 'No monitor runs yet.'}
            </div>
          ) : visibleRuns.map((run) => (
            <div key={run.id} className="rounded-none border border-[#e8ddd0] bg-white p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 text-xs font-medium text-[#5f564c]">
                      {run.triggerSource === 'manual' ? 'Manual' : 'Scheduled'}
                    </span>
                    <span className="rounded-none border border-[#d8ccb9] bg-[#fffdf9] px-2 py-1 text-xs font-medium text-[#7a7065]">
                      {getRunSelectionBadgeLabel(run.questionSelection)}
                    </span>
                    {run.scopedNctNumber ? (
                      <span className="rounded-none border border-[#d8ccb9] bg-[#fffdf9] px-2 py-1 text-xs font-medium text-[#7a7065]">
                        {run.scopedNctNumber}
                      </span>
                    ) : null}
                    <span className={`rounded-none px-2 py-1 text-xs font-medium ${getRunStatusTone(run)}`}>
                      {getRunStatusLabel(run)}
                    </span>
                    <span className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-2 py-1 text-xs font-medium text-[#6f665b]">
                      {run.verifierModelLabel}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8a8075]">
                    <span>Started {formatLocalDateTime(run.startedAt)}</span>
                    {run.status === 'running' ? (
                      <span>Last heartbeat {formatLocalDateTime(run.updatedAt)}</span>
                    ) : null}
                    {run.status === 'running' && run.stopRequestedAt ? (
                      <span>Pause requested {formatLocalDateTime(run.stopRequestedAt)}</span>
                    ) : null}
                    {run.completedAt ? (
                      <span>Completed {formatLocalDateTime(run.completedAt)}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-stretch gap-2">
                  <div className="flex min-h-[56px] min-w-[104px] flex-col justify-center rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-2.5 py-2 text-right">
                    <div className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                      <div className="text-lg font-semibold text-[#1a1a1a]">{run.questionsScanned}</div>
                      <div className="text-[10px] uppercase tracking-[0.06em] text-[#8a8075]">Scanned</div>
                    </div>
                  </div>
                  <div className="flex min-h-[56px] min-w-[122px] flex-col justify-center rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-2.5 py-2 text-right">
                    <div className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                      <div className="text-lg font-semibold text-[#1a1a1a]">{run.candidatesCreated}</div>
                      <div className="text-[10px] uppercase tracking-[0.06em] text-[#8a8075]">Queue Items</div>
                    </div>
                  </div>
                  {run.status === 'running' ? (
                    <button
                      type="button"
                      disabled={run.stopRequestedAt != null || (isPauseRequested && activeRun?.id === run.id)}
                      onClick={() => void pauseMonitor(run.id)}
                      className="flex min-h-[56px] items-center justify-center rounded-none border border-[#d2ba8b] bg-[#fff9ef] px-4 py-2 text-xs font-medium text-[#8b6b21] transition-colors hover:bg-[#fff2d6] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {run.stopRequestedAt || (isPauseRequested && activeRun?.id === run.id) ? 'Pause Requested...' : 'Pause'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={deletingRunId === run.id}
                      onClick={() => deleteRun(run.id)}
                      className="flex min-h-[56px] items-center justify-center rounded-none border border-[#f0b7b1] bg-[#fff8f7] px-4 py-2 text-xs font-medium text-[#b83f34] transition-colors hover:bg-[#fff1ef] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingRunId === run.id ? 'Deleting...' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
              {run.errorSummary ? (
                <div className="mt-3 rounded-none border border-[#c43a2b]/25 bg-[#fff5f4] px-3 py-2">
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8d2c22]">Issues</div>
                  <div className="mt-2 space-y-1">
                    {splitRunErrors(run.errorSummary).map((issue, index) => (
                      <p key={`${run.id}-issue-${index}`} className="text-xs leading-5 text-[#8d2c22]">
                        {issue}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
