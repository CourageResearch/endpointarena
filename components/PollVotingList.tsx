'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PollCandidate } from '@/lib/poll'
import { cn } from '@/lib/utils'

type VoteStatus = 'idle' | 'submitting' | 'success' | 'error'

type PollVoteResponse = {
  ok?: boolean
  nctNumber?: string
  error?: {
    message?: string
  }
}

function sortCandidates(candidates: PollCandidate[]): PollCandidate[] {
  return [...candidates].sort((a, b) => {
    const aLast = a.lastSuggestedAt ? new Date(a.lastSuggestedAt).getTime() : 0
    const bLast = b.lastSuggestedAt ? new Date(b.lastSuggestedAt).getTime() : 0

    return b.weeklyVotes - a.weeklyVotes
      || b.totalVotes - a.totalVotes
      || b.suggestionCount - a.suggestionCount
      || bLast - aLast
      || a.nctNumber.localeCompare(b.nctNumber)
  })
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatClinicalDate(value: string | null): string {
  if (!value) return 'Date not listed'
  if (/^\d{4}$/.test(value)) return value
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-')
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  return value
}

function updateVoteCounts(
  candidates: PollCandidate[],
  previousNctNumber: string | null,
  nextNctNumber: string,
): PollCandidate[] {
  if (previousNctNumber === nextNctNumber) {
    return candidates
  }

  return sortCandidates(candidates.map((candidate) => {
    if (candidate.nctNumber === previousNctNumber) {
      return {
        ...candidate,
        weeklyVotes: Math.max(0, candidate.weeklyVotes - 1),
        totalVotes: Math.max(0, candidate.totalVotes - 1),
      }
    }

    if (candidate.nctNumber === nextNctNumber) {
      return {
        ...candidate,
        weeklyVotes: candidate.weeklyVotes + 1,
        totalVotes: candidate.totalVotes + 1,
      }
    }

    return candidate
  }))
}

export function PollVotingList({
  candidates,
  selectedNctNumber,
}: {
  candidates: PollCandidate[]
  selectedNctNumber: string | null
}) {
  const router = useRouter()
  const [items, setItems] = useState(() => sortCandidates(candidates))
  const [selected, setSelected] = useState(selectedNctNumber)
  const [status, setStatus] = useState<VoteStatus>('idle')
  const [pendingNctNumber, setPendingNctNumber] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  async function voteFor(nctNumber: string) {
    if (pendingNctNumber) return

    if (selected === nctNumber) {
      setStatus('success')
      setFeedback(`Your weekly vote is on ${nctNumber}.`)
      return
    }

    setStatus('submitting')
    setPendingNctNumber(nctNumber)
    setFeedback('')

    try {
      const response = await fetch('/api/poll/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nctNumber }),
      })
      const body = await response.json().catch(() => null) as PollVoteResponse | null

      if (!response.ok || body?.ok !== true || typeof body?.nctNumber !== 'string') {
        setStatus('error')
        setFeedback(body?.error?.message ?? 'Unable to record your vote right now.')
        return
      }

      const previousSelected = selected
      const nextSelected = body.nctNumber

      setItems((currentItems) => updateVoteCounts(currentItems, previousSelected, nextSelected))
      setSelected(nextSelected)
      setStatus('success')
      setFeedback(`Vote recorded for ${nextSelected}.`)
      router.refresh()
    } catch {
      setStatus('error')
      setFeedback('Network error. Please try again in a moment.')
    } finally {
      setPendingNctNumber(null)
    }
  }

  return (
    <div className="border border-[#e8ddd0] bg-white/70">
      {items.map((candidate, index) => {
        const isSelected = selected === candidate.nctNumber
        const isPending = pendingNctNumber === candidate.nctNumber

        return (
          <article
            key={candidate.nctNumber}
            className={cn(
              'border-b border-[#e8ddd0] transition-colors last:border-b-0 hover:bg-white/80',
              isSelected ? 'bg-[#f5fbf4]' : 'bg-transparent',
            )}
          >
            <div className="grid grid-cols-[4.25rem_minmax(0,1fr)]">
              <div className="flex flex-col items-center border-r border-[#eee4d8] bg-[#fbf8f3]/75 px-2 py-4">
                <button
                  type="button"
                  aria-label={isSelected ? `Your weekly vote is on ${candidate.nctNumber}` : `Vote for ${candidate.nctNumber}`}
                  aria-pressed={isSelected}
                  title={isSelected ? 'Your vote' : 'Vote'}
                  disabled={Boolean(pendingNctNumber)}
                  onClick={() => void voteFor(candidate.nctNumber)}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center border text-[#8a8075] transition-colors disabled:border-[#cfc2b2] disabled:bg-[#f4eee6] disabled:text-[#b5aa9e]',
                    isSelected
                      ? 'border-[#5DBB63] bg-[#eef7ee] text-[#2f6f35] hover:bg-[#e5f3e5]'
                      : 'border-[#e1d6c7] bg-white hover:border-[#1a1a1a] hover:text-[#1a1a1a]',
                  )}
                >
                  <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 3 3.5 8h3v5h3V8h3L8 3Z" fill="currentColor" />
                  </svg>
                </button>
                <p className="mt-2 font-mono text-2xl leading-none text-[#1a1a1a]">
                  {formatCount(candidate.weeklyVotes)}
                </p>
                <p className="mt-1 text-center text-[9px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
                  week
                </p>
              </div>

              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-mono text-sm text-[#8a8075]">#{index + 1}</span>
                  <a
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm font-medium text-[#1a1a1a] underline decoration-[#d8ccb9] underline-offset-4 hover:text-[#4a8cca]"
                  >
                    {candidate.nctNumber}
                  </a>
                  {isSelected ? (
                    <span className="border border-[#5DBB63]/35 bg-[#eef7ee] px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#3d7c42]">
                      Your vote
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-3 max-w-3xl text-lg font-semibold leading-snug text-[#1a1a1a]">
                  {candidate.title}
                </h2>

                <div className="mt-4 grid gap-x-5 gap-y-3 text-sm text-[#6f665b] sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">Drug</p>
                    <p className="mt-1 break-words text-[#1a1a1a]">{candidate.intervention}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">Sponsor</p>
                    <p className="mt-1 break-words text-[#1a1a1a]">{candidate.sponsorName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">Condition</p>
                    <p className="mt-1 break-words">{candidate.condition}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">Status</p>
                    <p className="mt-1 break-words">
                      {candidate.status} | {candidate.phase} | {formatClinicalDate(candidate.primaryCompletionDate)}
                    </p>
                  </div>
                </div>

                <p className="mt-4 border-t border-[#eee4d8] pt-3 text-xs text-[#8a8075]">
                  {formatCount(candidate.totalVotes)} total | {formatCount(candidate.suggestionCount)} suggested
                </p>
                {isPending ? (
                  <p className="mt-2 text-xs text-[#8a8075]">Voting...</p>
                ) : null}
              </div>
            </div>
          </article>
        )
      })}

      {feedback ? (
        <p
          role="status"
          aria-live="polite"
          className={`border-t border-[#e8ddd0] px-4 py-3 text-sm ${status === 'error' ? 'text-[#c24f45]' : 'text-[#3d7c42]'}`}
        >
          {feedback}
        </p>
      ) : null}
    </div>
  )
}
