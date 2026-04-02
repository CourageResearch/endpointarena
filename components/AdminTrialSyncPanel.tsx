'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'
import { formatLocalDateTime } from '@/lib/date'

type TrialSyncConfigDto = {
  enabled: boolean
  syncIntervalHours: number
  recentCompletionLookbackDays: number
  reconcileIntervalHours: number
  lastSuccessfulUpdatePostDate: string | null
  lastSuccessfulDataTimestamp: string | null
  updatedAt: string
}

type TrialSyncRunRow = {
  id: string
  triggerSource: 'cron' | 'manual'
  mode: 'incremental' | 'reconcile'
  status: 'running' | 'completed' | 'failed' | 'skipped'
  sourceDataTimestamp: string | null
  studiesFetched: number
  studiesMatched: number
  trialsUpserted: number
  questionsUpserted: number
  marketsOpened: number
  errorSummary: string | null
  startedAt: string
  completedAt: string | null
}

type TrialSyncChangedItem = {
  id: string
  nctNumber: string
  shortTitle: string
  sponsorName: string
  currentStatus: string
  estPrimaryCompletionDate: string
  changeType: 'inserted' | 'updated'
  changeSummary: string | null
  createdAt: string
  marketId: string | null
}

type Props = {
  initialConfig: TrialSyncConfigDto
  recentRuns: TrialSyncRunRow[]
  latestCompletedRunId: string | null
  latestChangedItems: TrialSyncChangedItem[]
}

type TrialSyncRunResult = {
  executed: boolean
  reason?: 'disabled' | 'not_due' | 'up_to_date'
  runId?: string
  mode?: 'incremental' | 'reconcile'
  sourceDataTimestamp?: string | null
  studiesFetched: number
  studiesMatched: number
  trialsUpserted: number
  questionsUpserted: number
  marketsOpened: number
}

function getRunStatusTone(status: TrialSyncRunRow['status']) {
  switch (status) {
    case 'completed':
      return 'bg-[#3a8a2e]/10 text-[#2f6f24]'
    case 'failed':
      return 'bg-[#EF6F67]/10 text-[#8d2c22]'
    case 'skipped':
      return 'bg-[#D39D2E]/10 text-[#8b6b21]'
    default:
      return 'bg-[#5BA5ED]/10 text-[#265f8f]'
  }
}

function getChangeTone(changeType: TrialSyncChangedItem['changeType']) {
  return changeType === 'inserted'
    ? 'bg-[#3a8a2e]/10 text-[#2f6f24]'
    : 'bg-[#5BA5ED]/10 text-[#265f8f]'
}

function formatRunMessage(result: TrialSyncRunResult) {
  if (!result.executed) {
    if (result.reason === 'disabled') return 'ClinicalTrials.gov sync is disabled.'
    if (result.reason === 'up_to_date') return 'ClinicalTrials.gov data is already up to date.'
    if (result.reason === 'not_due') return 'ClinicalTrials.gov sync is not due yet.'
    return 'ClinicalTrials.gov sync was skipped.'
  }

  return `${result.mode === 'reconcile' ? 'Reconcile' : 'Sync'} finished: fetched ${result.studiesFetched} studies, matched ${result.studiesMatched}, changed ${result.trialsUpserted}, and opened ${result.marketsOpened} trial${result.marketsOpened === 1 ? '' : 's'}.`
}

export function AdminTrialSyncPanel({
  initialConfig,
  recentRuns,
  latestCompletedRunId,
  latestChangedItems,
}: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [runningMode, setRunningMode] = useState<'incremental' | 'reconcile' | null>(null)
  const [runs, setRuns] = useState(recentRuns)

  useEffect(() => {
    setRuns(recentRuns)
  }, [recentRuns])

  const activeRun = runs.find((run) => run.status === 'running') ?? null

  useEffect(() => {
    if (!activeRun && !runningMode) return

    const timer = window.setInterval(() => {
      router.refresh()
    }, 4000)

    return () => window.clearInterval(timer)
  }, [activeRun, router, runningMode])

  const runSync = async (mode: 'incremental' | 'reconcile') => {
    setError(null)
    setMessage(null)
    setRunningMode(mode)

    try {
      const response = await fetch('/api/admin/trial-sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, mode }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to run ClinicalTrials.gov sync'))
      }

      setMessage(formatRunMessage(payload.result as TrialSyncRunResult))
      router.refresh()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run ClinicalTrials.gov sync')
    } finally {
      setRunningMode(null)
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-none border border-[#c43a2b]/35 bg-[#fff3f1] px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-none border border-[#3a8a2e]/35 bg-[#f4fbf2] px-3 py-2 text-sm text-[#2f6f24]">
          {message}
        </div>
      ) : null}

      {activeRun ? (
        <section className="rounded-none border border-[#5BA5ED]/35 bg-[#f3f8fe] p-4 text-[#245f94]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#1f5a8c]">ClinicalTrials.gov Sync In Progress</h3>
              <p className="mt-1 text-sm">
                {activeRun.mode === 'reconcile' ? 'Running a full reconcile.' : 'Pulling incremental updates.'} The page refreshes automatically while the sync is running.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm lg:min-w-[320px]">
              <div className="rounded-none border border-[#5BA5ED]/25 bg-white/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#5b7ea6]">Started</div>
                <div className="mt-1 font-medium text-[#245f94]">{formatLocalDateTime(activeRun.startedAt)}</div>
              </div>
              <div className="rounded-none border border-[#5BA5ED]/25 bg-white/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#5b7ea6]">Mode</div>
                <div className="mt-1 font-medium text-[#245f94]">{activeRun.mode}</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-[#1a1a1a]">ClinicalTrials.gov Sync</h3>
            <p className="mt-1 text-sm text-[#8a8075]">
              Manually pull new and updated Phase 2 trials from ClinicalTrials.gov, then review exactly what changed in the latest completed run.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runSync('incremental')}
              disabled={runningMode !== null}
              className="rounded-none bg-[#1a1a1a] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:bg-[#b7ada3]"
            >
              {runningMode === 'incremental' ? 'Syncing…' : 'Run Incremental Sync'}
            </button>
            <button
              type="button"
              onClick={() => void runSync('reconcile')}
              disabled={runningMode !== null}
              className="rounded-none border border-[#d9cdbf] bg-white px-3 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:border-[#1a1a1a] disabled:cursor-not-allowed disabled:text-[#9b9084]"
            >
              {runningMode === 'reconcile' ? 'Reconciling…' : 'Run Full Reconcile'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Sync Enabled</div>
            <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{initialConfig.enabled ? 'On' : 'Off'}</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Incremental Cadence</div>
            <div className="mt-1 text-sm font-medium text-[#1a1a1a]">Every {initialConfig.syncIntervalHours} hours</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Recent Completion Window</div>
            <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{initialConfig.recentCompletionLookbackDays} days</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Last Update Watermark</div>
            <div className="mt-1 text-sm font-medium text-[#1a1a1a]">
              {initialConfig.lastSuccessfulUpdatePostDate ?? 'Not set yet'}
            </div>
            <div className="mt-1 text-xs text-[#8a8075]">
              Source snapshot: {initialConfig.lastSuccessfulDataTimestamp ?? 'Unknown'}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">Recent Sync Runs</h3>
            <p className="mt-1 text-sm text-[#8a8075]">
              The latest completed run is {latestCompletedRunId ? latestCompletedRunId.slice(0, 8) : 'not available'}.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {runs.length === 0 ? (
            <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-4 text-sm text-[#8a8075]">
              No ClinicalTrials.gov sync runs yet.
            </div>
          ) : runs.map((run) => (
            <article key={run.id} className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-none px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${getRunStatusTone(run.status)}`}>
                    {run.status}
                  </span>
                  <span className="text-sm font-medium text-[#1a1a1a]">{run.mode}</span>
                  <span className="text-sm text-[#8a8075]">{run.triggerSource}</span>
                </div>
                <div className="text-sm text-[#8a8075]">
                  {formatLocalDateTime(run.startedAt)}
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-sm text-[#5b5148] sm:grid-cols-4">
                <div><span className="text-[#8a8075]">Fetched:</span> {run.studiesFetched}</div>
                <div><span className="text-[#8a8075]">Matched:</span> {run.studiesMatched}</div>
                <div><span className="text-[#8a8075]">Changed:</span> {run.trialsUpserted}</div>
                <div><span className="text-[#8a8075]">Trials opened:</span> {run.marketsOpened}</div>
              </div>
              {run.errorSummary ? (
                <div className="mt-2 text-sm text-[#8d2c22]">{run.errorSummary}</div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div>
          <h3 className="text-sm font-semibold text-[#1a1a1a]">Changed Since Last Sync</h3>
          <p className="mt-1 text-sm text-[#8a8075]">
            Inserted and updated trials from the latest completed ClinicalTrials.gov sync.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {latestChangedItems.length === 0 ? (
            <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-4 text-sm text-[#8a8075]">
              No inserted or updated trials were recorded in the latest completed sync.
            </div>
          ) : latestChangedItems.map((item) => (
            <article key={item.id} className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-none px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${getChangeTone(item.changeType)}`}>
                      {item.changeType}
                    </span>
                    <h4 className="text-sm font-semibold text-[#1a1a1a]">{item.shortTitle}</h4>
                  </div>
                  <div className="mt-1 text-sm text-[#8a8075]">{item.sponsorName} · {item.nctNumber}</div>
                  <div className="mt-2 grid gap-2 text-sm text-[#5b5148] sm:grid-cols-2">
                    <div><span className="text-[#8a8075]">Status:</span> {item.currentStatus}</div>
                    <div><span className="text-[#8a8075]">Primary completion:</span> {item.estPrimaryCompletionDate.slice(0, 10)}</div>
                    <div><span className="text-[#8a8075]">Recorded:</span> {formatLocalDateTime(item.createdAt)}</div>
                    <div><span className="text-[#8a8075]">Changed fields:</span> {item.changeSummary ?? 'New trial'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.marketId ? (
                    <Link
                      href={`/trials/${encodeURIComponent(item.marketId)}`}
                      className="rounded-none bg-[#1a1a1a] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333]"
                    >
                      Open trial
                    </Link>
                  ) : null}
                  <Link
                    href={`https://clinicaltrials.gov/study/${encodeURIComponent(item.nctNumber)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-none border border-[#d9cdbf] bg-white px-3 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:border-[#1a1a1a]"
                  >
                    Open CT.gov
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
