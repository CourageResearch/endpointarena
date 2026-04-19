'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatLocalDateTime } from '@/lib/date'

export type AdminTrialOutcomeHistoryEntry = {
  id: string
  trialQuestionId: string
  marketSlug: string | null
  questionPrompt: string
  previousOutcome: 'Pending' | 'YES' | 'NO' | null
  previousOutcomeDate: string | null
  nextOutcome: 'Pending' | 'YES' | 'NO'
  nextOutcomeDate: string | null
  currentOutcome: 'Pending' | 'YES' | 'NO'
  currentOutcomeDate: string | null
  changedAt: string
  changeSource: 'manual_admin' | 'accepted_candidate' | 'accepted_candidate_legacy' | 'legacy_snapshot'
  changedByName: string | null
  changedByEmail: string | null
  notes: string | null
  trial: {
    shortTitle: string
    sponsorName: string
    sponsorTicker: string | null
    nctNumber: string | null
  }
  candidate: {
    id: string
    confidence: number
    summary: string
    verifierModelLabel: string
    reviewedAt: string | null
  } | null
}

type Props = {
  entries: AdminTrialOutcomeHistoryEntry[]
}

function getOutcomeBadgeClass(outcome: 'Pending' | 'YES' | 'NO' | null): string {
  if (outcome === 'YES') {
    return 'bg-[#3a8a2e]/10 text-[#2f6f24]'
  }

  if (outcome === 'NO') {
    return 'bg-[#EF6F67]/10 text-[#8d2c22]'
  }

  return 'bg-[#F5F2ED] text-[#7a7065]'
}

function getSourceBadge(source: AdminTrialOutcomeHistoryEntry['changeSource']): { label: string, className: string } {
  switch (source) {
    case 'manual_admin':
      return {
        label: 'Manual Admin Change',
        className: 'border-[#d6cbc0] bg-[#faf7f2] text-[#6f665b]',
      }
    case 'accepted_candidate':
      return {
        label: 'Accepted Review',
        className: 'border-[#cfe7c8] bg-[#f4fbf2] text-[#2f6f24]',
      }
    case 'accepted_candidate_legacy':
      return {
        label: 'Accepted Review (Legacy)',
        className: 'border-[#d9cdbf] bg-[#fffaf2] text-[#8b6b21]',
      }
    default:
      return {
        label: 'Legacy Snapshot',
        className: 'border-[#d9cdbf] bg-[#fffaf2] text-[#8b6b21]',
      }
  }
}

function entryMatchesSearch(entry: AdminTrialOutcomeHistoryEntry, search: string): boolean {
  if (!search) return true

  const haystack = [
    entry.trial.shortTitle,
    entry.trial.sponsorName,
    entry.trial.sponsorTicker ?? '',
    entry.trial.nctNumber ?? '',
    entry.questionPrompt,
    entry.previousOutcome ?? '',
    entry.nextOutcome,
    entry.currentOutcome,
    entry.changedByName ?? '',
    entry.changedByEmail ?? '',
    entry.notes ?? '',
  ].join(' ').toLowerCase()

  return haystack.includes(search)
}

function formatChangedBy(entry: AdminTrialOutcomeHistoryEntry): string | null {
  if (entry.changedByName && entry.changedByEmail) {
    return `${entry.changedByName} (${entry.changedByEmail})`
  }
  if (entry.changedByName) return entry.changedByName
  if (entry.changedByEmail) return entry.changedByEmail
  return null
}

export function AdminTrialOutcomeHistory({ entries }: Props) {
  const [search, setSearch] = useState('')
  const normalizedSearch = search.trim().toLowerCase()
  const hasActiveSearch = normalizedSearch.length > 0
  const filteredEntries = hasActiveSearch
    ? entries.filter((entry) => entryMatchesSearch(entry, normalizedSearch))
    : []

  return (
    <section className="rounded-none border border-[#e8ddd0] bg-white/85 p-4">
      <div className="max-w-3xl">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Outcome History</h3>
        <p className="mt-1 text-xs leading-5 text-[#8a8075]">
          Search accepted reviews and recorded outcome changes without loading the full history list by default.
        </p>
      </div>

      <div className="mt-4">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by trial, sponsor, NCT, prompt, or outcome"
          className="h-11 w-full rounded-none border border-[#d9cdbf] bg-white px-3 text-sm text-[#1a1a1a] outline-none transition-colors placeholder:text-[#9a9084] focus:border-[#1a1a1a]"
        />
      </div>

      <div className="mt-4 space-y-4">
        {!hasActiveSearch ? (
          <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
            Start typing to search outcome history.
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
            No outcome history entries match the current search.
          </div>
        ) : filteredEntries.map((entry) => {
          const sourceBadge = getSourceBadge(entry.changeSource)
          const changedBy = formatChangedBy(entry)
          const changedAgain = entry.currentOutcome !== entry.nextOutcome

          return (
            <article key={entry.id} className="rounded-none border border-[#e8ddd0] bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.marketSlug ? (
                      <Link
                        href={`/trials/${encodeURIComponent(entry.marketSlug)}`}
                        className="text-sm font-semibold text-[#1a1a1a] transition-colors hover:text-[#5b5148] hover:underline"
                      >
                        {entry.trial.shortTitle}
                      </Link>
                    ) : (
                      <h4 className="text-sm font-semibold text-[#1a1a1a]">{entry.trial.shortTitle}</h4>
                    )}
                    <span className={`rounded-none border px-2 py-1 text-xs font-medium ${sourceBadge.className}`}>
                      {sourceBadge.label}
                    </span>
                    {changedAgain ? (
                      <span className="rounded-none border border-[#f0b7b1] bg-[#fff8f7] px-2 py-1 text-xs font-medium text-[#b83f34]">
                        Changed Again Later
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-xs text-[#8a8075]">
                    {entry.trial.sponsorName}
                    {entry.trial.sponsorTicker ? ` (${entry.trial.sponsorTicker})` : ''}
                    {entry.trial.nctNumber ? ` - ${entry.trial.nctNumber}` : ''}
                  </p>

                  <p className="mt-2 text-sm text-[#6f665b]">{entry.questionPrompt}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-none px-2 py-1 font-medium ${getOutcomeBadgeClass(entry.previousOutcome)}`}>
                      {entry.previousOutcome ?? 'Unknown'}
                    </span>
                    <span className="text-[#8a8075]">to</span>
                    <span className={`rounded-none px-2 py-1 font-medium ${getOutcomeBadgeClass(entry.nextOutcome)}`}>
                      {entry.nextOutcome}
                    </span>
                    <span className="text-[#8a8075]">at</span>
                    <span className="text-[#5b5148]">{formatLocalDateTime(entry.changedAt)}</span>
                    <span className="text-[#8a8075]">current</span>
                    <span className={`rounded-none px-2 py-1 font-medium ${getOutcomeBadgeClass(entry.currentOutcome)}`}>
                      {entry.currentOutcome}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8a8075]">
                    {entry.previousOutcomeDate ? (
                      <span>Previous outcome date {formatLocalDateTime(entry.previousOutcomeDate)}</span>
                    ) : null}
                    {entry.nextOutcomeDate ? (
                      <span>Effective outcome date {formatLocalDateTime(entry.nextOutcomeDate)}</span>
                    ) : null}
                    {entry.currentOutcomeDate ? (
                      <span>Current outcome date {formatLocalDateTime(entry.currentOutcomeDate)}</span>
                    ) : null}
                    {changedBy ? (
                      <span>Changed by {changedBy}</span>
                    ) : null}
                  </div>
                </div>
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
                      <span className="text-xs text-[#8a8075]">Reviewed {formatLocalDateTime(entry.candidate.reviewedAt)}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#5b5148]">
                    {entry.candidate.summary}
                  </p>
                </div>
              ) : null}

              {entry.notes ? (
                <div className="mt-3 rounded-none border border-[#e8ddd0] bg-[#fcfaf6] px-3 py-2 text-xs leading-5 text-[#6f665b]">
                  {entry.notes}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
