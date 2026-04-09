import { and, asc, desc, eq, like, ne, or, sql } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import {
  db,
  phase2Trials,
  trialMonitorRuns,
  trialOutcomeCandidateEvidence,
  trialOutcomeCandidates,
  trialQuestions,
} from '@/lib/db'
import { ConfigurationError, ConflictError, ExternalServiceError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveMarketForTrialQuestion } from '@/lib/markets/engine'
import { buildTrialOutcomeEvidenceHash } from '@/lib/trial-outcome-candidate-hash'
import { recordTrialQuestionOutcomeHistory } from '@/lib/trial-outcome-history'
import { getTrialMonitorConfig, type TrialMonitorConfig } from '@/lib/trial-monitor-config'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import {
  ensureTrialMonitorVerifierConfigured,
  getTrialMonitorVerifierSpec,
  normalizeTrialMonitorVerifierModelKey,
  type TrialMonitorVerifierModelKey,
} from '@/lib/trial-monitor-verifier-models'

const HOUR_MS = 60 * 60 * 1000
const TRIAL_MONITOR_STALE_TIMEOUT_MINUTES = 20
const TRIAL_MONITOR_STALE_TIMEOUT_SECONDS = TRIAL_MONITOR_STALE_TIMEOUT_MINUTES * 60
const VERIFIER_REQUEST_TIMEOUT_MS = 2 * 60 * 1000
const MAX_VERIFIER_SOURCE_COUNT = 3
const MAX_VERIFIER_TITLE_CHARS = 220
const MAX_VERIFIER_REASONING_CHARS = 420
const MAX_VERIFIER_EXCERPT_CHARS = 320
const VERIFIER_MAX_OUTPUT_TOKENS = 3200
const TRIAL_MONITOR_DEBUG_LOG_MAX_CHARS = 80_000
const TRIAL_MONITOR_DEBUG_VALUE_MAX_CHARS = 12_000
const TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT = 40
const TRIAL_MONITOR_MIN_CONCURRENCY = 1
const TRIAL_MONITOR_MAX_CONCURRENCY = 12
const TRIAL_MONITOR_STOP_REQUEST_MESSAGE =
  'Pause requested by admin. Finish the current in-flight trial check, then halt the run.'
const TRIAL_MONITOR_PAUSED_MESSAGE =
  'Trial monitor paused by admin after the current in-flight trial check.'
type MonitorTriggerSource = 'cron' | 'manual'
type CandidateEvidenceSourceType = 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search'
type VerifierClassification = 'yes' | 'no' | 'no_decision'
type CandidateOutcome = 'YES' | 'NO' | 'NO_DECISION'
type MonitorDebugStage = 'verifier' | 'run'
type MonitorDebugLevel = 'info' | 'warn' | 'error'
type MonitorDebugAttempt = 'initial' | 'retry'
type TrialMonitorQuestionSelection = 'eligible_queue' | 'specific_nct'
type SourceExtractionMethod =
  | 'openai_web_search_sources'
  | 'xai_web_search_sources'
  | 'google_grounding_metadata'
  | 'anthropic_web_search_tool_result'
  | 'none'

type TrialQuestionWithTrial = typeof trialQuestions.$inferSelect & {
  trial: typeof phase2Trials.$inferSelect
}

export type EligibleTrialOutcomeQuestion = {
  id: string
  prompt: string
  trial: {
    shortTitle: string
    sponsorName: string
    sponsorTicker: string | null
    nctNumber: string | null
    estPrimaryCompletionDate: Date
    lastMonitoredAt: Date | null
  }
}

export type ManualTrialOutcomeQueueItem = {
  id: string
  prompt: string
  trial: {
    id: string
    shortTitle: string
    sponsorName: string
    sponsorTicker: string | null
    nctNumber: string
    exactPhase: string
    indication: string
    intervention: string
    primaryEndpoint: string
    currentStatus: string
    estPrimaryCompletionDate: Date
    briefSummary: string
    lastMonitoredAt: Date | null
  }
}

function compareTrialMonitorQuestionsByPriority(left: TrialQuestionWithTrial, right: TrialQuestionWithTrial): number {
  const leftTime = left.trial.estPrimaryCompletionDate.getTime()
  const rightTime = right.trial.estPrimaryCompletionDate.getTime()
  if (leftTime !== rightTime) return leftTime - rightTime
  return left.trial.shortTitle.localeCompare(right.trial.shortTitle)
}

async function listMonitorableTrialOutcomeQuestionsInternal(): Promise<TrialQuestionWithTrial[]> {
  return await db.query.trialQuestions.findMany({
    where: and(
      eq(trialQuestions.status, 'live'),
      eq(trialQuestions.isBettable, true),
      eq(trialQuestions.outcome, 'Pending'),
    ),
    with: {
      trial: true,
    },
    orderBy: [asc(trialQuestions.sortOrder), asc(trialQuestions.createdAt)],
  }) as TrialQuestionWithTrial[]
}

async function getEligibleTrialOutcomeQuestionsInternal(config: Awaited<ReturnType<typeof getTrialMonitorConfig>>): Promise<TrialQuestionWithTrial[]> {
  const now = new Date()
  const allQuestions = await listMonitorableTrialOutcomeQuestionsInternal()

  return allQuestions
    .filter((question) => isQuestionEligible(question, now, config.lookaheadDays, config.overdueRecheckHours))
    .sort(compareTrialMonitorQuestionsByPriority)
    .slice(0, config.maxQuestionsPerRun)
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

type StructuredVerifierSource = {
  title: string
  url: string
  publishedAt: Date | null
  excerpt: string
  sourceType: CandidateEvidenceSourceType
  domain: string
}

type StructuredOutputProvider = 'default' | 'xai'

type StructuredVerifierOutput = {
  classification: VerifierClassification
  confidence: number
  proposedOutcomeDate: Date | null
  reasoning: string
  sources: StructuredVerifierSource[]
}

type TrialMonitorProviderTextResponse = {
  rawText: string
  providerResponseId: string | null
  sourceUrls: string[]
  sourceExtractionMethod: SourceExtractionMethod
  debugDetails: Record<string, unknown>
}

type MonitorDebugEntry = {
  level: MonitorDebugLevel
  stage: MonitorDebugStage
  message: string
  trialQuestionId?: string
  trialTitle?: string
  attempt?: MonitorDebugAttempt
  providerResponseId?: string | null
  details?: Record<string, unknown>
}

type MonitorDebugLogger = (entry: MonitorDebugEntry) => Promise<void>

export type TrialMonitorRunResult = {
  executed: boolean
  reason?: 'disabled' | 'not_due'
  status?: 'completed' | 'paused'
  runId?: string
  questionsScanned: number
  candidatesCreated: number
  nextEligibleAt?: string
  scopedNctNumber?: string
  errors: string[]
}

type TrialMonitorQuestionResult = {
  candidateCreated: boolean
  errorMessage: string | null
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + (hours * HOUR_MS))
}

function getTrialMonitorRunConcurrency(
  config: Pick<TrialMonitorConfig, 'cronProcessingConcurrency' | 'manualProcessingConcurrency'>,
  triggerSource: MonitorTriggerSource
): number {
  const configuredValue = triggerSource === 'manual'
    ? config.manualProcessingConcurrency
    : config.cronProcessingConcurrency

  return Math.min(
    TRIAL_MONITOR_MAX_CONCURRENCY,
    Math.max(TRIAL_MONITOR_MIN_CONCURRENCY, Math.round(configuredValue))
  )
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeMonitorText(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed
}

function truncateMonitorText(value: string, maxChars: number): string {
  const trimmed = normalizeMonitorText(value)
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function getErrorFieldValue(value: unknown, maxChars: number = 180): string | null {
  if (typeof value === 'string') {
    const trimmed = trimToNull(value)
    return trimmed ? truncateMonitorText(trimmed, maxChars) : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return null
}

function getErrorCauseMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null

  const cause = (error as { cause?: unknown }).cause
  if (!cause) return null

  if (cause instanceof Error) {
    const message = trimToNull(cause.message) ?? trimToNull(cause.name)
    return message ? truncateMonitorText(message, 180) : null
  }

  return getErrorFieldValue(
    typeof cause === 'object' && cause !== null
      ? (cause as { message?: unknown }).message ?? cause
      : cause,
    180,
  )
}

function buildProviderErrorDebugDetails(
  error: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null

  return {
    ...extra,
    errorName: error instanceof Error ? error.name : null,
    errorMessage: getErrorMessage(error),
    status: record?.status ?? null,
    code: getErrorFieldValue(record?.code),
    type: getErrorFieldValue(record?.type),
    param: getErrorFieldValue(record?.param),
    requestId: getErrorFieldValue(record?.request_id ?? record?.requestId),
    causeMessage: getErrorCauseMessage(error),
    headersPreview: serializeDebugValue(record?.headers, 1_500),
  }
}

function formatProviderRequestError(providerLabel: string, error: unknown): string {
  const message = getErrorMessage(error)
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null
  const details: string[] = []
  const errorName = error instanceof Error ? trimToNull(error.name) : null
  const status = getErrorFieldValue(record?.status)
  const code = getErrorFieldValue(record?.code)
  const errorType = getErrorFieldValue(record?.type)
  const requestId = getErrorFieldValue(record?.request_id ?? record?.requestId)
  const causeMessage = getErrorCauseMessage(error)

  if (errorName && errorName !== 'Error') details.push(errorName)
  if (status) details.push(`status ${status}`)
  if (code) details.push(`code ${code}`)
  if (errorType) details.push(`type ${errorType}`)
  if (requestId) details.push(`request ${requestId}`)

  const detailSuffix = details.length > 0 ? ` (${details.join(', ')})` : ''
  const causeSuffix = causeMessage && causeMessage !== message ? `; cause: ${causeMessage}` : ''

  return `${providerLabel} verifier request failed: ${message}${detailSuffix}${causeSuffix}`
}

function summarizeTextForError(value: string, maxChars: number = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 3)}...`
}

function truncateDebugText(value: string, maxChars: number = TRIAL_MONITOR_DEBUG_VALUE_MAX_CHARS): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxChars - 18))}...[truncated]`
}

function serializeDebugValue(value: unknown, maxChars: number = TRIAL_MONITOR_DEBUG_VALUE_MAX_CHARS): string | null {
  if (value == null) return null

  try {
    const serialized = JSON.stringify(value, null, 2)
    return typeof serialized === 'string'
      ? truncateDebugText(serialized, maxChars)
      : truncateDebugText(String(value), maxChars)
  } catch {
    return truncateDebugText(String(value), maxChars)
  }
}

function getHostname(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function normalizeUrlForMatch(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    url.hash = ''
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.protocol}//${hostname}${pathname}${url.search}`.toLowerCase()
  } catch {
    return trimmed.replace(/[),.;]+$/g, '').replace(/\/+$/, '').toLowerCase()
  }
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

function extractClaudeResponseText(message: any): string {
  const textBlocks = (message?.content || [])
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text.trim())
    .filter((text: string) => text.length > 0)

  if (textBlocks.length === 0) {
    return ''
  }

  const jsonLikeBlock = [...textBlocks].reverse().find((text) => text.includes('{') && text.includes('}'))
  return (jsonLikeBlock || textBlocks.join('\n')).trim()
}

function extractGeminiResponseText(response: any): string {
  const text = typeof response?.text === 'function'
    ? response.text()
    : response?.text

  return typeof text === 'string' ? text.trim() : ''
}

function stripJsonFences(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
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
  if (!Number.isFinite(parsed)) {
    throw new Error('Verifier response confidence is missing or invalid')
  }
  if (parsed < 0 || parsed > 1) {
    throw new Error('Verifier response confidence must be between 0 and 1')
  }
  return parsed
}

function coerceTimestamp(value: unknown): Date | null {
  if (value == null) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function inferEvidenceSourceType(value: unknown, url: string): CandidateEvidenceSourceType {
  if (value === 'clinicaltrials' || value === 'sponsor' || value === 'stored_source' || value === 'web_search') {
    return value
  }

  const hostname = getHostname(url)
  if (hostname?.includes('clinicaltrials.gov')) return 'clinicaltrials'
  if (hostname?.includes('investor') || hostname?.includes('ir.') || hostname?.includes('news') || hostname?.includes('press')) {
    return 'sponsor'
  }
  return 'web_search'
}

function buildVerifierSource(value: unknown): StructuredVerifierSource | null {
  if (!value || typeof value !== 'object') return null

  const record = value as {
    title?: unknown
    url?: unknown
    publishedAt?: unknown
    excerpt?: unknown
    sourceType?: unknown
    domain?: unknown
  }

  const title = trimToNull(record.title)
  const url = trimToNull(record.url)
  const excerpt = trimToNull(record.excerpt)
  if (!title || !url || !excerpt) {
    return null
  }

  const inferredDomain = getHostname(url)
  const explicitDomain = trimToNull(record.domain)?.toLowerCase().replace(/^www\./, '') ?? null
  const domain = explicitDomain || inferredDomain
  if (!domain) {
    return null
  }

  return {
    title: truncateMonitorText(title, MAX_VERIFIER_TITLE_CHARS),
    url,
    publishedAt: coerceTimestamp(record.publishedAt),
    excerpt: normalizeMonitorText(excerpt),
    sourceType: inferEvidenceSourceType(record.sourceType, url),
    domain,
  }
}

function parseVerifierSources(value: unknown): StructuredVerifierSource[] {
  if (!Array.isArray(value)) {
    throw new Error('Verifier response sources is missing or invalid')
  }

  const result: StructuredVerifierSource[] = []
  const seen = new Set<string>()

  for (const item of value) {
    const source = buildVerifierSource(item)
    if (!source) continue

    const normalizedUrl = normalizeUrlForMatch(source.url)
    if (seen.has(normalizedUrl)) continue
    seen.add(normalizedUrl)
    result.push(source)

    if (result.length >= MAX_VERIFIER_SOURCE_COUNT) break
  }

  if (value.length > 0 && result.length === 0) {
    throw new Error('Verifier response sources could not be parsed')
  }

  return result
}

function parseStructuredVerifierOutput(raw: string): StructuredVerifierOutput {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    classification?: unknown
    confidence?: unknown
    proposedOutcomeDate?: unknown
    reasoning?: unknown
    sources?: unknown
  }

  if (parsed.classification !== 'yes' && parsed.classification !== 'no' && parsed.classification !== 'no_decision') {
    throw new Error('Verifier response classification is missing or invalid')
  }

  const reasoning = trimToNull(parsed.reasoning)
  if (!reasoning) {
    throw new Error('Verifier response reasoning is missing or invalid')
  }

  const sources = parseVerifierSources(parsed.sources)
  if (sources.length === 0) {
    throw new Error('Verifier response must include at least one citation')
  }

  return {
    classification: parsed.classification,
    confidence: coerceConfidence(parsed.confidence),
    proposedOutcomeDate: coerceTimestamp(parsed.proposedOutcomeDate),
    reasoning: normalizeMonitorText(reasoning),
    sources,
  }
}

function buildDecisionFromStructuredOutput(output: StructuredVerifierOutput): VerifierDecision {
  return {
    classification: output.classification,
    confidence: output.confidence,
    proposedOutcomeDate: output.proposedOutcomeDate,
    summary: output.reasoning,
    evidence: output.sources.map((source) => ({
      sourceType: source.sourceType,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      excerpt: source.excerpt,
      domain: source.domain,
    })),
  }
}

function extractWebSearchSourceUrls(response: any): string[] {
  const output = Array.isArray(response?.output) ? response.output : []
  const urls: string[] = []
  const seen = new Set<string>()

  for (const item of output) {
    if (item?.type !== 'web_search_call') continue
    const sources = Array.isArray(item?.action?.sources) ? item.action.sources : []
    for (const source of sources) {
      const url = trimToNull(source?.url)
      if (!url) continue
      const normalized = normalizeUrlForMatch(url)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(url)
    }
  }

  return urls
}

function extractGoogleGroundingSourceUrls(response: any): string[] {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : []
  const urls: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks)
      ? candidate.groundingMetadata.groundingChunks
      : []

    for (const chunk of chunks) {
      const url = trimToNull(chunk?.web?.uri ?? chunk?.retrievedContext?.uri ?? chunk?.maps?.uri)
      if (!url) continue
      const normalized = normalizeUrlForMatch(url)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(url)
    }
  }

  return urls
}

function extractAnthropicWebSearchSourceUrls(message: any): string[] {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const urls: string[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block?.type !== 'web_search_tool_result') continue
    const content = Array.isArray(block?.content) ? block.content : []
    for (const item of content) {
      if (item?.type !== 'web_search_result') continue
      const url = trimToNull(item?.url)
      if (!url) continue
      const normalized = normalizeUrlForMatch(url)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(url)
    }
  }

  return urls
}

function buildResponseDebugDetails(
  response: any,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const output = Array.isArray(response?.output) ? response.output : []
  const webSearchSourceUrls = extractWebSearchSourceUrls(response)
  const extractedText = extractResponseText(response)

  return {
    ...extra,
    responseId: typeof response?.id === 'string' ? response.id : null,
    status: typeof response?.status === 'string' ? response.status : null,
    incompleteDetails: response?.incomplete_details ?? null,
    outputText: typeof response?.output_text === 'string'
      ? truncateDebugText(response.output_text)
      : null,
    extractedText: extractedText ? truncateDebugText(extractedText) : null,
    outputItemTypes: output.map((item: any) => item?.type ?? 'unknown'),
    webSearchSourceCount: webSearchSourceUrls.length,
    webSearchSourceUrls: webSearchSourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
    outputPreview: serializeDebugValue(output),
  }
}

function buildClaudeDebugDetails(
  message: any,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const rawText = extractClaudeResponseText(message)
  const sourceUrls = extractAnthropicWebSearchSourceUrls(message)

  return {
    ...extra,
    responseId: typeof message?.id === 'string' ? message.id : null,
    stopReason: message?.stop_reason ?? null,
    rawText: rawText ? truncateDebugText(rawText) : null,
    sourceUrls: sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
    contentPreview: serializeDebugValue(message?.content),
  }
}

function buildGeminiDebugDetails(
  response: any,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const rawText = extractGeminiResponseText(response)
  const sourceUrls = extractGoogleGroundingSourceUrls(response)

  return {
    ...extra,
    responseId: typeof response?.responseId === 'string'
      ? response.responseId
      : typeof response?.id === 'string'
        ? response.id
        : null,
    rawText: rawText ? truncateDebugText(rawText) : null,
    sourceUrls: sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
    groundingMetadataPreview: serializeDebugValue(
      Array.isArray(response?.candidates)
        ? response.candidates.map((candidate: any) => candidate?.groundingMetadata ?? null)
        : null,
    ),
    candidatePreview: serializeDebugValue(response?.candidates),
  }
}

function formatMonitorDebugEntry(entry: MonitorDebugEntry): string {
  const lines = [
    `[${new Date().toISOString()}] ${entry.level.toUpperCase()} ${entry.stage.toUpperCase()}: ${entry.message}`,
  ]

  if (entry.trialTitle) lines.push(`trialTitle: ${entry.trialTitle}`)
  if (entry.trialQuestionId) lines.push(`trialQuestionId: ${entry.trialQuestionId}`)
  if (entry.attempt) lines.push(`attempt: ${entry.attempt}`)
  if (entry.providerResponseId) lines.push(`providerResponseId: ${entry.providerResponseId}`)

  const details = serializeDebugValue(entry.details)
  if (details) {
    lines.push('details:')
    lines.push(details)
  }

  return lines.join('\n')
}

async function appendTrialMonitorRunDebugLog(runId: string, entry: MonitorDebugEntry): Promise<void> {
  const chunk = formatMonitorDebugEntry(entry)

  await db.update(trialMonitorRuns)
    .set({
      debugLog: sql`RIGHT(COALESCE(${trialMonitorRuns.debugLog} || ${'\n\n'}, '') || ${chunk}, ${TRIAL_MONITOR_DEBUG_LOG_MAX_CHARS})`,
      updatedAt: new Date(),
    })
    .where(eq(trialMonitorRuns.id, runId))
}

function buildTrialContextLines(question: TrialQuestionWithTrial): string[] {
  const normalizedNctNumber = normalizeClinicalTrialsNctNumber(question.trial.nctNumber)

  return [
    `Question: ${normalizeTrialQuestionPrompt(question.prompt)}`,
    `Trial: ${question.trial.shortTitle}`,
    `Sponsor: ${question.trial.sponsorName}${question.trial.sponsorTicker ? ` (${question.trial.sponsorTicker})` : ''}`,
    `NCT Number: ${normalizedNctNumber}`,
    `Exact Phase: ${question.trial.exactPhase}`,
    `Indication: ${question.trial.indication}`,
    `Intervention: ${question.trial.intervention}`,
    `Primary Endpoint: ${question.trial.primaryEndpoint}`,
    `Current Status: ${question.trial.currentStatus}`,
    `Estimated Primary Completion: ${question.trial.estPrimaryCompletionDate.toISOString().slice(0, 10)}`,
    `Brief Summary: ${question.trial.briefSummary}`,
  ]
}

async function withVerifierTimeout<T>(promise: Promise<T>, trialTitle: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new ExternalServiceError(`Verifier timed out for ${trialTitle} after ${Math.round(VERIFIER_REQUEST_TIMEOUT_MS / 1000)}s`))
        }, VERIFIER_REQUEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function failStaleRunIfNeeded(run: { id: string }): Promise<boolean> {
  const now = new Date()
  const updated = await db.update(trialMonitorRuns)
    .set({
      status: 'failed',
      errorSummary: `Auto-failed stale monitor run after ${TRIAL_MONITOR_STALE_TIMEOUT_MINUTES}m without heartbeat updates.`,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(trialMonitorRuns.id, run.id),
      eq(trialMonitorRuns.status, 'running'),
      sql`COALESCE(${trialMonitorRuns.updatedAt}, ${trialMonitorRuns.startedAt}) < NOW() - (${TRIAL_MONITOR_STALE_TIMEOUT_SECONDS} * INTERVAL '1 second')`,
    ))
    .returning({ id: trialMonitorRuns.id })

  return updated.length > 0
}

async function startMonitorRun(input: {
  triggerSource: MonitorTriggerSource
  verifierModelKey: string
  scopedNctNumber: string | null
}) {
  const activeRun = await db.query.trialMonitorRuns.findFirst({
    where: eq(trialMonitorRuns.status, 'running'),
    orderBy: [desc(trialMonitorRuns.updatedAt), desc(trialMonitorRuns.startedAt)],
  })

  if (activeRun) {
    const staleFailed = await failStaleRunIfNeeded(activeRun)
    if (!staleFailed) {
      throw new ConflictError('A trial monitor run is already in progress')
    }
  }

  const [run] = await db.insert(trialMonitorRuns)
    .values({
      triggerSource: input.triggerSource,
      status: 'running',
      questionsScanned: 0,
      candidatesCreated: 0,
      verifierModelKey: input.verifierModelKey,
      scopedNctNumber: input.scopedNctNumber,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  return run
}

async function completeRun(runId: string, input: {
  status: 'completed' | 'failed' | 'paused'
  questionsScanned: number
  candidatesCreated: number
  errorSummary?: string | null
}) {
  await db.update(trialMonitorRuns)
    .set({
      status: input.status,
      questionsScanned: input.questionsScanned,
      candidatesCreated: input.candidatesCreated,
      errorSummary: input.errorSummary ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(trialMonitorRuns.id, runId))
}

async function isTrialMonitorStopRequested(runId: string): Promise<boolean> {
  const run = await db.query.trialMonitorRuns.findFirst({
    where: eq(trialMonitorRuns.id, runId),
    columns: {
      status: true,
      stopRequestedAt: true,
    },
  })

  return Boolean(run && run.status === 'running' && run.stopRequestedAt)
}

function summarizeTrialMonitorErrors(errors: string[]): string | null {
  if (errors.length === 0) return null
  return errors.join('\n').slice(0, 1200)
}

function isQuestionEligible(question: TrialQuestionWithTrial, now: Date, lookaheadDays: number, overdueRecheckHours: number): boolean {
  const primaryCompletionTime = question.trial.estPrimaryCompletionDate.getTime()
  const lookaheadLimit = now.getTime() + (lookaheadDays * 24 * HOUR_MS)
  const lastMonitoredAt = question.trial.lastMonitoredAt
  const isWithinLookahead = primaryCompletionTime <= lookaheadLimit
  const isOverdue = primaryCompletionTime < now.getTime()
  const recheckDue = !lastMonitoredAt || addHours(lastMonitoredAt, isOverdue ? overdueRecheckHours : 0).getTime() <= now.getTime()
  return isWithinLookahead && recheckDue
}

function tryNormalizeClinicalTrialsNctNumber(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value)
  if (!trimmed || !/^NCT\d{8}$/i.test(trimmed)) {
    return null
  }
  return trimmed.toUpperCase()
}

function normalizeClinicalTrialsNctNumber(value: string | null | undefined): string {
  const normalized = tryNormalizeClinicalTrialsNctNumber(value)
  if (!normalized) {
    throw new ConfigurationError(`Invalid NCT Number for trial monitor: "${value ?? ''}"`)
  }
  return normalized
}

function normalizeScopedTrialMonitorNctNumber(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value)
  if (!trimmed) {
    return null
  }

  const normalized = tryNormalizeClinicalTrialsNctNumber(trimmed)
  if (!normalized) {
    throw new ValidationError('nctNumber must look like NCT01234567')
  }

  return normalized
}

async function getScopedTrialOutcomeQuestionsInternal(nctNumber: string): Promise<TrialQuestionWithTrial[]> {
  const allQuestions = await listMonitorableTrialOutcomeQuestionsInternal()

  return allQuestions
    .filter((question) => tryNormalizeClinicalTrialsNctNumber(question.trial.nctNumber) === nctNumber)
    .sort(compareTrialMonitorQuestionsByPriority)
}

function buildOnePassVerificationPrompt(
  question: TrialQuestionWithTrial,
  retry: boolean = false,
): string {
  const retryInstructions = retry
    ? [
        'This is a retry because the previous response was empty, truncated, or invalid JSON.',
        'Search only as much as needed to reach a decision and then finish with the required JSON object.',
        'Be extra concise on retry: prefer 1-2 citations, one short rationale, and brief source paraphrases.',
      ]
    : []

  return [
    'You are verifying whether a Phase 2 trial produced an overall positive or negative public readout.',
    'Do the full job in one response: search the live web, reason briefly, decide yes/no/no_decision, and return only the citations you actually used.',
    'Use low-depth reasoning. Stop searching once you have enough evidence to justify the decision.',
    'Classify yes only when the cited sources clearly frame this exact trial as positive, encouraging, clinically meaningful, supportive, met efficacy goals, or equivalent.',
    'Classify no only when the cited sources clearly frame this exact trial as negative, disappointing, failed, did not meet goals, no meaningful activity, or equivalent.',
    'Classify no_decision when the evidence is ambiguous, pooled, numeric-only, conflicting, incomplete, or not clearly trial-specific.',
    'Do not rely on regulatory shorthand, pooled program evidence, or endpoint tables alone unless the cited source clearly ties the interpretation to this exact trial.',
    'Return only the citations you actually used to justify the decision. Do not include unused links.',
    `Return between 1 and ${MAX_VERIFIER_SOURCE_COUNT} citations.`,
    `Keep each source title under ${MAX_VERIFIER_TITLE_CHARS} characters.`,
    `Keep the reasoning under ${MAX_VERIFIER_REASONING_CHARS} characters.`,
    `Keep each cited excerpt or paraphrase under ${MAX_VERIFIER_EXCERPT_CHARS} characters.`,
    'Use concise admin-facing language. Prefer short paraphrases over long quotations.',
    'Return JSON with this exact shape:',
    '{',
    '  "classification": "yes" | "no" | "no_decision",',
    '  "confidence": 0.0-1.0,',
    '  "proposedOutcomeDate": "ISO-8601 timestamp or null",',
    '  "reasoning": "short visible rationale shown to admins",',
    '  "sources": [',
    '    {',
    '      "title": "source title",',
    '      "url": "https://...",',
    '      "publishedAt": "ISO-8601 timestamp or null",',
    '      "excerpt": "short excerpt or paraphrase from the source",',
    '      "sourceType": "clinicaltrials" | "sponsor" | "stored_source" | "web_search",',
    '      "domain": "example.com"',
    '    }',
    '  ]',
    '}',
    ...retryInstructions,
    '',
    ...buildTrialContextLines(question),
  ].join('\n')
}

function createVerifierSourceSchema(provider: StructuredOutputProvider = 'default') {
  const supportsStringLengthBounds = provider !== 'xai'
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        ...(supportsStringLengthBounds ? { maxLength: MAX_VERIFIER_TITLE_CHARS } : {}),
      },
      url: { type: 'string' },
      publishedAt: {
        anyOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      },
      excerpt: {
        type: 'string',
        ...(supportsStringLengthBounds ? { maxLength: MAX_VERIFIER_EXCERPT_CHARS } : {}),
      },
      sourceType: {
        type: 'string',
        enum: ['clinicaltrials', 'sponsor', 'stored_source', 'web_search'],
      },
      domain: { type: 'string' },
    },
    required: ['title', 'url', 'publishedAt', 'excerpt', 'sourceType', 'domain'],
  }
}

function createVerifierJsonSchema(input: {
  includeConfidenceBounds?: boolean
  includeSourceCountBounds?: boolean
  provider?: StructuredOutputProvider
} = {}) {
  const includeConfidenceBounds = input.includeConfidenceBounds !== false
  const includeSourceCountBounds = input.includeSourceCountBounds !== false
  const provider = input.provider ?? 'default'
  const supportsStringLengthBounds = provider !== 'xai'
  const supportsArrayItemBounds = provider !== 'xai'

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      classification: {
        type: 'string',
        enum: ['yes', 'no', 'no_decision'],
      },
      confidence: {
        type: 'number',
        ...(includeConfidenceBounds ? {
          minimum: 0,
          maximum: 1,
        } : {}),
      },
      proposedOutcomeDate: {
        anyOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      },
      reasoning: {
        type: 'string',
        ...(supportsStringLengthBounds ? { maxLength: MAX_VERIFIER_REASONING_CHARS } : {}),
      },
      sources: {
        type: 'array',
        items: createVerifierSourceSchema(provider),
        ...(includeSourceCountBounds && supportsArrayItemBounds ? {
          minItems: 1,
          maxItems: MAX_VERIFIER_SOURCE_COUNT,
        } : {}),
      },
    },
    required: ['classification', 'confidence', 'proposedOutcomeDate', 'reasoning', 'sources'],
  }
}

function createVerifierResponseFormat(provider: StructuredOutputProvider = 'default') {
  return {
    type: 'json_schema' as const,
    name: 'trial_outcome_one_pass',
    strict: true,
    schema: createVerifierJsonSchema({ provider }),
  }
}

function getConfiguredTrialMonitorVerifierSpec(value: string): ReturnType<typeof getTrialMonitorVerifierSpec> {
  const modelKey = normalizeTrialMonitorVerifierModelKey(value)
  if (!modelKey) {
    throw new ConfigurationError(`Unsupported trial monitor verifier model: ${value}`)
  }

  ensureTrialMonitorVerifierConfigured(modelKey)
  return getTrialMonitorVerifierSpec(modelKey)
}

async function runProviderVerificationPrompt(
  modelKey: TrialMonitorVerifierModelKey,
  prompt: string,
  trialTitle: string,
  webSearchEnabled: boolean,
): Promise<TrialMonitorProviderTextResponse> {
  const spec = getTrialMonitorVerifierSpec(modelKey)

  if (!webSearchEnabled) {
    throw new ConfigurationError('Trial monitor web search is disabled. Enable web search before running the verifier.')
  }

  switch (spec.provider) {
    case 'openai': {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const response = await withVerifierTimeout(
        client.responses.create({
          model: spec.model,
          input: prompt,
          max_output_tokens: VERIFIER_MAX_OUTPUT_TOKENS,
          text: {
            format: createVerifierResponseFormat(),
            verbosity: 'low',
          },
          tools: [{
            type: 'web_search' as const,
            search_context_size: 'low',
            user_location: {
              type: 'approximate',
              country: 'US',
              timezone: 'America/New_York',
            },
          }],
          include: ['web_search_call.action.sources'],
          reasoning: { effort: 'low' },
        } as any),
        trialTitle,
      )

      return {
        rawText: extractResponseText(response),
        providerResponseId: typeof response?.id === 'string' ? response.id : null,
        sourceUrls: extractWebSearchSourceUrls(response),
        sourceExtractionMethod: 'openai_web_search_sources',
        debugDetails: buildResponseDebugDetails(response, {
          provider: spec.providerLabel,
          model: spec.model,
        }),
      }
    }

    case 'xai': {
      const client = new OpenAI({
        apiKey: process.env.XAI_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      })
      const response = await withVerifierTimeout(
        client.responses.parse({
          model: spec.model,
          input: prompt,
          max_output_tokens: VERIFIER_MAX_OUTPUT_TOKENS,
          text: {
            format: createVerifierResponseFormat('xai'),
            verbosity: 'low',
          },
          tools: [{ type: 'web_search' as const }],
          include: ['web_search_call.action.sources'],
        } as any),
        trialTitle,
      )

      const parsedOutput = response.output_parsed
      return {
        rawText: parsedOutput ? JSON.stringify(parsedOutput) : extractResponseText(response),
        providerResponseId: typeof response?.id === 'string' ? response.id : null,
        sourceUrls: extractWebSearchSourceUrls(response),
        sourceExtractionMethod: 'xai_web_search_sources',
        debugDetails: buildResponseDebugDetails(response, {
          provider: spec.providerLabel,
          model: spec.model,
        }),
      }
    }

    case 'google': {
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
      const response = await withVerifierTimeout(
        ai.models.generateContent({
          model: spec.model,
          contents: prompt,
          config: {
            maxOutputTokens: 2200,
            responseMimeType: 'application/json',
            responseJsonSchema: createVerifierJsonSchema(),
            thinkingConfig: {
              thinkingBudget: 256,
            },
            tools: [{ googleSearch: {} }],
          },
        }),
        trialTitle,
      )
      const rawText = extractGeminiResponseText(response)
      const sourceUrls = extractGoogleGroundingSourceUrls(response)

      return {
        rawText,
        providerResponseId: typeof (response as any)?.responseId === 'string'
          ? (response as any).responseId
          : typeof (response as any)?.id === 'string'
            ? (response as any).id
            : null,
        sourceUrls,
        sourceExtractionMethod: 'google_grounding_metadata',
        debugDetails: buildGeminiDebugDetails(response, {
          provider: spec.providerLabel,
          model: spec.model,
          sourceUrls: sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
        }),
      }
    }

    case 'anthropic': {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const message = await withVerifierTimeout(
        client.messages.create({
          model: spec.model,
          max_tokens: 2800,
          messages: [{ role: 'user', content: prompt }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: createVerifierJsonSchema({
                includeConfidenceBounds: false,
                includeSourceCountBounds: false,
              }),
            },
          },
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 6,
            user_location: {
              type: 'approximate',
              country: 'US',
              timezone: 'America/New_York',
            },
          }],
        } as any),
        trialTitle,
      )
      const rawText = extractClaudeResponseText(message)
      const sourceUrls = extractAnthropicWebSearchSourceUrls(message)

      return {
        rawText,
        providerResponseId: typeof message?.id === 'string' ? message.id : null,
        sourceUrls,
        sourceExtractionMethod: 'anthropic_web_search_tool_result',
        debugDetails: buildClaudeDebugDetails(message, {
          provider: spec.providerLabel,
          model: spec.model,
          sourceUrls: sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
        }),
      }
    }
  }
}

async function runVerificationAttempt(
  modelKey: TrialMonitorVerifierModelKey,
  question: TrialQuestionWithTrial,
  retry: boolean,
  webSearchEnabled: boolean,
  debugLog?: MonitorDebugLogger,
): Promise<{
  decision: VerifierDecision
  providerResponseId: string | null
}> {
  const spec = getTrialMonitorVerifierSpec(modelKey)
  let providerResponse: TrialMonitorProviderTextResponse

  try {
    providerResponse = await runProviderVerificationPrompt(
      modelKey,
      buildOnePassVerificationPrompt(question, retry),
      question.trial.shortTitle,
      webSearchEnabled,
    )
  } catch (error) {
    await debugLog?.({
      level: 'error',
      stage: 'verifier',
      message: 'Verifier request failed before returning a structured response.',
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      attempt: retry ? 'retry' : 'initial',
      details: buildProviderErrorDebugDetails(error, {
        reasonCode: 'verifier_request_failed',
        provider: spec.providerLabel,
        model: spec.model,
        webSearchEnabled,
      }),
    })

    throw new ExternalServiceError(
      formatProviderRequestError(spec.providerLabel, error),
      { cause: error },
    )
  }

  const raw = providerResponse.rawText
  if (!raw) {
    await debugLog?.({
      level: 'error',
      stage: 'verifier',
      message: 'Verifier returned no structured response content.',
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      attempt: retry ? 'retry' : 'initial',
      providerResponseId: providerResponse.providerResponseId,
      details: {
        reasonCode: 'verifier_empty',
        ...providerResponse.debugDetails,
        providerSourceUrls: providerResponse.sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
        sourceExtractionMethod: providerResponse.sourceExtractionMethod,
      },
    })
    console.error('[trial-monitor] Missing verifier response content', {
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      providerResponseId: providerResponse.providerResponseId,
      sourceCount: providerResponse.sourceUrls.length,
      sourceUrls: providerResponse.sourceUrls,
      rawText: null,
    })
    throw new ExternalServiceError(`No verifier response content for ${question.trial.shortTitle}`)
  }

  try {
    const output = parseStructuredVerifierOutput(raw)
    await debugLog?.({
      level: 'info',
      stage: 'verifier',
      message: 'Verifier produced a structured one-pass decision.',
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      attempt: retry ? 'retry' : 'initial',
      providerResponseId: providerResponse.providerResponseId,
      details: {
        classification: output.classification,
        confidence: output.confidence,
        returnedSources: output.sources.map((source) => ({
          title: source.title,
          url: source.url,
          domain: source.domain,
          sourceType: source.sourceType,
        })),
        providerSourceUrls: providerResponse.sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
        sourceExtractionMethod: providerResponse.sourceExtractionMethod,
      },
    })
    return {
      decision: buildDecisionFromStructuredOutput(output),
      providerResponseId: providerResponse.providerResponseId,
    }
  } catch (error) {
    const parseReason = getErrorMessage(error)
    const rawSnippet = summarizeTextForError(raw)
    await debugLog?.({
      level: 'error',
      stage: 'verifier',
      message: 'Verifier returned invalid structured content.',
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      attempt: retry ? 'retry' : 'initial',
      providerResponseId: providerResponse.providerResponseId,
      details: {
        reasonCode: 'verifier_json_invalid',
        ...providerResponse.debugDetails,
        parseReason,
        rawResponse: truncateDebugText(raw),
        providerSourceUrls: providerResponse.sourceUrls.slice(0, TRIAL_MONITOR_DEBUG_SOURCE_URL_LIMIT),
        providerSourceCount: providerResponse.sourceUrls.length,
        sourceExtractionMethod: providerResponse.sourceExtractionMethod,
      },
    })
    console.error('[trial-monitor] Invalid verifier response', {
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      providerResponseId: providerResponse.providerResponseId,
      parseReason,
      sourceCount: providerResponse.sourceUrls.length,
      sourceUrls: providerResponse.sourceUrls,
      rawResponse: raw,
    })
    throw new ExternalServiceError(
      `Invalid verifier response for ${question.trial.shortTitle}: ${parseReason}. Response snippet: ${rawSnippet}`,
      { cause: error },
    )
  }
}

async function verifyTrialOutcome(
  modelKey: TrialMonitorVerifierModelKey,
  question: TrialQuestionWithTrial,
  webSearchEnabled: boolean,
  debugLog?: MonitorDebugLogger,
): Promise<{
  decision: VerifierDecision
  providerResponseId: string | null
}> {
  try {
    return await runVerificationAttempt(modelKey, question, false, webSearchEnabled, debugLog)
  } catch (firstError) {
    try {
      return await runVerificationAttempt(modelKey, question, true, webSearchEnabled, debugLog)
    } catch (retryError) {
      await debugLog?.({
        level: 'error',
        stage: 'verifier',
        message: 'Verifier retry failed after an initial invalid or empty response.',
        trialQuestionId: question.id,
        trialTitle: question.trial.shortTitle,
        details: {
          reasonCode: 'verifier_retry_failed',
          initialError: getErrorMessage(firstError),
          retryError: getErrorMessage(retryError),
        },
      })
      throw retryError
    }
  }
}

async function processTrialMonitorQuestion(input: {
  verifierModelKey: TrialMonitorVerifierModelKey
  question: TrialQuestionWithTrial
  webSearchEnabled: boolean
  debugLog: MonitorDebugLogger
}): Promise<TrialMonitorQuestionResult> {
  const { verifierModelKey, question, webSearchEnabled, debugLog } = input

  try {
    const { decision, providerResponseId } = await verifyTrialOutcome(
      verifierModelKey,
      question,
      webSearchEnabled,
      debugLog,
    )

    if (decision.evidence.length === 0) {
      await debugLog({
        level: 'warn',
        stage: 'run',
        message: 'Verifier returned no usable evidence, so no queue item was created.',
        trialQuestionId: question.id,
        trialTitle: question.trial.shortTitle,
        providerResponseId,
        details: {
          classification: decision.classification,
          confidence: decision.confidence,
          summary: decision.summary,
        },
      })

      return {
        candidateCreated: false,
        errorMessage: 'Verifier returned no usable evidence',
      }
    }

    const settlementOutcome = decision.classification === 'yes'
      ? 'YES'
      : decision.classification === 'no'
        ? 'NO'
        : 'NO_DECISION'
    const proposedOutcome: CandidateOutcome = settlementOutcome
    const evidenceHash = buildTrialOutcomeEvidenceHash(proposedOutcome, decision.evidence.map((entry) => entry.url))
    const existingCandidate = await db.query.trialOutcomeCandidates.findFirst({
      where: and(
        eq(trialOutcomeCandidates.trialQuestionId, question.id),
        eq(trialOutcomeCandidates.proposedOutcome, proposedOutcome),
        eq(trialOutcomeCandidates.evidenceHash, evidenceHash),
      ),
    })

    let candidateCreated = false

    if (!existingCandidate) {
      const [candidate] = await db.insert(trialOutcomeCandidates)
        .values({
          trialQuestionId: question.id,
          proposedOutcome,
          proposedOutcomeDate: proposedOutcome === 'NO_DECISION' ? null : decision.proposedOutcomeDate,
          confidence: decision.confidence,
          summary: decision.summary,
          verifierModelKey,
          providerResponseId,
          evidenceHash,
          status: 'pending_review',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      if (candidate) {
        await db.insert(trialOutcomeCandidateEvidence)
          .values(decision.evidence.map((evidence, index) => ({
            candidateId: candidate.id,
            sourceType: evidence.sourceType,
            title: evidence.title,
            url: evidence.url,
            publishedAt: evidence.publishedAt,
            excerpt: evidence.excerpt,
            domain: evidence.domain,
            displayOrder: index,
            createdAt: new Date(),
          })))

        candidateCreated = true
        await debugLog({
          level: 'info',
          stage: 'run',
          message: 'Created a new trial outcome queue item.',
          trialQuestionId: question.id,
          trialTitle: question.trial.shortTitle,
          providerResponseId,
          details: {
            candidateId: candidate.id,
            proposedOutcome,
            classification: decision.classification,
            confidence: decision.confidence,
            evidenceCount: decision.evidence.length,
          },
        })
      }
    } else {
      await debugLog({
        level: 'info',
        stage: 'run',
        message: 'Skipped queue item creation because matching evidence was already recorded.',
        trialQuestionId: question.id,
        trialTitle: question.trial.shortTitle,
        providerResponseId,
        details: {
          existingCandidateId: existingCandidate.id,
          proposedOutcome,
          confidence: decision.confidence,
          evidenceCount: decision.evidence.length,
        },
      })
    }

    await db.update(phase2Trials)
      .set({
        lastMonitoredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(phase2Trials.id, question.trial.id))

    return {
      candidateCreated,
      errorMessage: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to monitor ${question.trial.shortTitle}`
    await debugLog({
      level: 'error',
      stage: 'run',
      message: 'Question monitoring failed.',
      trialQuestionId: question.id,
      trialTitle: question.trial.shortTitle,
      details: {
        errorMessage: message,
        stack: error instanceof Error ? truncateDebugText(error.stack ?? '') : null,
      },
    })

    return {
      candidateCreated: false,
      errorMessage: message,
    }
  }
}

export async function listEligibleTrialOutcomeQuestions(): Promise<EligibleTrialOutcomeQuestion[]> {
  const config = await getTrialMonitorConfig()
  const questions = await getEligibleTrialOutcomeQuestionsInternal(config)

  return questions.map((question) => ({
    id: question.id,
    prompt: normalizeTrialQuestionPrompt(question.prompt),
    trial: {
      shortTitle: question.trial.shortTitle,
      sponsorName: question.trial.sponsorName,
      sponsorTicker: question.trial.sponsorTicker,
      nctNumber: question.trial.nctNumber,
      estPrimaryCompletionDate: question.trial.estPrimaryCompletionDate,
      lastMonitoredAt: question.trial.lastMonitoredAt,
    },
  }))
}

export async function listEligibleTrialOutcomeQuestionsForManualResearch(): Promise<ManualTrialOutcomeQueueItem[]> {
  const config = await getTrialMonitorConfig()
  const questions = await getEligibleTrialOutcomeQuestionsInternal(config)

  return questions.map((question) => ({
    id: question.id,
    prompt: normalizeTrialQuestionPrompt(question.prompt),
    trial: {
      id: question.trial.id,
      shortTitle: question.trial.shortTitle,
      sponsorName: question.trial.sponsorName,
      sponsorTicker: question.trial.sponsorTicker,
      nctNumber: normalizeClinicalTrialsNctNumber(question.trial.nctNumber),
      exactPhase: question.trial.exactPhase,
      indication: question.trial.indication,
      intervention: question.trial.intervention,
      primaryEndpoint: question.trial.primaryEndpoint,
      currentStatus: question.trial.currentStatus,
      estPrimaryCompletionDate: question.trial.estPrimaryCompletionDate,
      briefSummary: question.trial.briefSummary,
      lastMonitoredAt: question.trial.lastMonitoredAt,
    },
  }))
}

export async function runTrialMonitor(input: {
  triggerSource: MonitorTriggerSource
  force?: boolean
  nctNumber?: string | null
}): Promise<TrialMonitorRunResult> {
  const config = await getTrialMonitorConfig()
  const processingConcurrency = getTrialMonitorRunConcurrency(config, input.triggerSource)
  const scopedNctNumber = normalizeScopedTrialMonitorNctNumber(input.nctNumber ?? null)
  const questionSelection: TrialMonitorQuestionSelection = scopedNctNumber ? 'specific_nct' : 'eligible_queue'
  if (!config.enabled) {
    return {
      executed: false,
      reason: 'disabled',
      questionsScanned: 0,
      candidatesCreated: 0,
      scopedNctNumber: scopedNctNumber ?? undefined,
      errors: [],
    }
  }
  if (!config.webSearchEnabled) {
    throw new ConfigurationError('Trial monitor web search is disabled. Enable web search before running the verifier.')
  }

  const verifierSpec = getConfiguredTrialMonitorVerifierSpec(config.verifierModelKey)
  const verifierModelKey = verifierSpec.key

  const now = new Date()
  if (!input.force && !scopedNctNumber) {
    const latestRun = await db.query.trialMonitorRuns.findFirst({
      orderBy: [desc(trialMonitorRuns.startedAt)],
    })
    if (latestRun) {
      const nextEligibleAt = addHours(latestRun.startedAt, config.runIntervalHours)
      if (nextEligibleAt.getTime() > now.getTime()) {
        return {
          executed: false,
          reason: 'not_due',
          questionsScanned: 0,
          candidatesCreated: 0,
          nextEligibleAt: nextEligibleAt.toISOString(),
          scopedNctNumber: scopedNctNumber ?? undefined,
          errors: [],
        }
      }
    }
  }

  const questionsToScan = scopedNctNumber
    ? await getScopedTrialOutcomeQuestionsInternal(scopedNctNumber)
    : await getEligibleTrialOutcomeQuestionsInternal(config)

  if (scopedNctNumber && questionsToScan.length === 0) {
    throw new NotFoundError(`No live pending outcome question was found for ${scopedNctNumber}`)
  }

  const run = await startMonitorRun({
    triggerSource: input.triggerSource,
    verifierModelKey,
    scopedNctNumber,
  })
  const errors: string[] = []
  let questionsScanned = 0
  let candidatesCreated = 0
  let stopRequested = false
  let stopRequestLogged = false
  const debugLog: MonitorDebugLogger = async (entry) => {
    try {
      await appendTrialMonitorRunDebugLog(run.id, entry)
    } catch (error) {
      console.error('[trial-monitor] Failed to persist run debug log', {
        runId: run.id,
        message: entry.message,
        stage: entry.stage,
        error: getErrorMessage(error),
      })
    }
  }

  try {
    await debugLog({
      level: 'info',
      stage: 'run',
      message: 'Trial monitor run started.',
      details: {
        triggerSource: input.triggerSource,
        forced: Boolean(input.force),
        verifierModelKey,
        verifierModelLabel: verifierSpec.label,
        scopedNctNumber,
        questionSelection,
        webSearchEnabled: config.webSearchEnabled,
        lookaheadDays: config.lookaheadDays,
        overdueRecheckHours: config.overdueRecheckHours,
        maxQuestionsPerRun: config.maxQuestionsPerRun,
        cronProcessingConcurrency: config.cronProcessingConcurrency,
        manualProcessingConcurrency: config.manualProcessingConcurrency,
        minCandidateConfidence: config.minCandidateConfidence,
        processingConcurrency,
        questionCount: questionsToScan.length,
      },
    })

    let persistRunProgressQueue = Promise.resolve()
    const persistRunProgress = async () => {
      const snapshotQuestionsScanned = questionsScanned
      const snapshotCandidatesCreated = candidatesCreated
      const snapshotErrorSummary = summarizeTrialMonitorErrors(errors)

      persistRunProgressQueue = persistRunProgressQueue.then(async () => {
        await db.update(trialMonitorRuns)
          .set({
            questionsScanned: snapshotQuestionsScanned,
            candidatesCreated: snapshotCandidatesCreated,
            errorSummary: snapshotErrorSummary,
            updatedAt: new Date(),
          })
          .where(eq(trialMonitorRuns.id, run.id))
      })

      await persistRunProgressQueue
    }

    let nextQuestionIndex = 0
    const observeStopRequest = async (): Promise<boolean> => {
      if (stopRequested) {
        return true
      }

      const requested = await isTrialMonitorStopRequested(run.id)
      if (!requested) {
        return false
      }

      stopRequested = true
      if (!stopRequestLogged) {
        stopRequestLogged = true
        await debugLog({
          level: 'warn',
          stage: 'run',
          message: 'Trial monitor pause requested by admin.',
          details: {
            stopRequestMessage: TRIAL_MONITOR_STOP_REQUEST_MESSAGE,
            questionsScanned,
            candidatesCreated,
            errorCount: errors.length,
          },
        })
      }

      return true
    }

    const workerCount = Math.min(processingConcurrency, Math.max(questionsToScan.length, 1))
    const worker = async () => {
      while (true) {
        if (await observeStopRequest()) {
          return
        }

        const question = questionsToScan[nextQuestionIndex++]
        if (!question) {
          return
        }

        questionsScanned += 1
        await persistRunProgress()

        const result = await processTrialMonitorQuestion({
          verifierModelKey,
          question,
          webSearchEnabled: config.webSearchEnabled,
          debugLog,
        })

        if (result.candidateCreated) {
          candidatesCreated += 1
        }

        if (result.errorMessage) {
          errors.push(`${question.trial.shortTitle}: ${result.errorMessage}`)
        }

        await persistRunProgress()
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    await persistRunProgressQueue

    if (stopRequested) {
      await completeRun(run.id, {
        status: 'paused',
        questionsScanned,
        candidatesCreated,
        errorSummary: summarizeTrialMonitorErrors(errors),
      })

      await debugLog({
        level: 'warn',
        stage: 'run',
        message: 'Trial monitor run paused by admin.',
        details: {
          pauseMessage: TRIAL_MONITOR_PAUSED_MESSAGE,
          questionsScanned,
          candidatesCreated,
          errorCount: errors.length,
          errorSummary: errors,
        },
      })

      return {
        executed: true,
        status: 'paused',
        runId: run.id,
        questionsScanned,
        candidatesCreated,
        scopedNctNumber: scopedNctNumber ?? undefined,
        errors,
      }
    }

    await completeRun(run.id, {
      status: 'completed',
      questionsScanned,
      candidatesCreated,
      errorSummary: summarizeTrialMonitorErrors(errors),
    })

    await debugLog({
      level: errors.length > 0 ? 'warn' : 'info',
      stage: 'run',
      message: errors.length > 0 ? 'Trial monitor run completed with issues.' : 'Trial monitor run completed successfully.',
      details: {
        questionsScanned,
        candidatesCreated,
        errorCount: errors.length,
        errorSummary: errors,
      },
    })

    return {
      executed: true,
      status: 'completed',
      runId: run.id,
      questionsScanned,
      candidatesCreated,
      scopedNctNumber: scopedNctNumber ?? undefined,
      errors,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trial monitor failed'
    await completeRun(run.id, {
      status: 'failed',
      questionsScanned,
      candidatesCreated,
      errorSummary: [message, ...errors].join('\n').slice(0, 1200),
    })
    await debugLog({
      level: 'error',
      stage: 'run',
      message: 'Trial monitor run failed.',
      details: {
        errorMessage: message,
        stack: error instanceof Error ? truncateDebugText(error.stack ?? '') : null,
        questionsScanned,
        candidatesCreated,
        existingErrors: errors,
      },
    })
    throw error
  }
}

export async function listPendingTrialOutcomeCandidates() {
  return db.query.trialOutcomeCandidates.findMany({
    where: eq(trialOutcomeCandidates.status, 'pending_review'),
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
      evidence: true,
    },
    orderBy: [desc(trialOutcomeCandidates.createdAt)],
  })
}

export async function listTrialOutcomeCandidatesForTrialQuestion(trialQuestionId: string) {
  return db.query.trialOutcomeCandidates.findMany({
    where: eq(trialOutcomeCandidates.trialQuestionId, trialQuestionId),
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
      evidence: true,
    },
    orderBy: [desc(trialOutcomeCandidates.createdAt)],
  })
}

export async function listRecentTrialMonitorRuns() {
  return db.query.trialMonitorRuns.findMany({
    orderBy: [desc(trialMonitorRuns.startedAt)],
    limit: 20,
  })
}

export async function listTrialMonitorRunsForTrialQuestion(input: {
  trialQuestionId: string
  nctNumber?: string | null
}) {
  const normalizedNctNumber = normalizeScopedTrialMonitorNctNumber(input.nctNumber ?? null)
  return db.query.trialMonitorRuns.findMany({
    where: normalizedNctNumber
      ? or(
          like(trialMonitorRuns.debugLog, `%${input.trialQuestionId}%`),
          like(trialMonitorRuns.debugLog, `%${normalizedNctNumber}%`),
        )
      : like(trialMonitorRuns.debugLog, `%${input.trialQuestionId}%`),
    orderBy: [desc(trialMonitorRuns.startedAt)],
  })
}

export async function requestTrialMonitorStop(runId?: string | null): Promise<string | null> {
  const activeRun = runId
    ? await db.query.trialMonitorRuns.findFirst({
        where: and(
          eq(trialMonitorRuns.id, runId),
          eq(trialMonitorRuns.status, 'running'),
        ),
        columns: {
          id: true,
          stopRequestedAt: true,
        },
      })
    : await db.query.trialMonitorRuns.findFirst({
        where: eq(trialMonitorRuns.status, 'running'),
        orderBy: [desc(trialMonitorRuns.updatedAt), desc(trialMonitorRuns.startedAt)],
        columns: {
          id: true,
          stopRequestedAt: true,
        },
      })

  if (!activeRun) return null
  if (activeRun.stopRequestedAt) return activeRun.id

  const [updated] = await db.update(trialMonitorRuns)
    .set({
      stopRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(trialMonitorRuns.id, activeRun.id),
      eq(trialMonitorRuns.status, 'running'),
    ))
    .returning({ id: trialMonitorRuns.id })

  return updated?.id ?? null
}

export async function deleteTrialMonitorRun(runId: string) {
  const existingRun = await db.query.trialMonitorRuns.findFirst({
    where: eq(trialMonitorRuns.id, runId),
  })

  if (!existingRun) {
    throw new NotFoundError('Trial monitor run not found')
  }

  if (existingRun.status === 'running') {
    throw new ConflictError('Running trial monitor runs cannot be deleted')
  }

  await db.delete(trialMonitorRuns)
    .where(eq(trialMonitorRuns.id, runId))
}

export async function reviewTrialOutcomeCandidate(input: {
  candidateId: string
  action: 'accept' | 'reject' | 'dismiss' | 'supersede' | 'clear_for_rerun'
  reviewerId?: string | null
  reviewNotes?: string | null
}) {
  const candidate = await db.query.trialOutcomeCandidates.findFirst({
    where: eq(trialOutcomeCandidates.id, input.candidateId),
    with: {
      question: {
        columns: {
          trialId: true,
          outcome: true,
          outcomeDate: true,
        },
      },
    },
  })

  if (!candidate) {
    throw new NotFoundError('Trial outcome candidate not found')
  }

  if (candidate.status !== 'pending_review') {
    throw new ConflictError(`Trial outcome candidate is already ${candidate.status}`)
  }

  const now = new Date()

  if (input.action === 'clear_for_rerun') {
    await db.transaction(async (tx) => {
      await tx.delete(trialOutcomeCandidates)
        .where(eq(trialOutcomeCandidates.id, candidate.id))

      await tx.update(phase2Trials)
        .set({
          lastMonitoredAt: null,
          updatedAt: now,
        })
        .where(eq(phase2Trials.id, candidate.question.trialId))
    })
    return
  }

  if (input.action === 'accept') {
    if (candidate.proposedOutcome !== 'YES' && candidate.proposedOutcome !== 'NO') {
      throw new ConflictError('Only YES/NO candidates can be accepted')
    }

    const nextOutcomeDate = candidate.proposedOutcomeDate ?? now

    await db.transaction(async (tx) => {
      await tx.update(trialQuestions)
        .set({
          outcome: candidate.proposedOutcome,
          outcomeDate: nextOutcomeDate,
          updatedAt: now,
        })
        .where(eq(trialQuestions.id, candidate.trialQuestionId))

      await recordTrialQuestionOutcomeHistory({
        dbClient: tx,
        trialQuestionId: candidate.trialQuestionId,
        previousOutcome: candidate.question.outcome as 'Pending' | 'YES' | 'NO',
        previousOutcomeDate: candidate.question.outcomeDate,
        nextOutcome: candidate.proposedOutcome as 'YES' | 'NO',
        nextOutcomeDate,
        changedAt: now,
        changeSource: 'accepted_candidate',
        changedByUserId: input.reviewerId ?? null,
        reviewCandidateId: candidate.id,
        notes: input.reviewNotes ?? null,
      })

      await tx.update(trialOutcomeCandidates)
        .set({
          status: 'accepted',
          reviewedByUserId: input.reviewerId ?? null,
          reviewNotes: input.reviewNotes ?? null,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(trialOutcomeCandidates.id, candidate.id))

      await tx.update(trialOutcomeCandidates)
        .set({
          status: 'superseded',
          reviewedByUserId: input.reviewerId ?? null,
          reviewNotes: `Superseded after accepting candidate ${candidate.id}.`,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(trialOutcomeCandidates.trialQuestionId, candidate.trialQuestionId),
          eq(trialOutcomeCandidates.status, 'pending_review'),
          ne(trialOutcomeCandidates.id, candidate.id),
        ))

      await resolveMarketForTrialQuestion(candidate.trialQuestionId, candidate.proposedOutcome as 'YES' | 'NO', tx)
    })
    return
  }

  if (input.action === 'dismiss') {
    if (candidate.proposedOutcome !== 'NO_DECISION') {
      throw new ConflictError('Only NO_DECISION candidates can be dismissed')
    }

    await db.update(trialOutcomeCandidates)
      .set({
        status: 'dismissed',
        reviewedByUserId: input.reviewerId ?? null,
        reviewNotes: input.reviewNotes ?? null,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(trialOutcomeCandidates.id, candidate.id))
    return
  }

  if (input.action === 'reject' && candidate.proposedOutcome === 'NO_DECISION') {
    throw new ConflictError('NO_DECISION candidates must be dismissed instead of rejected')
  }

  await db.update(trialOutcomeCandidates)
    .set({
      status: input.action === 'reject' ? 'rejected' : 'superseded',
      reviewedByUserId: input.reviewerId ?? null,
      reviewNotes: input.reviewNotes ?? null,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(trialOutcomeCandidates.id, candidate.id))
}
