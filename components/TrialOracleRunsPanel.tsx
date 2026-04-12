import type { ReactNode } from 'react'
import Link from 'next/link'
import { MarketResolutionPanel } from '@/components/markets/dashboard/details-panel'
import {
  DASHBOARD_META_TEXT_CLASS,
  DASHBOARD_SECTION_LABEL_CLASS,
  DETAILS_BODY_TEXT_CLASS,
  DETAILS_CARD_BORDER_STYLE,
  DETAILS_CARD_SHELL_CLASS,
  DETAILS_TOP_LABEL_CLASS,
} from '@/components/markets/dashboard/shared'
import { HeaderDots } from '@/components/site/chrome'
import { LocalDateTime } from '@/components/ui/local-date-time'
import type { OpenMarketRow } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'

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

const BADGE_BASE_CLASS = 'inline-flex items-center rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] leading-none'
const METRIC_PILL_CLASS = 'inline-flex items-center rounded-sm border border-[#ddd2c5] bg-[#f9f4ec] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] leading-none text-[#6d645a]'
const INFO_CHIP_CLASS = 'inline-flex items-center rounded-sm border border-[#ddd2c5] bg-white/80 px-2 py-1 text-[10px] font-medium leading-none text-[#6d645a]'
const CONTENT_PANEL_CLASS = 'rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-4 py-3'
const SECTION_COPY_CLASS = 'max-w-3xl text-[12px] leading-[1.6] text-[#7c7267]'
const CARD_VALUE_CLASS = 'text-[0.9rem] font-medium leading-[1.4] text-[#4d453c]'
const BODY_COPY_CLASS = 'text-[0.92rem] whitespace-pre-wrap break-words leading-[1.6] text-[#4d453c]'

function getOutcomeBadge(outcome: OracleOutcomeValue): {
  label: string
  className: string
} {
  if (outcome === 'YES') {
    return { label: 'YES', className: 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]' }
  }
  if (outcome === 'NO') {
    return { label: 'NO', className: 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]' }
  }

  return { label: 'NO DECISION', className: 'border-[#d9cdbf] bg-[#f9f4ec] text-[#6d645a]' }
}

function getCandidateStatusBadge(status: OracleCandidateStatus): { label: string; className: string } {
  switch (status) {
    case 'accepted':
      return { label: 'Accepted', className: 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]' }
    case 'rejected':
      return { label: 'Rejected', className: 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]' }
    case 'dismissed':
      return { label: 'Dismissed', className: 'border-[#d9cdbf] bg-[#f9f4ec] text-[#6d645a]' }
    case 'superseded':
      return { label: 'Superseded', className: 'border-[#D39D2E]/35 bg-[#D39D2E]/10 text-[#8b6b21]' }
    default:
      return { label: 'Pending Review', className: 'border-[#5BA5ED]/35 bg-[#5BA5ED]/10 text-[#245f94]' }
  }
}

function getRunStatusBadge(status: OracleRun['status']): { label: string; className: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]' }
    case 'failed':
      return { label: 'Failed', className: 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]' }
    case 'paused':
      return { label: 'Paused', className: 'border-[#d9cdbf] bg-[#f9f4ec] text-[#6d645a]' }
    default:
      return { label: 'Running', className: 'border-[#5BA5ED]/35 bg-[#5BA5ED]/10 text-[#245f94]' }
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
  if (outcome === 'YES') return 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]'
  if (outcome === 'NO') return 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]'
  return 'border-[#d9cdbf] bg-[#f9f4ec] text-[#6d645a]'
}

function getSourceTypeLabel(sourceType: OracleCandidate['evidence'][number]['sourceType']): string {
  if (sourceType === 'clinicaltrials') return 'ClinicalTrials'
  if (sourceType === 'stored_source') return 'Stored Source'
  if (sourceType === 'web_search') return 'Web Search'
  return 'Sponsor'
}

function OracleStatCard({
  label,
  value,
  meta,
}: {
  label: string
  value: ReactNode
  meta?: ReactNode
}) {
  return (
    <div className={cn('h-full', DETAILS_CARD_SHELL_CLASS)}>
      <div
        className="flex h-full flex-col justify-between rounded-none border border-transparent px-4 py-3 sm:px-5 sm:py-4"
        style={DETAILS_CARD_BORDER_STYLE}
      >
        <div className={DETAILS_TOP_LABEL_CLASS}>{label}</div>
        <div className={cn('mt-3', CARD_VALUE_CLASS)}>{value}</div>
        {meta ? <div className="mt-3 flex flex-wrap gap-2">{meta}</div> : null}
      </div>
    </div>
  )
}

function MetaDatum({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className={DETAILS_TOP_LABEL_CLASS}>{label}</div>
      <div className={cn('text-[12px] text-[#6d645a]', DASHBOARD_META_TEXT_CLASS)}>{children}</div>
    </div>
  )
}

function OracleSourceCard({
  evidence,
}: {
  evidence: OracleCandidate['evidence'][number]
}) {
  return (
    <a
      href={evidence.url}
      target="_blank"
      rel="noreferrer"
      className="group block rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-4 py-4 transition-colors hover:border-[#d9cdbf] sm:px-5"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center rounded-sm border border-[#ddd2c5] bg-white/80 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[#9a8f82] shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
          {getSourceTypeLabel(evidence.sourceType)}
        </span>
        <span className="text-[11px] text-[#9e9286]">{evidence.domain}</span>
        {evidence.publishedAt ? (
          <span className="text-[11px] text-[#9e9286]">
            <LocalDateTime value={evidence.publishedAt} emptyLabel="Unknown time" />
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-[0.98rem] font-medium leading-[1.45] text-[#1a1a1a] transition-colors group-hover:text-[#2c2722]">
        {evidence.title}
      </div>

      <p className={cn('mt-3 text-[#5f564d]', DETAILS_BODY_TEXT_CLASS, BODY_COPY_CLASS)}>
        {evidence.excerpt}
      </p>
    </a>
  )
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
  const latestRunStatus = latestRun ? getRunStatusBadge(latestRun.status) : null

  return (
    <div className={embedded ? 'space-y-8' : 'space-y-10'}>
      {!embedded ? (
        <section className="space-y-4 px-1">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Link
                href={marketHref}
                className="text-xs uppercase tracking-[0.12em] text-[#8a8075] transition-colors hover:text-[#5b5148]"
              >
                Back to Trial
              </Link>
              <h1 className="mt-3 text-[1.6rem] font-normal leading-tight text-[#1a1a1a]">Oracle</h1>
              <p className={cn('mt-2', SECTION_COPY_CLASS, DASHBOARD_META_TEXT_CLASS)}>
                Oracle findings, accepted decisions, and recorded outcome changes for {trialTitle}
                {nctNumber ? ` (${nctNumber})` : ''}.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {!embedded && selectedMarket.resolution ? (
        <MarketResolutionPanel selectedMarket={selectedMarket} />
      ) : null}

      <section className="space-y-4">
        <div className="px-1">
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>Oracle Findings</div>
            <HeaderDots />
          </div>
        </div>

        {allFindings.length === 0 ? (
          <div className="mx-1 rounded-none border border-[#eadfce] bg-[#faf7f2] p-4 text-sm text-[#6f665b]">
            No oracle findings have been stored for this trial yet.
          </div>
        ) : (
          <div className="space-y-3">
            {allFindings.map((finding) => {
              const outcomeBadge = getOutcomeBadge(finding.proposedOutcome)
              const statusBadge = getCandidateStatusBadge(finding.status)

              return (
                <article key={finding.id} className={cn('mx-1', DETAILS_CARD_SHELL_CLASS)}>
                  <div
                    className="rounded-none border border-transparent px-4 py-4 sm:px-5"
                    style={DETAILS_CARD_BORDER_STYLE}
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap gap-2">
                        <span className={cn(BADGE_BASE_CLASS, outcomeBadge.className)}>
                          {outcomeBadge.label}
                        </span>
                        <span className={cn(BADGE_BASE_CLASS, statusBadge.className)}>
                          {statusBadge.label}
                        </span>
                        {finding.confidence > 0 ? (
                          <span className={METRIC_PILL_CLASS}>
                            {Math.round(finding.confidence * 100)}% confidence
                          </span>
                        ) : null}
                        <span className={INFO_CHIP_CLASS}>{finding.verifierModelLabel}</span>
                      </div>

                      <div>
                        <div className={DETAILS_TOP_LABEL_CLASS}>Question</div>
                        <div className="mt-2 text-[0.98rem] font-medium leading-[1.45] text-[#1a1a1a]">
                          {finding.questionPrompt}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-6 gap-y-3">
                        <MetaDatum label="Found">
                          <LocalDateTime value={finding.createdAt} emptyLabel="Unknown time" />
                        </MetaDatum>
                        {finding.proposedOutcomeDate ? (
                          <MetaDatum label="Outcome Date">
                            <LocalDateTime value={finding.proposedOutcomeDate} emptyLabel="Unknown time" />
                          </MetaDatum>
                        ) : null}
                        {finding.reviewedAt ? (
                          <MetaDatum label="Reviewed">
                            <LocalDateTime value={finding.reviewedAt} emptyLabel="Unknown time" />
                          </MetaDatum>
                        ) : null}
                      </div>

                      <section className={cn(CONTENT_PANEL_CLASS, 'sm:px-5 sm:py-4')}>
                        <div className={DETAILS_TOP_LABEL_CLASS}>Summary</div>
                        <p className={cn('mt-3', DETAILS_BODY_TEXT_CLASS, BODY_COPY_CLASS)}>
                          {finding.summary}
                        </p>

                        {finding.reviewNotes ? (
                          <div className="mt-4 border-t border-[#e8ddd0] pt-4">
                            <div className={DETAILS_TOP_LABEL_CLASS}>Review Notes</div>
                            <p className={cn('mt-2', DETAILS_BODY_TEXT_CLASS, BODY_COPY_CLASS)}>
                              {finding.reviewNotes}
                            </p>
                          </div>
                        ) : null}
                      </section>

                      {finding.evidence.length > 0 ? (
                        <section className="space-y-3">
                          <div className={DETAILS_TOP_LABEL_CLASS}>Sources</div>
                          <div className="space-y-3">
                            {finding.evidence.map((evidence) => (
                              <OracleSourceCard key={evidence.id} evidence={evidence} />
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="px-1">
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>Latest Run</div>
            <HeaderDots />
          </div>
        </div>

        <div className="grid gap-3 px-1 sm:grid-cols-2 xl:grid-cols-4">
          <OracleStatCard
            label="Latest Run"
            value={(
              <LocalDateTime
                value={latestRun?.startedAt ?? null}
                emptyLabel="No runs yet"
                className={CARD_VALUE_CLASS}
              />
            )}
            meta={!latestRun ? (
              <span className={cn('text-[12px] text-[#8a8075]', DASHBOARD_META_TEXT_CLASS)}>
                Waiting for the first oracle run
              </span>
            ) : undefined}
          />
          <OracleStatCard
            label="Status"
            value={latestRunStatus ? (
              <span className={cn(BADGE_BASE_CLASS, latestRunStatus.className)}>
                {latestRunStatus.label}
              </span>
            ) : 'No runs yet'}
          />
          <OracleStatCard
            label="Model"
            value={latestRun?.verifierModelLabel ?? 'No runs yet'}
          />
          <OracleStatCard
            label="Runs"
            value={`${runHistory.length.toLocaleString('en-US')} run${runHistory.length === 1 ? '' : 's'}`}
          />
        </div>
      </section>

      {historyEntries.length > 0 ? (
        <section className="space-y-4">
          <div className="px-1">
            <div className="flex items-center gap-3">
              <div className={DASHBOARD_SECTION_LABEL_CLASS}>Outcome History</div>
              <HeaderDots />
            </div>
            <p className={cn('mt-2', SECTION_COPY_CLASS, DASHBOARD_META_TEXT_CLASS)}>
              Public history of accepted oracle outcomes and recorded trial-resolution changes.
            </p>
          </div>

          <div className="space-y-3">
            {historyEntries.map((entry) => (
              <article key={entry.id} className={cn('mx-1', DETAILS_CARD_SHELL_CLASS)}>
                <div
                  className="rounded-none border border-transparent px-4 py-4 sm:px-5"
                  style={DETAILS_CARD_BORDER_STYLE}
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          <span className={INFO_CHIP_CLASS}>
                            {getHistorySourceLabel(entry.changeSource)}
                          </span>
                        </div>
                        <div className="mt-3 text-[0.98rem] font-medium leading-[1.45] text-[#1a1a1a]">
                          {entry.questionPrompt}
                        </div>
                      </div>

                      <div className={cn('shrink-0 text-[12px] text-[#8a8075]', DASHBOARD_META_TEXT_CLASS)}>
                        <LocalDateTime value={entry.changedAt} emptyLabel="Unknown time" />
                      </div>
                    </div>

                    <div className={cn('grid gap-3', entry.candidate ? 'lg:grid-cols-[minmax(0,1fr)_18rem]' : 'lg:grid-cols-1')}>
                      <section className={cn(CONTENT_PANEL_CLASS, 'sm:px-5 sm:py-4')}>
                        <div className={DETAILS_TOP_LABEL_CLASS}>Outcome Change</div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div className="space-y-2">
                            <div className={DETAILS_TOP_LABEL_CLASS}>From</div>
                            <span className={cn(BADGE_BASE_CLASS, getOutcomeHistoryBadgeClass(entry.previousOutcome))}>
                              {entry.previousOutcome ?? 'Unknown'}
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div className={DETAILS_TOP_LABEL_CLASS}>To</div>
                            <span className={cn(BADGE_BASE_CLASS, getOutcomeHistoryBadgeClass(entry.nextOutcome))}>
                              {entry.nextOutcome}
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div className={DETAILS_TOP_LABEL_CLASS}>Current</div>
                            <span className={cn(BADGE_BASE_CLASS, getOutcomeHistoryBadgeClass(entry.currentOutcome))}>
                              {entry.currentOutcome}
                            </span>
                          </div>
                        </div>
                      </section>

                      {entry.candidate ? (
                        <aside className={CONTENT_PANEL_CLASS}>
                          <div className={DETAILS_TOP_LABEL_CLASS}>Accepted Oracle</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className={INFO_CHIP_CLASS}>{entry.candidate.verifierModelLabel}</span>
                            <span className={METRIC_PILL_CLASS}>
                              {Math.round(entry.candidate.confidence * 100)}% confidence
                            </span>
                          </div>
                          {entry.candidate.reviewedAt ? (
                            <div className={cn('mt-3 text-[12px] text-[#8a8075]', DASHBOARD_META_TEXT_CLASS)}>
                              Reviewed <LocalDateTime value={entry.candidate.reviewedAt} emptyLabel="Unknown time" />
                            </div>
                          ) : null}
                          <p className={cn('mt-3 text-[#5f564d]', DETAILS_BODY_TEXT_CLASS, BODY_COPY_CLASS)}>
                            {entry.candidate.summary}
                          </p>
                        </aside>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
