import { and, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { db, contactMessages, pollVotes } from '@/lib/db'
import {
  fetchClinicalTrialsStudyByNctNumber,
  getClinicalTrialsNctNumber,
  type ClinicalTrialsGovStudy,
} from '@/lib/clinicaltrials-gov'
import {
  getClinicalTrialsGovStudyUrl,
  MARKET_SUGGESTION_MESSAGE_PREFIX,
  parseMarketSuggestionMessage,
} from '@/lib/market-suggestions'

export const POLL_VOTER_COOKIE_NAME = 'endpoint_arena_poll_voter'

const POLL_CANDIDATE_LIMIT = 24
const POLL_VOTER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const POLL_VOTER_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PollSuggestionSummary = {
  nctNumber: string
  suggestionCount: number
  firstSuggestedAt: string | null
  lastSuggestedAt: string | null
}

export type PollCandidate = PollSuggestionSummary & {
  title: string
  sponsorName: string
  condition: string
  phase: string
  intervention: string
  status: string
  primaryCompletionDate: string | null
  sourceUrl: string
  weeklyVotes: number
  totalVotes: number
  dataStatus: 'loaded' | 'unavailable'
}

export type PollPageData = {
  candidates: PollCandidate[]
  topThisWeek: PollCandidate[]
  candidateCount: number
  totalSuggestions: number
  weekStartDate: string
  selectedNctNumber: string | null
}

type VoteCounts = {
  weeklyVotes: number
  totalVotes: number
}

let hasWarnedMissingPollVotesTable = false

export function normalizePollNctNumber(value: string | null | undefined): string | null {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^NCT\d{8}$/.test(candidate) ? candidate : null
}

export function getPollWeekStartDate(now: Date = new Date()): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  return start
}

export function formatPollDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function getPollVoterCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: POLL_VOTER_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  }
}

export function normalizePollVoterToken(value: string | null | undefined): string | null {
  const token = typeof value === 'string' ? value.trim() : ''
  return POLL_VOTER_TOKEN_PATTERN.test(token) ? token : null
}

export async function getPollVoterHash(token: string): Promise<string> {
  const salt = process.env.POLL_VOTE_SALT?.trim() || 'endpoint-arena-poll-v1'
  const payload = new TextEncoder().encode(`${salt}:${token}`)
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function titleizeToken(value: string | null | undefined): string {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return 'Unknown'

  return normalized
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function summarizeList(values: Array<string | null | undefined> | null | undefined, fallback: string, limit = 4): string {
  const uniqueValues = Array.from(new Set((values ?? []).map(normalizeWhitespace).filter(Boolean)))
  if (uniqueValues.length === 0) return fallback

  const visible = uniqueValues.slice(0, limit)
  const suffix = uniqueValues.length > visible.length ? ` +${uniqueValues.length - visible.length} more` : ''
  return `${visible.join('; ')}${suffix}`
}

function summarizeInterventions(study: ClinicalTrialsGovStudy): string {
  const interventions = study.protocolSection?.armsInterventionsModule?.interventions ?? []
  const names = interventions.map((intervention) => intervention.name)
  return summarizeList(names, 'Intervention not listed')
}

function summarizePhases(study: ClinicalTrialsGovStudy): string {
  return summarizeList(study.protocolSection?.designModule?.phases, 'Phase not listed', 2)
}

function getStudyPrimaryCompletionDate(study: ClinicalTrialsGovStudy): string | null {
  return normalizeWhitespace(study.protocolSection?.statusModule?.primaryCompletionDateStruct?.date) || null
}

function getStudyTitle(study: ClinicalTrialsGovStudy, nctNumber: string): string {
  return normalizeWhitespace(
    study.protocolSection?.identificationModule?.briefTitle
    ?? study.protocolSection?.identificationModule?.officialTitle
  ) || nctNumber
}

function getStudySponsor(study: ClinicalTrialsGovStudy): string {
  return normalizeWhitespace(study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name) || 'Sponsor not listed'
}

function getStudyCondition(study: ClinicalTrialsGovStudy): string {
  return summarizeList(study.protocolSection?.conditionsModule?.conditions, 'Condition not listed', 3)
}

function getStudyStatus(study: ClinicalTrialsGovStudy): string {
  return titleizeToken(study.protocolSection?.statusModule?.overallStatus)
}

function sortSuggestionsByPriority(
  suggestions: PollSuggestionSummary[],
  voteCountsByNct: Map<string, VoteCounts>,
): PollSuggestionSummary[] {
  return [...suggestions].sort((a, b) => {
    const aCounts = voteCountsByNct.get(a.nctNumber)
    const bCounts = voteCountsByNct.get(b.nctNumber)
    const aLast = a.lastSuggestedAt ? new Date(a.lastSuggestedAt).getTime() : 0
    const bLast = b.lastSuggestedAt ? new Date(b.lastSuggestedAt).getTime() : 0

    return (bCounts?.weeklyVotes ?? 0) - (aCounts?.weeklyVotes ?? 0)
      || (bCounts?.totalVotes ?? 0) - (aCounts?.totalVotes ?? 0)
      || b.suggestionCount - a.suggestionCount
      || bLast - aLast
      || a.nctNumber.localeCompare(b.nctNumber)
  })
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

function isMissingPollVotesTableError(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { cause?: unknown, code?: unknown, message?: unknown }
    const code = typeof candidate.code === 'string' ? candidate.code : ''
    const message = typeof candidate.message === 'string' ? candidate.message : ''

    if (code === '42P01' && message.includes('poll_votes')) {
      return true
    }

    current = candidate.cause
  }

  return false
}

function warnMissingPollVotesTable(): void {
  if (hasWarnedMissingPollVotesTable) return

  hasWarnedMissingPollVotesTable = true
  console.warn('[poll] poll_votes table is missing; rendering poll without vote counts or selected vote state.')
}

async function getSuggestedPollNcts(): Promise<{
  suggestions: PollSuggestionSummary[]
  totalSuggestions: number
}> {
  const messages = await db.query.contactMessages.findMany({
    columns: {
      message: true,
      createdAt: true,
    },
    where: like(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`),
    orderBy: [desc(contactMessages.createdAt)],
  })

  const suggestionByNct = new Map<string, PollSuggestionSummary>()

  for (const message of messages) {
    const parsed = parseMarketSuggestionMessage(message.message)
    const nctNumber = normalizePollNctNumber(parsed?.nctNumber)
    if (!nctNumber) continue

    const createdAt = message.createdAt ? message.createdAt.toISOString() : null
    const existing = suggestionByNct.get(nctNumber)

    if (!existing) {
      suggestionByNct.set(nctNumber, {
        nctNumber,
        suggestionCount: 1,
        firstSuggestedAt: createdAt,
        lastSuggestedAt: createdAt,
      })
      continue
    }

    existing.suggestionCount += 1
    if (createdAt && (!existing.lastSuggestedAt || createdAt > existing.lastSuggestedAt)) {
      existing.lastSuggestedAt = createdAt
    }
    if (createdAt && (!existing.firstSuggestedAt || createdAt < existing.firstSuggestedAt)) {
      existing.firstSuggestedAt = createdAt
    }
  }

  return {
    suggestions: Array.from(suggestionByNct.values()),
    totalSuggestions: messages.length,
  }
}

export async function isSuggestedPollNctNumber(nctNumber: string): Promise<boolean> {
  const normalizedNctNumber = normalizePollNctNumber(nctNumber)
  if (!normalizedNctNumber) return false

  const { suggestions } = await getSuggestedPollNcts()
  return suggestions.some((suggestion) => suggestion.nctNumber === normalizedNctNumber)
}

async function getPollVoteCounts(
  nctNumbers: string[],
  weekStartDate: Date,
): Promise<Map<string, VoteCounts>> {
  const normalizedNctNumbers = Array.from(new Set(nctNumbers.map(normalizePollNctNumber).filter(Boolean))) as string[]
  const countsByNct = new Map<string, VoteCounts>(
    normalizedNctNumbers.map((nctNumber) => [nctNumber, { weeklyVotes: 0, totalVotes: 0 }])
  )

  if (normalizedNctNumbers.length === 0) {
    return countsByNct
  }

  const [weeklyRows, totalRows] = await Promise.all([
    db
      .select({
        nctNumber: pollVotes.nctNumber,
        count: sql<number>`count(*)::int`,
      })
      .from(pollVotes)
      .where(and(
        eq(pollVotes.weekStartDate, weekStartDate),
        inArray(pollVotes.nctNumber, normalizedNctNumbers),
      ))
      .groupBy(pollVotes.nctNumber),
    db
      .select({
        nctNumber: pollVotes.nctNumber,
        count: sql<number>`count(*)::int`,
      })
      .from(pollVotes)
      .where(inArray(pollVotes.nctNumber, normalizedNctNumbers))
      .groupBy(pollVotes.nctNumber),
  ]).catch((error: unknown) => {
    if (isMissingPollVotesTableError(error)) {
      warnMissingPollVotesTable()
      return [[], []] as const
    }

    throw error
  })

  for (const row of weeklyRows) {
    const counts = countsByNct.get(row.nctNumber)
    if (counts) counts.weeklyVotes = row.count
  }

  for (const row of totalRows) {
    const counts = countsByNct.get(row.nctNumber)
    if (counts) counts.totalVotes = row.count
  }

  return countsByNct
}

async function hydratePollCandidate(
  suggestion: PollSuggestionSummary,
  counts: VoteCounts,
): Promise<PollCandidate> {
  const fallbackCandidate: PollCandidate = {
    ...suggestion,
    title: suggestion.nctNumber,
    sponsorName: 'ClinicalTrials.gov record unavailable',
    condition: 'Condition not available',
    phase: 'Phase not available',
    intervention: 'Intervention not available',
    status: 'Unavailable',
    primaryCompletionDate: null,
    sourceUrl: getClinicalTrialsGovStudyUrl(suggestion.nctNumber),
    weeklyVotes: counts.weeklyVotes,
    totalVotes: counts.totalVotes,
    dataStatus: 'unavailable',
  }

  try {
    const study = await fetchClinicalTrialsStudyByNctNumber(suggestion.nctNumber)
    if (!study) return fallbackCandidate

    const nctNumber = getClinicalTrialsNctNumber(study) ?? suggestion.nctNumber

    return {
      ...suggestion,
      nctNumber,
      title: getStudyTitle(study, nctNumber),
      sponsorName: getStudySponsor(study),
      condition: getStudyCondition(study),
      phase: summarizePhases(study),
      intervention: summarizeInterventions(study),
      status: getStudyStatus(study),
      primaryCompletionDate: getStudyPrimaryCompletionDate(study),
      sourceUrl: getClinicalTrialsGovStudyUrl(nctNumber),
      weeklyVotes: counts.weeklyVotes,
      totalVotes: counts.totalVotes,
      dataStatus: 'loaded',
    }
  } catch {
    return fallbackCandidate
  }
}

async function getCurrentPollVoteNctNumber(input: {
  voterHash: string
  weekStartDate: Date
}): Promise<string | null> {
  const [vote] = await db
    .select({
      nctNumber: pollVotes.nctNumber,
    })
    .from(pollVotes)
    .where(and(
      eq(pollVotes.voterHash, input.voterHash),
      eq(pollVotes.weekStartDate, input.weekStartDate),
    ))
    .limit(1)
    .catch((error: unknown) => {
      if (isMissingPollVotesTableError(error)) {
        warnMissingPollVotesTable()
        return []
      }

      throw error
    })

  return vote?.nctNumber ?? null
}

export async function recordPollVote(input: {
  nctNumber: string
  voterHash: string
  weekStartDate?: Date
  now?: Date
}): Promise<{
  nctNumber: string
  weekStartDate: Date
}> {
  const nctNumber = normalizePollNctNumber(input.nctNumber)
  if (!nctNumber) {
    throw new Error('Invalid NCT number')
  }

  const now = input.now ?? new Date()
  const weekStartDate = input.weekStartDate ?? getPollWeekStartDate(now)

  await db
    .insert(pollVotes)
    .values({
      nctNumber,
      voterHash: input.voterHash,
      weekStartDate,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [pollVotes.voterHash, pollVotes.weekStartDate],
      set: {
        nctNumber,
        updatedAt: now,
      },
    })

  return {
    nctNumber,
    weekStartDate,
  }
}

export async function getPollPageData(input: {
  voterHash?: string | null
  now?: Date
} = {}): Promise<PollPageData> {
  const now = input.now ?? new Date()
  const weekStartDate = getPollWeekStartDate(now)
  const { suggestions, totalSuggestions } = await getSuggestedPollNcts()
  const countsByNct = await getPollVoteCounts(
    suggestions.map((suggestion) => suggestion.nctNumber),
    weekStartDate,
  )
  const visibleSuggestions = sortSuggestionsByPriority(suggestions, countsByNct).slice(0, POLL_CANDIDATE_LIMIT)

  const [candidates, selectedNctNumber] = await Promise.all([
    Promise.all(visibleSuggestions.map((suggestion) => hydratePollCandidate(
      suggestion,
      countsByNct.get(suggestion.nctNumber) ?? { weeklyVotes: 0, totalVotes: 0 },
    ))),
    input.voterHash
      ? getCurrentPollVoteNctNumber({ voterHash: input.voterHash, weekStartDate })
      : Promise.resolve(null),
  ])
  const sortedCandidates = sortCandidates(candidates)

  return {
    candidates: sortedCandidates,
    topThisWeek: sortedCandidates.filter((candidate) => candidate.weeklyVotes > 0).slice(0, 5),
    candidateCount: suggestions.length,
    totalSuggestions,
    weekStartDate: formatPollDate(weekStartDate),
    selectedNctNumber,
  }
}
