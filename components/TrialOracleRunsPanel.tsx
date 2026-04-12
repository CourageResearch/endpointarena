import Link from 'next/link'
import { HeaderDots } from '@/components/site/chrome'
import { MarketResolutionPanel } from '@/components/markets/dashboard/details-panel'
import type { OpenMarketRow } from '@/lib/markets/overview-shared'
import { formatLocalDateTime } from '@/lib/date'

type OracleOutcomeValue = 'YES' | 'NO' | 'NO_DECISION'
type OracleCandidateStatus =
  | 'pending_review'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'dismissed'

type OracleCandidate = {
  id: string
  proposedOutcome: OracleOutcomeValue
  confidence: number
  verifierModelLabel: string
  summary: string
  createdAt: string
  questionPrompt: string
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

type OracleFinding = OracleCandidate & {
  proposedOutcomeDate: string | null
  status: OracleCandidateStatus
  updatedAt: string
  reviewedAt: string | null
  reviewNotes: string | null
}

type OracleRunFinding = {
  kind: 'created' | 'duplicate' | 'no_evidence' | 'failed' | 'manual_import' | 'unknown'
  label: string
  proposedOutcome: OracleOutcomeValue | null
  confidence: number | null
  summary: string
  candidateId: string | null
  candidateStatus: OracleCandidateStatus | null
}

type OracleRun = {
  id: string
  status: 'running' | 'completed' | 'failed' | 'paused'
  verifierModelLabel: string
  questionsScanned: number
  candidatesCreated: number
  errorSummary: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
  stopRequestedAt: string | null
  finding: OracleRunFinding | null
  isReconstructed: boolean
}

type OracleHistoryEntry = {
  id: string
  questionPrompt: string
  previousOutcome: 'Pending' | 'YES' | 'NO' | null
  nextOutcome: 'Pending' | 'YES' | 'NO'
  currentOutcome: 'Pending' | 'YES' | 'NO'
  changedAt: string
  changeSource: 'manual_admin' | 'accepted_candidate' | 'accepted_candidate_legacy' | 'legacy_snapshot'
  candidate: {
    id: string
    confidence: number
    summary: string
    verifierModelLabel: string
    reviewedAt: string | null
  } | null
}

function getOutcomeBadge(outcome: OracleOutcomeValue): {
  label: string
  className: string
} {
  if (outcome === 'YES') {
    return { label: 'YES', className: 'bg-[#3a8a2e]/10 text-[#2f6f24]' }
  }
  if (outcome === 'NO') {
    return { label: 'NO', className: 'bg-[#EF6F67]/10 text-[#8d2c22]' }
  }

  return { label: 'NO_DECISION', className: 'bg-[#F5F2ED] text-[#7a7065]' }
}

function getCandidateStatusBadge(status: OracleCandidateStatus): { label: string; className: string } {
  switch (status) {
    case 'accepted':
      return { label: 'Accepted', className: 'bg-[#3a8a2e]/10 text-[#2f6f24]' }
    case 'rejected':
      return { label: 'Rejected', className: 'bg-[#EF6F67]/10 text-[#8d2c22]' }
    case 'dismissed':
      return { label: 'Dismissed', className: 'bg-[#F5F2ED] text-[#7a7065]' }
    case 'superseded':
      return { label: 'Superseded', className: 'bg-[#D39D2E]/10 text-[#8b6b21]' }
    default:
      return { label: 'Pending Review', className: 'bg-[#5BA5ED]/10 text-[#245f94]' }
  }
}

function getHistorySourceLabel(source: OracleHistoryEntry['changeSource']): string {
  switch (source) {
    case 'accepted_candidate':
      return 'Accepted Oracle'
    case 'accepted_candidate_legacy':
      return 'Accepted Oracle (Legacy)'
    case 'manual_admin':
      return 'Manual Outcome Update'
    default:
      return 'Legacy Resolution'
  }
}

function getOutcomeHistoryBadgeClass(outcome: 'Pending' | 'YES' | 'NO' | null): string {
  if (outcome === 'YES') return 'bg-[#3a8a2e]/10 text-[#2f6f24]'
  if (outcome === 'NO') return 'bg-[#EF6F67]/10 text-[#8d2c22]'
  return 'bg-[#F5F2ED] text-[#7a7065]'
}

function getSourceTypeLabel(sourceType: OracleCandidate['evidence'][number]['sourceType']): string {
  if (sourceType === 'clinicaltrials') return 'ClinicalTrials'
  if (sourceType === 'stored_source') return 'Stored Source'
  if (sourceType === 'web_search') return 'Web Search'
  return 'Sponsor'
}

function formatLatestRunCardDateTime(dateLike: string | null | undefined): string {
  if (!dateLike) return '-'

  const parsed = new Date(dateLike)
  if (Number.isNaN(parsed.getTime())) return '-'

  const dateParts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(parsed)

  const day = dateParts.find((part) => part.type === 'day')?.value ?? ''
  const month = dateParts.find((part) => part.type === 'month')?.value ?? ''
  const year = dateParts.find((part) => part.type === 'year')?.value ?? ''
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)

  return `${day} ${month} ${year}, ${time}`.trim()
}

export function TrialOracleRunsPanel({
  selectedMarket,
  allFindings,
  runHistory,
  historyEntries,
  embedded = false,
}: {
  selectedMarket: OpenMarketRow
  allFindings: OracleFinding[]
  runHistory: OracleRun[]
  historyEntries: OracleHistoryEntry[]
  embedded?: boolean
}) {
  const trialTitle = selectedMarket.event?.drugName || 'Trial'
  const nctNumber = selectedMarket.event?.nctId ?? null
  const marketHref = `/trials/${encodeURIComponent(selectedMarket.marketId)}`
  const latestRun = runHistory[0] ?? null

  return (
    <div className={embedded ? 'space-y-6' : 'space-y-8'}>
      {!embedded ? (
        <section className="rounded-none border border-[#e8ddd0] bg-white/90 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Link
                href={marketHref}
                className="text-xs uppercase tracking-[0.12em] text-[#8a8075] transition-colors hover:text-[#5b5148]"
              >
                Back to Trial
              </Link>
              <h1 className="mt-3 text-2xl font-semibold leading-tight text-[#1a1a1a]">Oracle Runs</h1>
              <p className="mt-2 text-sm leading-6 text-[#6f665b]">
                Oracle findings and outcome history for {trialTitle}{nctNumber ? ` (${nctNumber})` : ''}.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-right">
              <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Runs</div>
                <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{runHistory.length}</div>
              </div>
              <div className="rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Latest Run</div>
                <div className="mt-1 text-sm font-medium text-[#1a1a1a]">
                  {latestRun ? formatLatestRunCardDateTime(latestRun.startedAt) : '-'}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {!embedded && selectedMarket.resolution ? (
        <MarketResolutionPanel selectedMarket={selectedMarket} />
      ) : null}

      <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold text-[#1a1a1a]">Oracle Findings</div>
          <HeaderDots />
        </div>
        <p className="mt-2 text-xs leading-5 text-[#8a8075]">
          Every stored oracle finding for this trial, including pending, dismissed, rejected, superseded, and accepted items.
        </p>

        <div className="mt-4 space-y-4">
          {allFindings.length === 0 ? (
            <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
              No oracle findings have been stored for this trial yet.
            </div>
          ) : allFindings.map((finding) => {
            const outcomeBadge = getOutcomeBadge(finding.proposedOutcome)
            const statusBadge = getCandidateStatusBadge(finding.status)

            return (
              <article key={finding.id} className="rounded-none border border-[#e8ddd0] bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-none px-2 py-1 text-xs font-medium ${outcomeBadge.className}`}>
                    {outcomeBadge.label}
                  </span>
                  <span className={`rounded-none px-2 py-1 text-xs font-medium ${statusBadge.className}`}>
                    {statusBadge.label}
                  </span>
                  {finding.confidence > 0 ? (
                    <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 text-xs text-[#8a8075]">
                      {Math.round(finding.confidence * 100)}% confidence
                    </span>
                  ) : null}
                  <span className="rounded-none border border-[#d8ccb9] bg-[#faf7f2] px-2 py-1 text-xs text-[#7a7065]">
                    {finding.verifierModelLabel}
                  </span>
                </div>

                <p className="mt-2 text-sm text-[#6f665b]">{finding.questionPrompt}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#5b5148]">{finding.summary}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#8a8075]">
                  <span>Found {formatLocalDateTime(finding.createdAt)}</span>
                  {finding.proposedOutcomeDate ? (
                    <span>Outcome date {formatLocalDateTime(finding.proposedOutcomeDate)}</span>
                  ) : null}
                  {finding.reviewedAt ? (
                    <span>Reviewed {formatLocalDateTime(finding.reviewedAt)}</span>
                  ) : null}
                </div>

                {finding.reviewNotes ? (
                  <div className="mt-4 rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3 text-sm leading-6 text-[#5b5148]">
                    {finding.reviewNotes}
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {finding.evidence.map((evidence) => (
                    <a
                      key={evidence.id}
                      href={evidence.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-4 transition-colors hover:bg-[#f5eee5]"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs uppercase tracking-[0.08em] text-[#b5aa9e]">
                          {getSourceTypeLabel(evidence.sourceType)}
                        </span>
                        <span className="text-xs text-[#8a8075]">{evidence.domain}</span>
                        {evidence.publishedAt ? (
                          <span className="text-xs text-[#8a8075]">{formatLocalDateTime(evidence.publishedAt)}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-base font-medium leading-7 text-[#1a1a1a]">{evidence.title}</div>
                      <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#6f665b]">{evidence.excerpt}</div>
                    </a>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {historyEntries.length > 0 ? (
        <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-[#1a1a1a]">Outcome History</div>
            <HeaderDots />
          </div>
          <p className="mt-2 text-xs leading-5 text-[#8a8075]">
            Public history of accepted oracles and recorded outcome changes for this trial.
          </p>

          <div className="mt-4 space-y-4">
            {historyEntries.map((entry) => (
              <article key={entry.id} className="rounded-none border border-[#e8ddd0] bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-none border border-[#d8ccb9] bg-[#faf7f2] px-2 py-1 text-xs text-[#7a7065]">
                    {getHistorySourceLabel(entry.changeSource)}
                  </span>
                  <span className="text-xs text-[#8a8075]">{formatLocalDateTime(entry.changedAt)}</span>
                </div>

                <p className="mt-2 text-sm text-[#6f665b]">{entry.questionPrompt}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-none px-2 py-1 font-medium ${getOutcomeHistoryBadgeClass(entry.previousOutcome)}`}>
                    {entry.previousOutcome ?? 'Unknown'}
                  </span>
                  <span className="text-[#8a8075]">to</span>
                  <span className={`rounded-none px-2 py-1 font-medium ${getOutcomeHistoryBadgeClass(entry.nextOutcome)}`}>
                    {entry.nextOutcome}
                  </span>
                  <span className="text-[#8a8075]">current</span>
                  <span className={`rounded-none px-2 py-1 font-medium ${getOutcomeHistoryBadgeClass(entry.currentOutcome)}`}>
                    {entry.currentOutcome}
                  </span>
                </div>

                {entry.candidate ? (
                  <div className="mt-4 rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-none border border-[#d8ccb9] bg-white px-2 py-1 text-xs text-[#7a7065]">
                        {entry.candidate.verifierModelLabel}
                      </span>
                      <span className="rounded-none border border-[#e8ddd0] bg-white px-2 py-1 text-xs text-[#7a7065]">
                        {Math.round(entry.candidate.confidence * 100)}% confidence
                      </span>
                      {entry.candidate.reviewedAt ? (
                        <span className="text-xs text-[#8a8075]">
                          Reviewed {formatLocalDateTime(entry.candidate.reviewedAt)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#5b5148]">
                      {entry.candidate.summary}
                    </p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
