import crypto from 'node:crypto'
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm'
import OpenAI from 'openai'
import {
  db,
  eventMonitorRuns,
  eventOutcomeCandidateEvidence,
  eventOutcomeCandidates,
  fdaCalendarEvents,
} from '@/lib/db'
import { getDaysUntilUtc } from '@/lib/date'
import { enrichFdaEvents } from '@/lib/fda-event-metadata'
import { ConfigurationError, ConflictError, ExternalServiceError } from '@/lib/errors'
import { getEventMonitorConfig, type EventMonitorConfig } from '@/lib/event-monitor-config'

const HOUR_MS = 60 * 60 * 1000
const MAX_ERROR_SUMMARY_LENGTH = 1200
const EVENT_MONITOR_STALE_TIMEOUT_MINUTES = 20
const EVENT_MONITOR_STALE_TIMEOUT_SECONDS = EVENT_MONITOR_STALE_TIMEOUT_MINUTES * 60

type MonitorTriggerSource = 'cron' | 'manual'
type CandidateEvidenceSourceType = 'fda' | 'sponsor' | 'stored_source' | 'web_search'
type VerifierClassification = 'approved' | 'rejected' | 'no_decision'

type MonitorEvent = typeof fdaCalendarEvents.$inferSelect & {
  externalKey: string | null
  source: string | null
  newsLinks: string[]
  nctId: string | null
  rttDetailId: string | null
  rivalDrugs: string | null
  marketPotential: string | null
  otherApprovals: string | null
  metaAnalysis: string | null
}

type VerifierEvidence = {
  sourceType: CandidateEvidenceSourceType
  title: string
  url: string
  publishedAt: Date | null
  excerpt: string
  domain: string
}

type VerifierDecision = {
  classification: VerifierClassification
  confidence: number
  proposedOutcomeDate: Date | null
  summary: string
  evidence: VerifierEvidence[]
}

export type EventMonitorRunResult = {
  executed: boolean
  reason?: 'disabled' | 'not_due'
  runId?: string
  eventsScanned: number
  candidatesCreated: number
  nextEligibleAt?: string
  errors: string[]
}

function normalizeDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + (hours * HOUR_MS))
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getHostname(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isFdaDomain(hostname: string | null): boolean {
  if (!hostname) return false
  return hostname === 'fda.gov'
    || hostname.endsWith('.fda.gov')
    || hostname === 'accessdata.fda.gov'
    || hostname.endsWith('.accessdata.fda.gov')
}

function buildEvidenceHash(outcome: 'Approved' | 'Rejected', evidenceUrls: string[]): string {
  const normalized = Array.from(new Set(
    evidenceUrls
      .map((url) => url.trim().toLowerCase())
      .filter(Boolean),
  )).sort()

  return crypto.createHash('sha256')
    .update(JSON.stringify({ outcome, urls: normalized }))
    .digest('hex')
}

function extractResponseText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim()
  }

  const messages = Array.isArray(response?.output)
    ? response.output.filter((item: any) => item?.type === 'message')
    : []
  const parts: string[] = []

  for (const message of messages) {
    for (const content of message?.content ?? []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') {
        const text = content.text.trim()
        if (text) parts.push(text)
      }
    }
  }

  return parts.join('\n').trim()
}

function stripJsonFences(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```')) return trimmed

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractJsonObject(value: string): string {
  const trimmed = stripJsonFences(value)

  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return trimmed.slice(start, end + 1)
    }
    return trimmed
  }
}

function coerceConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(1, parsed))
}

function coerceTimestamp(value: unknown): Date | null {
  if (value == null) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function inferEvidenceSourceType(
  value: unknown,
  url: string,
  event: Pick<MonitorEvent, 'source' | 'newsLinks'>,
): CandidateEvidenceSourceType {
  if (value === 'fda' || value === 'sponsor' || value === 'stored_source' || value === 'web_search') {
    return value
  }

  const hostname = getHostname(url)
  if (isFdaDomain(hostname)) return 'fda'

  const primaryHostname = getHostname(event.source)
  if (hostname && primaryHostname && hostname === primaryHostname) {
    return 'sponsor'
  }

  const storedHostnames = new Set(
    [event.source, ...event.newsLinks]
      .map((entry) => getHostname(entry))
      .filter((entry): entry is string => Boolean(entry)),
  )

  if (hostname && storedHostnames.has(hostname)) {
    return 'stored_source'
  }

  return 'web_search'
}

function parseEvidence(
  value: unknown,
  event: Pick<MonitorEvent, 'source' | 'newsLinks'>,
): VerifierEvidence[] {
  if (!Array.isArray(value)) return []

  const seenUrls = new Set<string>()
  const result: VerifierEvidence[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object') continue

    const record = item as {
      sourceType?: unknown
      title?: unknown
      url?: unknown
      publishedAt?: unknown
      excerpt?: unknown
    }

    const url = trimToNull(record.url)
    const title = trimToNull(record.title)
    const excerpt = trimToNull(record.excerpt)

    if (!url || !title || !excerpt) continue

    const normalizedUrl = url.trim()
    if (seenUrls.has(normalizedUrl)) continue

    const domain = getHostname(normalizedUrl)
    if (!domain) continue

    seenUrls.add(normalizedUrl)
    result.push({
      sourceType: inferEvidenceSourceType(record.sourceType, normalizedUrl, event),
      title,
      url: normalizedUrl,
      publishedAt: coerceTimestamp(record.publishedAt),
      excerpt,
      domain,
    })
  }

  return result
}

function parseVerifierDecision(
  rawResponse: string,
  event: Pick<MonitorEvent, 'source' | 'newsLinks'>,
): VerifierDecision {
  const payload = JSON.parse(extractJsonObject(rawResponse)) as {
    classification?: unknown
    confidence?: unknown
    proposedOutcomeDate?: unknown
    summary?: unknown
    evidence?: unknown
  }

  const classification = payload.classification === 'approved'
    || payload.classification === 'rejected'
    || payload.classification === 'no_decision'
    ? payload.classification
    : 'no_decision'

  const summary = trimToNull(payload.summary) ?? 'No decision signal found.'

  return {
    classification,
    confidence: coerceConfidence(payload.confidence),
    proposedOutcomeDate: coerceTimestamp(payload.proposedOutcomeDate),
    summary,
    evidence: parseEvidence(payload.evidence, event),
  }
}

function buildVerifierPrompt(event: MonitorEvent, today: Date): string {
  const decisionDateLabel = event.decisionDate.toISOString().slice(0, 10)
  const storedSources = [event.source, ...event.newsLinks].filter((value): value is string => Boolean(value))
  const storedSourcesBlock = storedSources.length > 0
    ? storedSources.map((url, index) => `${index + 1}. ${url}`).join('\n')
    : 'None'

  return [
    `Today is ${today.toISOString().slice(0, 10)} UTC.`,
    'You are verifying whether a pending FDA-related decision event now has a final outcome.',
    '',
    'Event facts:',
    `- Company: ${event.companyName}`,
    `- Drug: ${event.drugName}`,
    `- Application type: ${event.applicationType}`,
    `- Decision date: ${decisionDateLabel}`,
    `- Decision date kind: ${event.decisionDateKind}`,
    `- Current outcome: ${event.outcome}`,
    `- Therapeutic area: ${event.therapeuticArea ?? 'Unknown'}`,
    `- Event description: ${event.eventDescription}`,
    `- Drug status: ${event.drugStatus ?? 'Unknown'}`,
    `- NCT ID: ${event.nctId ?? 'Unknown'}`,
    '',
    'Stored source URLs (check these first):',
    storedSourcesBlock,
    '',
    'Instructions:',
    '- Prefer FDA materials, sponsor press releases, and clearly attributable company announcements.',
    '- Use web search only if the stored URLs are missing, stale, or inconclusive.',
    '- Only classify approved or rejected if there is clear evidence that FDA made a final decision for this event.',
    '- If evidence is mixed, outdated, or only discusses expectations, return no_decision.',
    '- Evidence items must use absolute URLs and brief excerpts.',
    '- Return JSON only.',
    '',
    'JSON schema:',
    '{',
    '  "classification": "approved" | "rejected" | "no_decision",',
    '  "confidence": number,',
    '  "proposedOutcomeDate": string | null,',
    '  "summary": string,',
    '  "evidence": [',
    '    {',
    '      "sourceType": "fda" | "sponsor" | "stored_source" | "web_search",',
    '      "title": string,',
    '      "url": string,',
    '      "publishedAt": string | null,',
    '      "excerpt": string',
    '    }',
    '  ]',
    '}',
  ].join('\n')
}

function isCandidateStrongEnough(
  decision: VerifierDecision,
  config: EventMonitorConfig,
): decision is VerifierDecision & { classification: 'approved' | 'rejected' } {
  return (decision.classification === 'approved' || decision.classification === 'rejected')
    && decision.confidence >= config.minCandidateConfidence
    && decision.evidence.some((item) => item.url.trim().length > 0)
}

function getOutcomeFromClassification(classification: 'approved' | 'rejected'): 'Approved' | 'Rejected' {
  return classification === 'approved' ? 'Approved' : 'Rejected'
}

function summarizeErrors(messages: string[]): string | null {
  if (messages.length === 0) return null
  const combined = messages.join(' | ')
  return combined.length <= MAX_ERROR_SUMMARY_LENGTH
    ? combined
    : `${combined.slice(0, MAX_ERROR_SUMMARY_LENGTH - 1)}…`
}

async function failStaleRunningEventMonitorRuns(now: Date): Promise<void> {
  await db.update(eventMonitorRuns)
    .set({
      status: 'failed',
      errorSummary: `Auto-failed stale monitor run after ${EVENT_MONITOR_STALE_TIMEOUT_MINUTES}m without heartbeat updates.`,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(eventMonitorRuns.status, 'running'),
      sql`COALESCE(${eventMonitorRuns.updatedAt}, ${eventMonitorRuns.startedAt}) < NOW() - (${EVENT_MONITOR_STALE_TIMEOUT_SECONDS} * INTERVAL '1 second')`,
    ))
}

async function getActiveEventMonitorRun() {
  return db.query.eventMonitorRuns.findFirst({
    where: eq(eventMonitorRuns.status, 'running'),
    orderBy: [desc(eventMonitorRuns.updatedAt), desc(eventMonitorRuns.startedAt)],
  })
}

async function createRunningEventMonitorRun(args: {
  now: Date
  triggerSource: MonitorTriggerSource
}) {
  const activeRun = await getActiveEventMonitorRun()
  if (activeRun) {
    throw new ConflictError(
      `An event monitor run is already in progress (started ${activeRun.startedAt.toISOString()}). Wait for it to finish before starting another run.`
    )
  }

  const [run] = await db.insert(eventMonitorRuns)
    .values({
      triggerSource: args.triggerSource,
      status: 'running',
      eventsScanned: 0,
      candidatesCreated: 0,
      startedAt: args.now,
      updatedAt: args.now,
    })
    .returning()

  return run
}

async function heartbeatEventMonitorRun(args: {
  runId: string
  eventsScanned: number
  candidatesCreated: number
  errors: string[]
}) {
  await db.update(eventMonitorRuns)
    .set({
      eventsScanned: args.eventsScanned,
      candidatesCreated: args.candidatesCreated,
      errorSummary: summarizeErrors(args.errors),
      updatedAt: new Date(),
    })
    .where(and(
      eq(eventMonitorRuns.id, args.runId),
      eq(eventMonitorRuns.status, 'running'),
    ))
}

async function selectEventsToMonitor(config: EventMonitorConfig, today: Date): Promise<MonitorEvent[]> {
  const pendingEvents = await db.query.fdaCalendarEvents.findMany({
    where: eq(fdaCalendarEvents.outcome, 'Pending'),
    orderBy: [asc(fdaCalendarEvents.decisionDate), asc(fdaCalendarEvents.companyName), asc(fdaCalendarEvents.drugName)],
  })

  const overdueCutoff = addHours(today, -config.overdueRecheckHours)
  const enrichedEvents = await enrichFdaEvents(pendingEvents)

  return enrichedEvents
    .filter((event) => {
      const daysUntil = getDaysUntilUtc(event.decisionDate, today)
      if (daysUntil == null) return false

      if (daysUntil < 0) {
        return !event.lastMonitoredAt || event.lastMonitoredAt.getTime() <= overdueCutoff.getTime()
      }

      const lookahead = event.decisionDateKind === 'soft'
        ? config.softLookaheadDays
        : config.hardLookaheadDays

      return daysUntil <= lookahead
    })
    .sort((a, b) => {
      const aDaysUntil = getDaysUntilUtc(a.decisionDate, today) ?? Number.MAX_SAFE_INTEGER
      const bDaysUntil = getDaysUntilUtc(b.decisionDate, today) ?? Number.MAX_SAFE_INTEGER

      const aPriority =
        aDaysUntil < 0
          ? (a.decisionDateKind === 'hard' ? 0 : 1)
          : (a.decisionDateKind === 'hard' ? 2 : 3)
      const bPriority =
        bDaysUntil < 0
          ? (b.decisionDateKind === 'hard' ? 0 : 1)
          : (b.decisionDateKind === 'hard' ? 2 : 3)

      if (aPriority !== bPriority) return aPriority - bPriority

      const dateDiff = a.decisionDate.getTime() - b.decisionDate.getTime()
      if (dateDiff !== 0) return dateDiff

      return a.drugName.localeCompare(b.drugName)
    })
    .slice(0, config.maxEventsPerRun)
}

async function createOrUpdateCandidate(args: {
  eventId: string
  outcome: 'Approved' | 'Rejected'
  proposedOutcomeDate: Date | null
  confidence: number
  summary: string
  verifierModelKey: string
  providerResponseId: string | null
  evidence: VerifierEvidence[]
}): Promise<{ created: boolean }> {
  const evidenceHash = buildEvidenceHash(args.outcome, args.evidence.map((item) => item.url))
  const now = new Date()

  return db.transaction(async (tx) => {
    const existingRows = await tx.select()
      .from(eventOutcomeCandidates)
      .where(and(
        eq(eventOutcomeCandidates.eventId, args.eventId),
        eq(eventOutcomeCandidates.proposedOutcome, args.outcome),
        eq(eventOutcomeCandidates.evidenceHash, evidenceHash),
      ))
      .limit(1)

    const existing = existingRows[0]
    if (existing) {
      if (existing.status !== 'pending_review') {
        return { created: false }
      }

      await tx.update(eventOutcomeCandidates)
        .set({
          proposedOutcomeDate: args.proposedOutcomeDate,
          confidence: args.confidence,
          summary: args.summary,
          verifierModelKey: args.verifierModelKey,
          providerResponseId: args.providerResponseId,
          updatedAt: now,
        })
        .where(eq(eventOutcomeCandidates.id, existing.id))

      await tx.delete(eventOutcomeCandidateEvidence)
        .where(eq(eventOutcomeCandidateEvidence.candidateId, existing.id))

      if (args.evidence.length > 0) {
        await tx.insert(eventOutcomeCandidateEvidence).values(
          args.evidence.map((item, index) => ({
            candidateId: existing.id,
            sourceType: item.sourceType,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            excerpt: item.excerpt,
            domain: item.domain,
            displayOrder: index,
            createdAt: now,
          })),
        )
      }

      return { created: false }
    }

    const [candidate] = await tx.insert(eventOutcomeCandidates)
      .values({
        eventId: args.eventId,
        proposedOutcome: args.outcome,
        proposedOutcomeDate: args.proposedOutcomeDate,
        confidence: args.confidence,
        summary: args.summary,
        verifierModelKey: args.verifierModelKey,
        providerResponseId: args.providerResponseId,
        evidenceHash,
        status: 'pending_review',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (args.evidence.length > 0) {
      await tx.insert(eventOutcomeCandidateEvidence).values(
        args.evidence.map((item, index) => ({
          candidateId: candidate.id,
          sourceType: item.sourceType,
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          excerpt: item.excerpt,
          domain: item.domain,
          displayOrder: index,
          createdAt: now,
        })),
      )
    }

    return { created: true }
  })
}

async function runVerifierForEvent(
  client: OpenAI,
  config: EventMonitorConfig,
  event: MonitorEvent,
  today: Date,
): Promise<{ createdCandidate: boolean; providerResponseId: string | null }> {
  const prompt = buildVerifierPrompt(event, today)

  const response = await client.responses.create({
    model: config.verifierModelKey,
    input: prompt,
    max_output_tokens: 4000,
    tools: [{ type: 'web_search' }],
    reasoning: { effort: 'high' },
    include: ['web_search_call.action.sources'],
  } as any)

  const rawText = extractResponseText(response)
  if (!rawText) {
    throw new ExternalServiceError(`No content in verifier response for ${event.drugName}`)
  }

  let decision: VerifierDecision
  try {
    decision = parseVerifierDecision(rawText, event)
  } catch (error) {
    throw new ExternalServiceError(
      `Failed to parse verifier response for ${event.drugName}`,
      { cause: error },
    )
  }

  const providerResponseId = typeof (response as any)?.id === 'string' ? (response as any).id : null

  if (!isCandidateStrongEnough(decision, config)) {
    return { createdCandidate: false, providerResponseId }
  }

  const outcome = getOutcomeFromClassification(decision.classification)
  const result = await createOrUpdateCandidate({
    eventId: event.id,
    outcome,
    proposedOutcomeDate: decision.proposedOutcomeDate,
    confidence: decision.confidence,
    summary: decision.summary,
    verifierModelKey: config.verifierModelKey,
    providerResponseId,
    evidence: decision.evidence,
  })

  return {
    createdCandidate: result.created,
    providerResponseId,
  }
}

async function markEventMonitored(eventId: string, monitoredAt: Date): Promise<void> {
  await db.update(fdaCalendarEvents)
    .set({ lastMonitoredAt: monitoredAt })
    .where(eq(fdaCalendarEvents.id, eventId))
}

async function getLastMonitorRun() {
  return db.query.eventMonitorRuns.findFirst({
    orderBy: [desc(eventMonitorRuns.startedAt)],
  })
}

export async function runEventMonitor(args: {
  triggerSource: MonitorTriggerSource
  force?: boolean
}): Promise<EventMonitorRunResult> {
  const config = await getEventMonitorConfig()
  const now = new Date()

  await failStaleRunningEventMonitorRuns(now)

  if (!args.force && !config.enabled) {
    return {
      executed: false,
      reason: 'disabled',
      eventsScanned: 0,
      candidatesCreated: 0,
      errors: [],
    }
  }

  if (!args.force) {
    const lastRun = await getLastMonitorRun()
    if (lastRun) {
      const nextEligibleAt = addHours(lastRun.startedAt, config.runIntervalHours)
      if (nextEligibleAt.getTime() > now.getTime()) {
        return {
          executed: false,
          reason: 'not_due',
          eventsScanned: 0,
          candidatesCreated: 0,
          nextEligibleAt: nextEligibleAt.toISOString(),
          errors: [],
        }
      }
    }
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new ConfigurationError('OPENAI_API_KEY is required to run the event monitor')
  }

  const run = await createRunningEventMonitorRun({
    now,
    triggerSource: args.triggerSource,
  })

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const errors: string[] = []
  let eventsScanned = 0
  let candidatesCreated = 0

  try {
    const today = normalizeDateOnly(now)
    const events = await selectEventsToMonitor(config, today)

    for (const event of events) {
      await heartbeatEventMonitorRun({
        runId: run.id,
        eventsScanned,
        candidatesCreated,
        errors,
      })

      try {
        const result = await runVerifierForEvent(client, config, event, today)
        if (result.createdCandidate) {
          candidatesCreated += 1
        }
        await markEventMonitored(event.id, new Date())
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to monitor ${event.drugName}`
        errors.push(`${event.drugName}: ${message}`)
      } finally {
        eventsScanned += 1
        await heartbeatEventMonitorRun({
          runId: run.id,
          eventsScanned,
          candidatesCreated,
          errors,
        })
      }
    }

    await db.update(eventMonitorRuns)
      .set({
        status: 'completed',
        eventsScanned,
        candidatesCreated,
        errorSummary: summarizeErrors(errors),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(eventMonitorRuns.id, run.id),
        eq(eventMonitorRuns.status, 'running'),
      ))

    return {
      executed: true,
      runId: run.id,
      eventsScanned,
      candidatesCreated,
      errors,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Event monitor failed'
    errors.push(message)

    await db.update(eventMonitorRuns)
      .set({
        status: 'failed',
        eventsScanned,
        candidatesCreated,
        errorSummary: summarizeErrors(errors),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(eventMonitorRuns.id, run.id))

    throw error
  }
}

export async function listPendingOutcomeCandidates(limit = 50) {
  return db.query.eventOutcomeCandidates.findMany({
    where: eq(eventOutcomeCandidates.status, 'pending_review'),
    with: {
      event: true,
      evidence: true,
    },
    orderBy: [desc(eventOutcomeCandidates.createdAt)],
    limit,
  })
}

export async function listRecentEventMonitorRuns(limit = 10) {
  await failStaleRunningEventMonitorRuns(new Date())

  return db.query.eventMonitorRuns.findMany({
    orderBy: [desc(eventMonitorRuns.startedAt)],
    limit,
  })
}

export async function listOverdueSoftEvents(limit = 25) {
  const today = normalizeDateOnly(new Date())
  return db.query.fdaCalendarEvents.findMany({
    where: and(
      eq(fdaCalendarEvents.outcome, 'Pending'),
      eq(fdaCalendarEvents.decisionDateKind, 'soft'),
      lt(fdaCalendarEvents.decisionDate, today),
    ),
    orderBy: [asc(fdaCalendarEvents.decisionDate), asc(fdaCalendarEvents.drugName)],
    limit,
  })
}
