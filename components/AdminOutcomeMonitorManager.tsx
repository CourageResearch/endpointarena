'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'
import { MODEL_IDS, MODEL_INFO } from '@/lib/constants'
import { MetadataInlineInput } from '@/components/MetadataInlineInput'

export interface EventMonitorConfigDto {
  enabled: boolean
  runIntervalHours: number
  hardLookaheadDays: number
  softLookaheadDays: number
  overdueRecheckHours: number
  maxEventsPerRun: number
  verifierModelKey: string
  minCandidateConfidence: number
  createdAt: string
  updatedAt: string
}

export interface OutcomeCandidateDto {
  id: string
  proposedOutcome: 'Approved' | 'Rejected'
  proposedOutcomeDate: string | null
  confidence: number
  summary: string
  verifierModelKey: string
  createdAt: string
  event: {
    id: string
    companyName: string
    drugName: string
    applicationType: string
    decisionDate: string
    decisionDateKind: 'hard' | 'soft'
  }
  evidence: Array<{
    id: string
    sourceType: 'fda' | 'sponsor' | 'stored_source' | 'web_search'
    title: string
    url: string
    publishedAt: string | null
    excerpt: string
    domain: string
  }>
}

export interface EventMonitorRunDto {
  id: string
  triggerSource: 'cron' | 'manual'
  status: 'running' | 'completed' | 'failed'
  eventsScanned: number
  candidatesCreated: number
  errorSummary: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
}

export interface OverdueSoftEventDto {
  id: string
  companyName: string
  drugName: string
  applicationType: string
  decisionDate: string
  decisionDateKind: 'hard' | 'soft'
  lastMonitoredAt: string | null
}

interface Props {
  initialConfig: EventMonitorConfigDto
  initialCandidates: OutcomeCandidateDto[]
  recentRuns: EventMonitorRunDto[]
  overdueSoftEvents: OverdueSoftEventDto[]
}

type ConfigFormState = {
  enabled: boolean
  runIntervalHours: string
  hardLookaheadDays: string
  softLookaheadDays: string
  overdueRecheckHours: string
  maxEventsPerRun: string
  verifierModelKey: string
  minCandidateConfidence: string
}

function toFormState(config: EventMonitorConfigDto): ConfigFormState {
  return {
    enabled: config.enabled,
    runIntervalHours: String(config.runIntervalHours),
    hardLookaheadDays: String(config.hardLookaheadDays),
    softLookaheadDays: String(config.softLookaheadDays),
    overdueRecheckHours: String(config.overdueRecheckHours),
    maxEventsPerRun: String(config.maxEventsPerRun),
    verifierModelKey: config.verifierModelKey,
    minCandidateConfidence: String(config.minCandidateConfidence),
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return 'N/A'
  return new Date(value).toLocaleString('en-US', { timeZone: 'UTC' })
}

function formatDateOnly(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatRunResult(result: {
  executed: boolean
  reason?: 'disabled' | 'not_due'
  eventsScanned: number
  candidatesCreated: number
  errors: string[]
  nextEligibleAt?: string
}): string {
  if (!result.executed) {
    if (result.reason === 'disabled') {
      return 'Monitor is disabled, so no run was started.'
    }
    if (result.reason === 'not_due') {
      const nextEligible = result.nextEligibleAt ? formatDateTime(result.nextEligibleAt) : 'later'
      return `Monitor skipped because the next scheduled run is not due until ${nextEligible} UTC.`
    }
    return 'Monitor skipped.'
  }

  const base = `Run finished: scanned ${result.eventsScanned} event${result.eventsScanned === 1 ? '' : 's'} and created ${result.candidatesCreated} new candidate${result.candidatesCreated === 1 ? '' : 's'}.`
  if (result.errors.length === 0) return base
  return `${base} ${result.errors.length} event${result.errors.length === 1 ? '' : 's'} had errors.`
}

const VERIFIER_MODEL_OPTIONS = MODEL_IDS.map((modelId) => ({
  value: modelId,
  label: `${MODEL_INFO[modelId].fullName} (${MODEL_INFO[modelId].provider})`,
}))

export function AdminOutcomeMonitorManager({
  initialConfig,
  initialCandidates,
  recentRuns,
  overdueSoftEvents,
}: Props) {
  const router = useRouter()
  const activeRun = recentRuns.find((run) => run.status === 'running') ?? null
  const [config, setConfig] = useState(initialConfig)
  const [form, setForm] = useState<ConfigFormState>(() => toFormState(initialConfig))
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [actingCandidateId, setActingCandidateId] = useState<string | null>(null)
  const [candidateNotes, setCandidateNotes] = useState<Record<string, string>>({})
  const [isRefreshing, startRefresh] = useTransition()

  const refreshPage = () => {
    startRefresh(() => {
      router.refresh()
    })
  }

  const saveConfig = async () => {
    setError(null)
    setSuccessMessage(null)
    setRunMessage(null)
    setIsSavingConfig(true)

    try {
      const payload = {
        enabled: form.enabled,
        runIntervalHours: Number(form.runIntervalHours),
        hardLookaheadDays: Number(form.hardLookaheadDays),
        softLookaheadDays: Number(form.softLookaheadDays),
        overdueRecheckHours: Number(form.overdueRecheckHours),
        maxEventsPerRun: Number(form.maxEventsPerRun),
        verifierModelKey: form.verifierModelKey,
        minCandidateConfidence: Number(form.minCandidateConfidence),
      }

      const response = await fetch('/api/admin/event-monitor-config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to save event monitor settings'))
      }

      const nextConfig = data.config as EventMonitorConfigDto
      setConfig(nextConfig)
      setForm(toFormState(nextConfig))
      setSuccessMessage('Event monitor settings saved.')
      refreshPage()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save event monitor settings')
    } finally {
      setIsSavingConfig(false)
    }
  }

  const runMonitor = async () => {
    setError(null)
    setSuccessMessage(null)
    setRunMessage(null)
    setIsRunning(true)

    try {
      const response = await fetch('/api/admin/event-monitor/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: true }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to run event monitor'))
      }

      setRunMessage(formatRunResult(data.result))
      refreshPage()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run event monitor')
    } finally {
      setIsRunning(false)
    }
  }

  const updateEventField = async (
    eventId: string,
    field: 'decisionDate' | 'decisionDateKind',
    value: string,
  ) => {
    setError(null)
    setSuccessMessage(null)

    const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [field]: value }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(getApiErrorMessage(data, `Failed to update ${field}`))
    }

    refreshPage()
  }

  const actOnCandidate = async (candidateId: string, action: 'accept' | 'reject' | 'supersede') => {
    setError(null)
    setSuccessMessage(null)
    setActingCandidateId(candidateId)

    try {
      const response = await fetch(`/api/admin/outcome-candidates/${candidateId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          reviewNotes: candidateNotes[candidateId] ?? '',
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, `Failed to ${action} candidate`))
      }

      setSuccessMessage(
        action === 'accept'
          ? 'Candidate accepted and event outcome updated.'
          : action === 'reject'
            ? 'Candidate rejected.'
            : 'Candidate marked as superseded.',
      )
      refreshPage()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${action} candidate`)
    } finally {
      setActingCandidateId(null)
    }
  }

  const updatedLabel = formatDateTime(config.updatedAt)

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-none border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {successMessage}
        </div>
      ) : null}

      {runMessage ? (
        <div className="rounded-none border border-[#c9a227]/40 bg-[#c9a227]/10 px-3 py-2 text-sm text-[#6b5513]">
          {runMessage}
        </div>
      ) : null}

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a1a]">Monitor Settings</h2>
            <p className="mt-1 text-xs text-[#8a8075]">
              Railway can hit the internal cron endpoint hourly while these settings control actual execution cadence and review thresholds.
            </p>
            {activeRun ? (
              <p className="mt-2 text-xs text-[#8a8075]">
                A monitor run is active. Last heartbeat: {formatDateTime(activeRun.updatedAt)} UTC.
              </p>
            ) : (
              <p className="mt-2 text-xs text-[#8a8075]">
                Manual runs can take several minutes because each pending event gets a web-backed verifier pass.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runMonitor}
              disabled={isRunning || isRefreshing || Boolean(activeRun)}
              className="rounded-none border border-[#1a1a1a] bg-[#1a1a1a] px-4 py-2 text-sm text-white hover:bg-[#333] disabled:opacity-50"
            >
              {activeRun ? 'Run In Progress' : isRunning ? 'Running...' : 'Run Now'}
            </button>
            <button
              type="button"
              onClick={saveConfig}
              disabled={isSavingConfig || isRefreshing}
              className="rounded-none border border-[#e8ddd0] bg-white px-4 py-2 text-sm text-[#1a1a1a] hover:border-[#b5aa9e] disabled:opacity-50"
            >
              {isSavingConfig ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Enabled</span>
            <select
              value={form.enabled ? 'true' : 'false'}
              onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.value === 'true' }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Verifier Model</span>
            <select
              value={form.verifierModelKey}
              onChange={(event) => setForm((prev) => ({ ...prev, verifierModelKey: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            >
              {VERIFIER_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Run Interval (Hours)</span>
            <input
              type="number"
              min={1}
              max={168}
              step={1}
              value={form.runIntervalHours}
              onChange={(event) => setForm((prev) => ({ ...prev, runIntervalHours: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Min Confidence</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={form.minCandidateConfidence}
              onChange={(event) => setForm((prev) => ({ ...prev, minCandidateConfidence: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Hard Lookahead (Days)</span>
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              value={form.hardLookaheadDays}
              onChange={(event) => setForm((prev) => ({ ...prev, hardLookaheadDays: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Soft Lookahead (Days)</span>
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              value={form.softLookaheadDays}
              onChange={(event) => setForm((prev) => ({ ...prev, softLookaheadDays: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Overdue Recheck (Hours)</span>
            <input
              type="number"
              min={1}
              max={720}
              step={1}
              value={form.overdueRecheckHours}
              onChange={(event) => setForm((prev) => ({ ...prev, overdueRecheckHours: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Max Events Per Run</span>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              value={form.maxEventsPerRun}
              onChange={(event) => setForm((prev) => ({ ...prev, maxEventsPerRun: event.target.value }))}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4 text-xs text-[#8a8075]">
          Last updated: {updatedLabel} UTC
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a1a]">Pending Review Queue</h2>
            <p className="mt-1 text-xs text-[#8a8075]">
              Each candidate keeps the exact evidence URLs that GPT-5.2 used to justify the proposed outcome.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-[#b5aa9e]">
            {initialCandidates.length} pending
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {initialCandidates.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#e8ddd0] bg-[#faf7f2] px-4 py-5 text-sm text-[#8a8075]">
              No pending review candidates right now.
            </div>
          ) : initialCandidates.map((candidate) => (
            <article key={candidate.id} className="rounded-none border border-[#e8ddd0] bg-[#fcfbf8] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#1a1a1a]">
                    {candidate.event.drugName} • {candidate.event.companyName}
                  </h3>
                  <p className="mt-1 text-sm text-[#8a8075]">
                    {candidate.event.applicationType} • {candidate.event.decisionDateKind === 'soft' ? 'Expected' : 'Hard'} date {formatDateOnly(candidate.event.decisionDate)}
                  </p>
                  <p className="mt-2 text-sm text-[#1a1a1a]">
                    Proposed outcome: <span className={candidate.proposedOutcome === 'Approved' ? 'text-[#2e6e24]' : 'text-[#8d2c22]'}>{candidate.proposedOutcome}</span> at {(candidate.confidence * 100).toFixed(0)}% confidence
                  </p>
                  <p className="mt-1 text-xs text-[#8a8075]">
                    Suggested outcome date: {candidate.proposedOutcomeDate ? formatDateTime(candidate.proposedOutcomeDate) : 'Not supplied'} • Model {candidate.verifierModelKey}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[#3f3a35]">{candidate.summary}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void actOnCandidate(candidate.id, 'accept')}
                    disabled={actingCandidateId === candidate.id || isRefreshing}
                    className="rounded-none border border-[#3a8a2e] bg-[#3a8a2e] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void actOnCandidate(candidate.id, 'reject')}
                    disabled={actingCandidateId === candidate.id || isRefreshing}
                    className="rounded-none border border-[#c43a2b] bg-white px-3 py-2 text-xs font-medium text-[#8d2c22] disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void actOnCandidate(candidate.id, 'supersede')}
                    disabled={actingCandidateId === candidate.id || isRefreshing}
                    className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-xs font-medium text-[#8a8075] disabled:opacity-50"
                  >
                    Supersede
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <MetadataInlineInput
                  label="Date"
                  initialValue={candidate.event.decisionDate}
                  placeholder="YYYY-MM-DD"
                  inputType="date"
                  onSave={(value) => updateEventField(candidate.event.id, 'decisionDate', value)}
                  className="min-w-[220px]"
                />
                <MetadataInlineInput
                  label="Kind"
                  initialValue={candidate.event.decisionDateKind}
                  placeholder="hard or soft"
                  onSave={(value) => updateEventField(candidate.event.id, 'decisionDateKind', value)}
                  className="min-w-[220px]"
                />
              </div>

              <label className="mt-4 block space-y-1.5">
                <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Review Notes</span>
                <textarea
                  value={candidateNotes[candidate.id] ?? ''}
                  onChange={(event) => setCandidateNotes((prev) => ({ ...prev, [candidate.id]: event.target.value }))}
                  rows={2}
                  className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
                  placeholder="Optional notes for accept/reject/supersede."
                />
              </label>

              <div className="mt-4 grid gap-3">
                {candidate.evidence.map((evidence) => (
                  <div key={evidence.id} className="rounded-none border border-[#e8ddd0] bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.08em] text-[#b5aa9e]">
                      <span>{evidence.sourceType.replace('_', ' ')}</span>
                      <span>{evidence.domain}</span>
                      <span>{formatDateTime(evidence.publishedAt)}</span>
                    </div>
                    <a
                      href={evidence.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block text-sm font-medium text-[#1a1a1a] underline decoration-[#d8ccb9] underline-offset-2 hover:text-[#8d2c22]"
                    >
                      {evidence.title}
                    </a>
                    <p className="mt-2 text-sm leading-6 text-[#3f3a35]">{evidence.excerpt}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Overdue Soft-Date Events</h2>
        <p className="mt-1 text-xs text-[#8a8075]">
          These events are still pending after an expected date. You can move the date forward or harden it if a confirmed date is published.
        </p>

        <div className="mt-4 space-y-3">
          {overdueSoftEvents.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#e8ddd0] bg-[#faf7f2] px-4 py-5 text-sm text-[#8a8075]">
              No overdue soft-date events right now.
            </div>
          ) : overdueSoftEvents.map((event) => (
            <div key={event.id} className="rounded-none border border-[#e8ddd0] bg-[#fcfbf8] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#1a1a1a]">
                    {event.drugName} • {event.companyName}
                  </h3>
                  <p className="mt-1 text-sm text-[#8a8075]">
                    {event.applicationType} • expected date {formatDateOnly(event.decisionDate)}
                  </p>
                  <p className="mt-1 text-xs text-[#8a8075]">
                    Last monitored: {formatDateTime(event.lastMonitoredAt)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <MetadataInlineInput
                  label="Date"
                  initialValue={event.decisionDate}
                  placeholder="YYYY-MM-DD"
                  inputType="date"
                  onSave={(value) => updateEventField(event.id, 'decisionDate', value)}
                  className="min-w-[220px]"
                />
                <MetadataInlineInput
                  label="Kind"
                  initialValue={event.decisionDateKind}
                  placeholder="hard or soft"
                  onSave={(value) => updateEventField(event.id, 'decisionDateKind', value)}
                  className="min-w-[220px]"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Recent Runs</h2>
        <div className="mt-4 space-y-3">
          {recentRuns.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#e8ddd0] bg-[#faf7f2] px-4 py-5 text-sm text-[#8a8075]">
              No monitor runs have been recorded yet.
            </div>
          ) : recentRuns.map((run) => (
            <div key={run.id} className="rounded-none border border-[#e8ddd0] bg-[#fcfbf8] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#1a1a1a]">
                    {run.triggerSource === 'cron' ? 'Railway cron' : 'Manual admin run'} • {run.status}
                  </p>
                  <p className="mt-1 text-xs text-[#8a8075]">
                    Started {formatDateTime(run.startedAt)} UTC
                    {run.status === 'running'
                      ? ` • Last heartbeat ${formatDateTime(run.updatedAt)} UTC`
                      : ` • Completed ${formatDateTime(run.completedAt)} UTC`}
                  </p>
                </div>
                <div className="text-xs text-[#8a8075]">
                  {run.eventsScanned} scanned • {run.candidatesCreated} created
                </div>
              </div>
              {run.errorSummary ? (
                <p className="mt-2 text-sm text-[#8d2c22]">{run.errorSummary}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
