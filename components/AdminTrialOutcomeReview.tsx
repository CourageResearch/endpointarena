'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
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

type RunRow = {
  id: string
  triggerSource: 'cron' | 'manual'
  status: 'running' | 'completed' | 'failed'
  verifierModelLabel: string
  scopedNctNumber: string | null
  questionsScanned: number
  candidatesCreated: number
  errorSummary: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
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
  historyEntries: AdminTrialOutcomeHistoryEntry[]
}

type ConfigFormState = {
  enabled: boolean
  runIntervalHours: string
  lookaheadDays: string
  maxQuestionsPerRun: string
  verifierModelKey: string
}

type ConfigSavePayload = {
  enabled: boolean
  runIntervalHours: number
  lookaheadDays: number
  maxQuestionsPerRun: number
  verifierModelKey: string
}

type TrialMonitorRunResult = {
  executed: boolean
  reason?: 'disabled' | 'not_due'
  questionsScanned: number
  candidatesCreated: number
  errors: string[]
  nextEligibleAt?: string
  scopedNctNumber?: string
}

function toFormState(config: TrialMonitorConfigDto): ConfigFormState {
  return {
    enabled: config.enabled,
    runIntervalHours: String(config.runIntervalHours),
    lookaheadDays: String(config.lookaheadDays),
    maxQuestionsPerRun: String(config.maxQuestionsPerRun),
    verifierModelKey: config.verifierModelKey,
  }
}

function toConfigSavePayload(config: TrialMonitorConfigDto): ConfigSavePayload {
  return {
    enabled: config.enabled,
    runIntervalHours: config.runIntervalHours,
    lookaheadDays: config.lookaheadDays,
    maxQuestionsPerRun: config.maxQuestionsPerRun,
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
  if (!form.verifierModelKey.trim()) {
    return 'Verifier model is required.'
  }
  return null
}

function getConfigPayloadFromForm(form: ConfigFormState): ConfigSavePayload | null {
  const runIntervalHours = parseBoundedInteger(form.runIntervalHours, 1, 168)
  const lookaheadDays = parseBoundedInteger(form.lookaheadDays, 0, 365)
  const maxQuestionsPerRun = parseBoundedInteger(form.maxQuestionsPerRun, 1, 500)
  const verifierModelKey = form.verifierModelKey.trim()

  if (
    runIntervalHours == null ||
    lookaheadDays == null ||
    maxQuestionsPerRun == null ||
    !verifierModelKey
  ) {
    return null
  }

  return {
    enabled: form.enabled,
    runIntervalHours,
    lookaheadDays,
    maxQuestionsPerRun,
    verifierModelKey,
  }
}

function getRunStatusTone(status: RunRow['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-[#3a8a2e]/10 text-[#2f6f24]'
    case 'failed':
      return 'bg-[#EF6F67]/10 text-[#8d2c22]'
    default:
      return 'bg-[#5BA5ED]/10 text-[#265f8f]'
  }
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

export function AdminTrialOutcomeReview({
  initialConfig,
  verifierModelOptions,
  initialCandidates,
  recentRuns,
  initialEligibleQuestions,
  historyEntries,
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
  const [configStatusTone, setConfigStatusTone] = useState<'muted' | 'saving' | 'saved' | 'invalid' | 'error'>('muted')
  const [lastSavedConfigSignature, setLastSavedConfigSignature] = useState(() => serializeConfigPayload(toConfigSavePayload(initialConfig)))
  const [isRunningMonitor, setIsRunningMonitor] = useState(false)
  const [scopedNctNumber, setScopedNctNumber] = useState('')
  const autosaveTimerRef = useRef<number | null>(null)
  const activeConfigSaveRef = useRef<Promise<void> | null>(null)
  const activeRun = runs.find((run) => run.status === 'running') ?? null
  const isRunActive = isRunningMonitor || Boolean(activeRun)

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

  const formatRunResult = (result: TrialMonitorRunResult): string => {
    const runLabel = result.scopedNctNumber
      ? `One-off run for ${result.scopedNctNumber}`
      : 'Run'

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

  const runMonitor = async (options: { nctNumber?: string | null } = {}) => {
    setError(null)
    setSuccessMessage(null)
    setRunMessage(null)

    try {
      const normalizedScopedNctNumber = parseScopedNctNumber(options.nctNumber ?? '')
      if (options.nctNumber && !normalizedScopedNctNumber) {
        throw new Error('Use an NCT number like NCT01234567 for a one-off run.')
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
          nctNumber: normalizedScopedNctNumber ?? undefined,
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
        throw new Error(getApiErrorMessage(payload, 'Failed to review outcome item'))
      }

      setCandidates((prev) => prev.filter((candidate) => candidate.id !== candidateId))
      if (action === 'clear_for_rerun') {
        setSuccessMessage('Queue item cleared. This trial will be eligible again on the next monitor run.')
      }
      router.refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Failed to review outcome item')
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

      {isRunActive ? (
        <section className="rounded-none border border-[#5BA5ED]/35 bg-[#f3f8fe] p-4 text-[#245f94]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#1f5a8c]">Monitor Run In Progress</h3>
              <p className="mt-1 text-sm">
                {activeRun
                  ? `${activeRun.scopedNctNumber ? `Scoped to ${activeRun.scopedNctNumber}. ` : ''}Scanned ${activeRun.questionsScanned} question${activeRun.questionsScanned === 1 ? '' : 's'} and created ${activeRun.candidatesCreated} queue item${activeRun.candidatesCreated === 1 ? '' : 's'} so far.`
                  : 'Starting the monitor run and waiting for the first heartbeat from the server.'}
              </p>
              <p className="mt-2 text-xs text-[#5b7ea6]">
                The page refreshes automatically every few seconds while the monitor is running.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm lg:min-w-[320px]">
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
        </section>
      ) : null}

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-3">
        <div className="flex flex-col gap-2.5">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Monitor Settings</h3>
          </div>

          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.93fr)_minmax(0,0.93fr)_minmax(0,0.93fr)_minmax(0,1.41fr)]">
            <label className="flex flex-col gap-2 border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-2.5">
              <div className="space-y-0.5">
                <span className="block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Monitor Enabled</span>
              </div>
              <select
                value={form.enabled ? 'true' : 'false'}
                onChange={(event) => {
                  const nextEnabled = event.target.value === 'true'
                  setForm((current) => ({ ...current, enabled: nextEnabled }))
                }}
                className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors focus:border-[#1a1a1a]"
              >
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-2.5">
              <div className="space-y-0.5">
                <span className="block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Cron Interval</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={form.runIntervalHours}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, runIntervalHours: event.target.value }))
                  }}
                  className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors focus:border-[#1a1a1a]"
                />
                <span className="shrink-0 pt-0.5 text-[11px] uppercase tracking-[0.08em] text-[#b0a497]">Hrs</span>
              </div>
            </label>

            <label className="flex flex-col gap-2 border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-2.5">
              <div className="space-y-0.5">
                <span className="block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Lookahead Window</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form.lookaheadDays}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, lookaheadDays: event.target.value }))
                  }}
                  className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors focus:border-[#1a1a1a]"
                />
                <span className="shrink-0 pt-0.5 text-[11px] uppercase tracking-[0.08em] text-[#b0a497]">Days</span>
              </div>
            </label>

            <label className="flex flex-col gap-2 border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-2.5">
              <div className="space-y-0.5">
                <span className="block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Max Questions / Run</span>
              </div>
              <input
                type="number"
                min={1}
                max={500}
                value={form.maxQuestionsPerRun}
                onChange={(event) => {
                  setForm((current) => ({ ...current, maxQuestionsPerRun: event.target.value }))
                }}
                className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors focus:border-[#1a1a1a]"
              />
            </label>

            <label className="flex flex-col gap-2 border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-2.5">
              <div className="space-y-0.5">
                <span className="block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Verifier Model</span>
              </div>
              <select
                value={form.verifierModelKey}
                onChange={(event) => {
                  setForm((current) => ({ ...current, verifierModelKey: event.target.value }))
                }}
                className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors focus:border-[#1a1a1a]"
              >
                {verifierModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="border-t border-[#efe5d8] pt-2">
            <p
              className={[
                'text-xs',
                configStatusTone === 'saving' ? 'text-[#8a8075]' : '',
                configStatusTone === 'saved' ? 'text-[#2f6f24]' : '',
                configStatusTone === 'invalid' ? 'text-[#8b6b21]' : '',
                configStatusTone === 'error' ? 'text-[#8d2c22]' : '',
                configStatusTone === 'muted' ? 'text-[#8a8075]' : '',
              ].join(' ').trim()}
            >
              {configStatusMessage}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Monitor Actions</h3>
            {isRunActive ? (
              <p className="mt-1 text-xs text-[#8a8075]">
                The monitor is currently running. Progress above updates automatically and new queue items will land here once the run finishes.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[#8a8075]">
                Run the Phase 2 outcome monitor manually to refresh the review queue without waiting for Railway cron.
              </p>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
              <div className="flex h-full flex-col gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Full Run</div>
                  <p className="mt-1 text-xs leading-5 text-[#8a8075]">
                    Run the full Phase 2 outcome monitor across the current eligible queue.
                  </p>
                </div>
                <div className="mt-auto">
                  <button
                    type="button"
                    onClick={() => void runMonitor()}
                    disabled={isRunActive || isSavingConfig}
                    className="w-full rounded-none bg-[#1a1a1a] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRunActive ? 'Monitor Running...' : isSavingConfig ? 'Saving Settings...' : 'Run Full Monitor'}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">One-Off NCT</div>
                  <p className="mt-1 text-xs leading-5 text-[#8a8075]">
                    Bypass the normal lookahead and recheck window, then scan only the live pending outcome question for that trial.
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
                    onClick={() => void runMonitor({ nctNumber: scopedNctNumber })}
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
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Next Scan Queue</h3>
            <p className="mt-1 text-xs leading-5 text-[#8a8075]">
              These are the trial questions the monitor would scan right now using the current settings.
            </p>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Queued Now</div>
            <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{eligibleQuestions.length}</div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {eligibleQuestions.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
              No trial questions are currently eligible for the next monitor pass.
            </div>
          ) : eligibleQuestions.map((question) => {
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
                        void runMonitor({ nctNumber: normalizedQuestionNctNumber })
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
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Review Queue</h3>
            <p className="mt-1 text-xs text-[#8a8075]">
              Settlement items only resolve a market after admin acceptance. Evidence-only items can be dismissed without settling.
            </p>
          </div>
          <div className="text-sm text-[#8a8075]">{candidates.length} pending</div>
        </div>

        <div className="mt-4 space-y-4">
          {candidates.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
              {isRunActive
                ? 'No pending review items yet. This run is still in progress, and new queue items will appear here automatically if the verifier finds any.'
                : 'No pending review items yet. Run the monitor to pull fresh evidence and populate this queue.'}
            </div>
          ) : candidates.map((candidate) => (
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

      <AdminTrialOutcomeHistory entries={historyEntries} />

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Recent Monitor Runs</h3>
        <div className="mt-4 space-y-3">
          {runs.length === 0 ? (
            <div className="text-sm text-[#8a8075]">No monitor runs yet.</div>
          ) : runs.map((run) => (
            <div key={run.id} className="rounded-none border border-[#e8ddd0] bg-white p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 text-xs font-medium text-[#5f564c]">
                      {run.triggerSource === 'manual' ? 'Manual' : 'Scheduled'}
                    </span>
                    {run.scopedNctNumber ? (
                      <span className="rounded-none border border-[#d8ccb9] bg-[#fffdf9] px-2 py-1 text-xs font-medium text-[#7a7065]">
                        {run.scopedNctNumber}
                      </span>
                    ) : null}
                    <span className={`rounded-none px-2 py-1 text-xs font-medium ${getRunStatusTone(run.status)}`}>
                      {run.status === 'running' ? 'Running' : run.status === 'failed' ? 'Failed' : 'Completed'}
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
                  <button
                    type="button"
                    disabled={run.status === 'running' || deletingRunId === run.id}
                    onClick={() => deleteRun(run.id)}
                    className="flex min-h-[56px] items-center justify-center rounded-none border border-[#f0b7b1] bg-[#fff8f7] px-4 py-2 text-xs font-medium text-[#b83f34] transition-colors hover:bg-[#fff1ef] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingRunId === run.id ? 'Deleting...' : 'Delete'}
                  </button>
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
