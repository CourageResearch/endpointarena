import { desc, eq, ne } from 'drizzle-orm'
import {
  db,
  trialOutcomeCandidates,
  trialQuestionOutcomeHistory,
  trialQuestions,
} from '@/lib/db'

export type TrialQuestionOutcomeValue = 'Pending' | 'YES' | 'NO'
export type TrialQuestionOutcomeHistoryChangeSource = 'manual_admin' | 'accepted_candidate'
export type TrialQuestionOutcomeHistoryListSource =
  | TrialQuestionOutcomeHistoryChangeSource
  | 'accepted_candidate_legacy'
  | 'legacy_snapshot'

type OutcomeHistoryDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

type NullableDate = Date | null | undefined

export type TrialQuestionOutcomeHistoryListItem = {
  id: string
  trialQuestionId: string
  marketId: string | null
  questionPrompt: string
  previousOutcome: TrialQuestionOutcomeValue | null
  previousOutcomeDate: string | null
  nextOutcome: TrialQuestionOutcomeValue
  nextOutcomeDate: string | null
  currentOutcome: TrialQuestionOutcomeValue
  currentOutcomeDate: string | null
  changedAt: string
  changeSource: TrialQuestionOutcomeHistoryListSource
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
    verifierModelKey: string
    reviewedAt: string | null
  } | null
}

function toIsoString(value: NullableDate): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function toTimestamp(value: NullableDate): number {
  return value instanceof Date ? value.getTime() : Number.NaN
}

function normalizeNotes(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function compareDatesDescending(left: string, right: string): number {
  return new Date(right).getTime() - new Date(left).getTime()
}

export async function recordTrialQuestionOutcomeHistory(input: {
  dbClient?: OutcomeHistoryDbClient
  trialQuestionId: string
  previousOutcome: TrialQuestionOutcomeValue | null
  previousOutcomeDate?: Date | null
  nextOutcome: TrialQuestionOutcomeValue
  nextOutcomeDate?: Date | null
  changedAt?: Date
  changeSource: TrialQuestionOutcomeHistoryChangeSource
  changedByUserId?: string | null
  reviewCandidateId?: string | null
  notes?: string | null
}): Promise<boolean> {
  const previousOutcomeDateTime = toTimestamp(input.previousOutcomeDate)
  const nextOutcomeDateTime = toTimestamp(input.nextOutcomeDate)

  if (
    input.previousOutcome === input.nextOutcome &&
    (
      (Number.isNaN(previousOutcomeDateTime) && Number.isNaN(nextOutcomeDateTime)) ||
      previousOutcomeDateTime === nextOutcomeDateTime
    )
  ) {
    return false
  }

  const dbClient = input.dbClient ?? db

  await dbClient.insert(trialQuestionOutcomeHistory).values({
    trialQuestionId: input.trialQuestionId,
    previousOutcome: input.previousOutcome,
    previousOutcomeDate: input.previousOutcomeDate ?? null,
    nextOutcome: input.nextOutcome,
    nextOutcomeDate: input.nextOutcomeDate ?? null,
    changedAt: input.changedAt ?? new Date(),
    changeSource: input.changeSource,
    changedByUserId: input.changedByUserId ?? null,
    reviewCandidateId: input.reviewCandidateId ?? null,
    notes: normalizeNotes(input.notes),
  })

  return true
}

export async function listRecentTrialQuestionOutcomeHistory(limit = 120): Promise<TrialQuestionOutcomeHistoryListItem[]> {
  const [storedEntries, acceptedCandidates, resolvedQuestions] = await Promise.all([
    db.query.trialQuestionOutcomeHistory.findMany({
      orderBy: [desc(trialQuestionOutcomeHistory.changedAt)],
      limit: Math.max(limit * 2, 120),
      with: {
        question: {
          with: {
            trial: true,
            markets: {
              columns: {
                id: true,
              },
            },
          },
        },
        changedByUser: {
          columns: {
            name: true,
            email: true,
          },
        },
        reviewCandidate: {
          columns: {
            id: true,
            confidence: true,
            summary: true,
            verifierModelKey: true,
            reviewedAt: true,
          },
        },
      },
    }),
    db.query.trialOutcomeCandidates.findMany({
      where: eq(trialOutcomeCandidates.status, 'accepted'),
      orderBy: [desc(trialOutcomeCandidates.reviewedAt), desc(trialOutcomeCandidates.createdAt)],
      with: {
        question: {
          with: {
            trial: true,
            markets: {
              columns: {
                id: true,
              },
            },
          },
        },
        reviewedByUser: {
          columns: {
            name: true,
            email: true,
          },
        },
      },
    }),
    db.query.trialQuestions.findMany({
      where: ne(trialQuestions.outcome, 'Pending'),
      orderBy: [desc(trialQuestions.outcomeDate), desc(trialQuestions.updatedAt)],
      with: {
        trial: true,
        markets: {
          columns: {
            id: true,
          },
        },
      },
    }),
  ])

  const storedCandidateIds = new Set(
    storedEntries
      .map((entry) => entry.reviewCandidateId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
  const storedQuestionIds = new Set(storedEntries.map((entry) => entry.trialQuestionId))

  const acceptedCandidatesByQuestionId = new Map<string, typeof acceptedCandidates>()
  for (const candidate of acceptedCandidates) {
    const existing = acceptedCandidatesByQuestionId.get(candidate.trialQuestionId)
    if (existing) {
      existing.push(candidate)
    } else {
      acceptedCandidatesByQuestionId.set(candidate.trialQuestionId, [candidate])
    }
  }

  const previousOutcomeByAcceptedCandidateId = new Map<string, {
    previousOutcome: TrialQuestionOutcomeValue | null
    previousOutcomeDate: Date | null
  }>()

  for (const questionCandidates of acceptedCandidatesByQuestionId.values()) {
    const ordered = questionCandidates
      .slice()
      .sort((left, right) => {
        const leftTime = (left.reviewedAt ?? left.createdAt).getTime()
        const rightTime = (right.reviewedAt ?? right.createdAt).getTime()
        return leftTime - rightTime
      })

    let previousOutcome: TrialQuestionOutcomeValue | null = 'Pending'
    let previousOutcomeDate: Date | null = null

    for (const candidate of ordered) {
      previousOutcomeByAcceptedCandidateId.set(candidate.id, {
        previousOutcome,
        previousOutcomeDate,
      })

      previousOutcome = candidate.proposedOutcome as TrialQuestionOutcomeValue
      previousOutcomeDate = candidate.proposedOutcomeDate ?? candidate.reviewedAt ?? candidate.updatedAt ?? candidate.createdAt
    }
  }

  const storedHistoryEntries: TrialQuestionOutcomeHistoryListItem[] = storedEntries.map((entry) => ({
    id: entry.id,
    trialQuestionId: entry.trialQuestionId,
    marketId: entry.question.markets[0]?.id ?? null,
    questionPrompt: entry.question.prompt,
    previousOutcome: (entry.previousOutcome as TrialQuestionOutcomeValue | null) ?? null,
    previousOutcomeDate: toIsoString(entry.previousOutcomeDate),
    nextOutcome: entry.nextOutcome as TrialQuestionOutcomeValue,
    nextOutcomeDate: toIsoString(entry.nextOutcomeDate),
    currentOutcome: entry.question.outcome as TrialQuestionOutcomeValue,
    currentOutcomeDate: toIsoString(entry.question.outcomeDate),
    changedAt: entry.changedAt.toISOString(),
    changeSource: entry.changeSource as TrialQuestionOutcomeHistoryChangeSource,
    changedByName: entry.changedByUser?.name ?? null,
    changedByEmail: entry.changedByUser?.email ?? null,
    notes: normalizeNotes(entry.notes),
    trial: {
      shortTitle: entry.question.trial.shortTitle,
      sponsorName: entry.question.trial.sponsorName,
      sponsorTicker: entry.question.trial.sponsorTicker,
      nctNumber: entry.question.trial.nctNumber,
    },
    candidate: entry.reviewCandidate
      ? {
          id: entry.reviewCandidate.id,
          confidence: entry.reviewCandidate.confidence,
          summary: entry.reviewCandidate.summary,
          verifierModelKey: entry.reviewCandidate.verifierModelKey,
          reviewedAt: toIsoString(entry.reviewCandidate.reviewedAt),
        }
      : null,
  }))

  const legacyAcceptedEntries: TrialQuestionOutcomeHistoryListItem[] = acceptedCandidates
    .filter((candidate) => !storedCandidateIds.has(candidate.id))
    .map((candidate) => {
      const previous = previousOutcomeByAcceptedCandidateId.get(candidate.id)
      const changedAt = candidate.reviewedAt ?? candidate.updatedAt ?? candidate.createdAt

      return {
        id: `legacy-accepted-${candidate.id}`,
        trialQuestionId: candidate.trialQuestionId,
        marketId: candidate.question.markets[0]?.id ?? null,
        questionPrompt: candidate.question.prompt,
        previousOutcome: previous?.previousOutcome ?? 'Pending',
        previousOutcomeDate: toIsoString(previous?.previousOutcomeDate),
        nextOutcome: candidate.proposedOutcome as TrialQuestionOutcomeValue,
        nextOutcomeDate: toIsoString(candidate.proposedOutcomeDate ?? changedAt),
        currentOutcome: candidate.question.outcome as TrialQuestionOutcomeValue,
        currentOutcomeDate: toIsoString(candidate.question.outcomeDate),
        changedAt: changedAt.toISOString(),
        changeSource: 'accepted_candidate_legacy',
        changedByName: candidate.reviewedByUser?.name ?? null,
        changedByEmail: candidate.reviewedByUser?.email ?? null,
        notes: normalizeNotes(candidate.reviewNotes),
        trial: {
          shortTitle: candidate.question.trial.shortTitle,
          sponsorName: candidate.question.trial.sponsorName,
          sponsorTicker: candidate.question.trial.sponsorTicker,
          nctNumber: candidate.question.trial.nctNumber,
        },
        candidate: {
          id: candidate.id,
          confidence: candidate.confidence,
          summary: candidate.summary,
          verifierModelKey: candidate.verifierModelKey,
          reviewedAt: toIsoString(candidate.reviewedAt),
        },
      }
    })

  const acceptedQuestionIds = new Set(acceptedCandidates.map((candidate) => candidate.trialQuestionId))
  const legacySnapshotEntries: TrialQuestionOutcomeHistoryListItem[] = resolvedQuestions
    .filter((question) => !storedQuestionIds.has(question.id) && !acceptedQuestionIds.has(question.id))
    .map((question) => {
      const changedAt = question.outcomeDate ?? question.updatedAt ?? question.createdAt

      return {
        id: `legacy-snapshot-${question.id}`,
        trialQuestionId: question.id,
        marketId: question.markets[0]?.id ?? null,
        questionPrompt: question.prompt,
        previousOutcome: null,
        previousOutcomeDate: null,
        nextOutcome: question.outcome as TrialQuestionOutcomeValue,
        nextOutcomeDate: toIsoString(question.outcomeDate),
        currentOutcome: question.outcome as TrialQuestionOutcomeValue,
        currentOutcomeDate: toIsoString(question.outcomeDate),
        changedAt: changedAt.toISOString(),
        changeSource: 'legacy_snapshot',
        changedByName: null,
        changedByEmail: null,
        notes: 'Derived from the current resolved question state recorded before explicit outcome audit logging was added.',
        trial: {
          shortTitle: question.trial.shortTitle,
          sponsorName: question.trial.sponsorName,
          sponsorTicker: question.trial.sponsorTicker,
          nctNumber: question.trial.nctNumber,
        },
        candidate: null,
      }
    })

  return [...storedHistoryEntries, ...legacyAcceptedEntries, ...legacySnapshotEntries]
    .sort((left, right) => compareDatesDescending(left.changedAt, right.changedAt))
    .slice(0, limit)
}
