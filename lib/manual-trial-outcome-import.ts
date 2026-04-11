import { and, eq, inArray } from 'drizzle-orm'
import {
  db,
  trials,
  trialMonitorRuns,
  trialOutcomeCandidateEvidence,
  trialOutcomeCandidates,
  trialQuestions,
} from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { buildTrialOutcomeEvidenceHash, normalizeTrialOutcomeEvidenceUrl } from '@/lib/trial-outcome-candidate-hash'

const MANUAL_REVIEW_SOURCE_TYPES = ['clinicaltrials', 'sponsor', 'stored_source', 'web_search'] as const
const MAX_EVIDENCE_ITEMS = 3
const MAX_TITLE_CHARS = 220
const MAX_SUMMARY_CHARS = 420
const MAX_EXCERPT_CHARS = 320

type ManualReviewSourceType = (typeof MANUAL_REVIEW_SOURCE_TYPES)[number]
type CandidateOutcome = 'YES' | 'NO' | 'NO_DECISION'
type TrialQuestionWithTrial = typeof trialQuestions.$inferSelect & {
  trial: typeof trials.$inferSelect
}

export const MANUAL_CHAT_REVIEW_VERIFIER_KEY = 'manual-chat-review'

export type ManualTrialOutcomeEvidenceInput = {
  title: string
  url: string
  publishedAt: string | null
  excerpt: string
  sourceType: ManualReviewSourceType
  domain: string
}

export type ManualTrialOutcomeDecisionInput = {
  trialQuestionId: string
  proposedOutcome: CandidateOutcome
  confidence: number
  proposedOutcomeDate: string | null
  summary: string
  evidence: ManualTrialOutcomeEvidenceInput[]
}

type NormalizedManualTrialOutcomeEvidence = {
  title: string
  url: string
  normalizedUrl: string
  publishedAt: Date | null
  excerpt: string
  sourceType: ManualReviewSourceType
  domain: string
}

type NormalizedManualTrialOutcomeDecision = {
  trialQuestionId: string
  proposedOutcome: CandidateOutcome
  confidence: number
  proposedOutcomeDate: Date | null
  summary: string
  evidence: NormalizedManualTrialOutcomeEvidence[]
  evidenceHash: string
}

export type ManualTrialOutcomeImportItemResult = {
  trialQuestionId: string
  trialTitle: string
  nctNumber: string | null
  proposedOutcome: CandidateOutcome
  evidenceHash: string
  status: 'ready' | 'inserted' | 'duplicate'
  candidateId: string | null
}

export type ManualTrialOutcomeImportResult = {
  mode: 'dry-run' | 'apply'
  verifierModelKey: string
  sourceFile: string | null
  questionsScanned: number
  candidatesCreated: number
  duplicatesSkipped: number
  lastMonitoredUpdated: number
  runId: string | null
  items: ManualTrialOutcomeImportItemResult[]
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function requireText(value: unknown, fieldName: string, maxChars?: number): string {
  const trimmed = trimToNull(value)
  if (!trimmed) {
    throw new ValidationError(`${fieldName} is required`)
  }

  const normalized = normalizeText(trimmed)
  if (maxChars && normalized.length > maxChars) {
    throw new ValidationError(`${fieldName} must be ${maxChars} characters or fewer`)
  }

  return normalized
}

function normalizeUrl(value: unknown, fieldName: string): string {
  const text = requireText(value, fieldName)
  try {
    return new URL(text).toString()
  } catch {
    throw new ValidationError(`${fieldName} must be a valid absolute URL`)
  }
}

function normalizeDomain(value: unknown, url: string, fieldName: string): string {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  const provided = requireText(value, fieldName).toLowerCase().replace(/^www\./, '')
  if (provided !== hostname) {
    throw new ValidationError(`${fieldName} must match the citation hostname (${hostname})`)
  }
  return hostname
}

function normalizePublishedAt(value: string | null, fieldName: string): Date | null {
  if (value == null) return null
  const trimmed = trimToNull(value)
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} must be an ISO-8601 timestamp or null`)
  }
  return parsed
}

function normalizeConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new ValidationError('confidence must be a number between 0 and 1')
  }
  return parsed
}

function normalizeProposedOutcome(value: unknown): CandidateOutcome {
  if (value === 'YES' || value === 'NO' || value === 'NO_DECISION') {
    return value
  }
  throw new ValidationError('proposedOutcome must be YES, NO, or NO_DECISION')
}

function normalizeProposedOutcomeDate(value: string | null, proposedOutcome: CandidateOutcome): Date | null {
  if (proposedOutcome === 'NO_DECISION') {
    return null
  }

  if (value == null) return null
  const trimmed = trimToNull(value)
  if (!trimmed) return null

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('proposedOutcomeDate must be an ISO-8601 timestamp or null')
  }

  return parsed
}

function normalizeSourceType(value: unknown): ManualReviewSourceType {
  if (MANUAL_REVIEW_SOURCE_TYPES.includes(value as ManualReviewSourceType)) {
    return value as ManualReviewSourceType
  }
  throw new ValidationError(`sourceType must be one of: ${MANUAL_REVIEW_SOURCE_TYPES.join(', ')}`)
}

function normalizeEvidence(
  value: unknown,
  decisionIndex: number,
): NormalizedManualTrialOutcomeEvidence[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`evidence must be an array for decision ${decisionIndex + 1}`)
  }
  if (value.length === 0 || value.length > MAX_EVIDENCE_ITEMS) {
    throw new ValidationError(`evidence must contain between 1 and ${MAX_EVIDENCE_ITEMS} citations for decision ${decisionIndex + 1}`)
  }

  const evidence = value.map((entry, evidenceIndex) => {
    if (!entry || typeof entry !== 'object') {
      throw new ValidationError(`evidence[${evidenceIndex}] must be an object for decision ${decisionIndex + 1}`)
    }

    const record = entry as Record<string, unknown>
    const url = normalizeUrl(record.url, `evidence[${evidenceIndex}].url`)
    const normalizedUrl = normalizeTrialOutcomeEvidenceUrl(url)

    return {
      title: requireText(record.title, `evidence[${evidenceIndex}].title`, MAX_TITLE_CHARS),
      url,
      normalizedUrl,
      publishedAt: normalizePublishedAt(record.publishedAt as string | null, `evidence[${evidenceIndex}].publishedAt`),
      excerpt: requireText(record.excerpt, `evidence[${evidenceIndex}].excerpt`, MAX_EXCERPT_CHARS),
      sourceType: normalizeSourceType(record.sourceType),
      domain: normalizeDomain(record.domain, url, `evidence[${evidenceIndex}].domain`),
    }
  })

  const normalizedUrls = evidence.map((entry) => entry.normalizedUrl)
  const uniqueUrlCount = new Set(normalizedUrls).size
  if (uniqueUrlCount !== normalizedUrls.length) {
    throw new ValidationError(`evidence citations must use distinct URLs for decision ${decisionIndex + 1}`)
  }

  return evidence
}

function normalizeDecision(
  value: unknown,
  decisionIndex: number,
): NormalizedManualTrialOutcomeDecision {
  if (!value || typeof value !== 'object') {
    throw new ValidationError(`decision ${decisionIndex + 1} must be an object`)
  }

  const record = value as Record<string, unknown>
  const trialQuestionId = requireText(record.trialQuestionId, `trialQuestionId for decision ${decisionIndex + 1}`)
  const proposedOutcome = normalizeProposedOutcome(record.proposedOutcome)
  const evidence = normalizeEvidence(record.evidence, decisionIndex)

  return {
    trialQuestionId,
    proposedOutcome,
    confidence: normalizeConfidence(record.confidence),
    proposedOutcomeDate: normalizeProposedOutcomeDate(record.proposedOutcomeDate as string | null, proposedOutcome),
    summary: requireText(record.summary, `summary for decision ${decisionIndex + 1}`, MAX_SUMMARY_CHARS),
    evidence,
    evidenceHash: buildTrialOutcomeEvidenceHash(
      proposedOutcome,
      evidence.map((entry) => entry.url),
    ),
  }
}

function buildDecisionKey(decision: Pick<NormalizedManualTrialOutcomeDecision, 'trialQuestionId' | 'proposedOutcome' | 'evidenceHash'>): string {
  return `${decision.trialQuestionId}::${decision.proposedOutcome}::${decision.evidenceHash}`
}

function formatManualImportDebugLog(input: {
  verifierModelKey: string
  sourceFile: string | null
  questionsScanned: number
  candidatesCreated: number
  duplicatesSkipped: number
  items: ManualTrialOutcomeImportItemResult[]
  importedAt: string
}): string {
  return JSON.stringify({
    source: 'manual_chat_import',
    verifierModelKey: input.verifierModelKey,
    verifierModelLabel: input.verifierModelKey,
    sourceFile: input.sourceFile,
    importedAt: input.importedAt,
    questionsScanned: input.questionsScanned,
    candidatesCreated: input.candidatesCreated,
    duplicatesSkipped: input.duplicatesSkipped,
    trialQuestionIds: input.items.map((item) => item.trialQuestionId),
    items: input.items.map((item) => ({
      trialQuestionId: item.trialQuestionId,
      proposedOutcome: item.proposedOutcome,
      status: item.status,
      candidateId: item.candidateId,
    })),
  }, null, 2)
}

function ensureUniqueTrialQuestionIds(decisions: NormalizedManualTrialOutcomeDecision[]) {
  const seen = new Set<string>()
  for (const decision of decisions) {
    if (seen.has(decision.trialQuestionId)) {
      throw new ValidationError(`decision list contains duplicate trialQuestionId ${decision.trialQuestionId}`)
    }
    seen.add(decision.trialQuestionId)
  }
}

async function loadQuestions(
  decisions: NormalizedManualTrialOutcomeDecision[],
): Promise<Map<string, TrialQuestionWithTrial>> {
  const questionIds = decisions.map((decision) => decision.trialQuestionId)
  const rows = await db.query.trialQuestions.findMany({
    where: inArray(trialQuestions.id, questionIds),
    with: {
      trial: true,
    },
  }) as TrialQuestionWithTrial[]

  const rowsById = new Map(rows.map((row) => [row.id, row]))

  for (const decision of decisions) {
    const question = rowsById.get(decision.trialQuestionId)
    if (!question) {
      throw new ValidationError(`trialQuestionId ${decision.trialQuestionId} was not found`)
    }
    if (question.status !== 'live') {
      throw new ValidationError(`trialQuestionId ${decision.trialQuestionId} is not live`)
    }
    if (!question.isBettable) {
      throw new ValidationError(`trialQuestionId ${decision.trialQuestionId} is not bettable`)
    }
    if (question.outcome !== 'Pending') {
      throw new ValidationError(`trialQuestionId ${decision.trialQuestionId} is no longer pending`)
    }
  }

  return rowsById
}

async function loadExistingDuplicateMap(
  decisions: NormalizedManualTrialOutcomeDecision[],
): Promise<Map<string, { id: string }>> {
  const questionIds = decisions.map((decision) => decision.trialQuestionId)
  const rows = questionIds.length === 0
    ? []
    : await db.query.trialOutcomeCandidates.findMany({
        where: inArray(trialOutcomeCandidates.trialQuestionId, questionIds),
        columns: {
          id: true,
          trialQuestionId: true,
          proposedOutcome: true,
          evidenceHash: true,
        },
      })

  const duplicates = new Map<string, { id: string }>()
  for (const row of rows) {
    duplicates.set(
      `${row.trialQuestionId}::${row.proposedOutcome}::${row.evidenceHash}`,
      { id: row.id },
    )
  }
  return duplicates
}

export async function importManualTrialOutcomeDecisions(input: {
  decisions: unknown
  sourceFile?: string | null
  apply?: boolean
  verifierModelKey?: string
}): Promise<ManualTrialOutcomeImportResult> {
  if (!Array.isArray(input.decisions)) {
    throw new ValidationError('Manual trial outcome input must be a JSON array')
  }

  const normalizedDecisions = input.decisions.map((decision, index) => normalizeDecision(decision, index))
  if (normalizedDecisions.length === 0) {
    throw new ValidationError('Provide at least one manual trial outcome decision')
  }

  ensureUniqueTrialQuestionIds(normalizedDecisions)

  const verifierModelKey = trimToNull(input.verifierModelKey) ?? MANUAL_CHAT_REVIEW_VERIFIER_KEY
  const questionsById = await loadQuestions(normalizedDecisions)
  const existingDuplicateMap = await loadExistingDuplicateMap(normalizedDecisions)
  const questionsScanned = normalizedDecisions.length
  const sourceFile = trimToNull(input.sourceFile) ?? null

  if (!input.apply) {
    const items = normalizedDecisions.map((decision) => {
      const question = questionsById.get(decision.trialQuestionId)
      const duplicate = existingDuplicateMap.get(buildDecisionKey(decision))
      return {
        trialQuestionId: decision.trialQuestionId,
        trialTitle: question?.trial.shortTitle ?? 'Unknown trial',
        nctNumber: question?.trial.nctNumber ?? null,
        proposedOutcome: decision.proposedOutcome,
        evidenceHash: decision.evidenceHash,
        status: duplicate ? 'duplicate' : 'ready',
        candidateId: duplicate?.id ?? null,
      } satisfies ManualTrialOutcomeImportItemResult
    })

    const duplicatesSkipped = items.filter((item) => item.status === 'duplicate').length
    return {
      mode: 'dry-run',
      verifierModelKey,
      sourceFile,
      questionsScanned,
      candidatesCreated: items.filter((item) => item.status === 'ready').length,
      duplicatesSkipped,
      lastMonitoredUpdated: questionsScanned,
      runId: null,
      items,
    }
  }

  return await db.transaction(async (tx) => {
    const now = new Date()
    const items: ManualTrialOutcomeImportItemResult[] = []
    let candidatesCreated = 0
    const updatedTrialIds = new Set<string>()

    for (const decision of normalizedDecisions) {
      const question = questionsById.get(decision.trialQuestionId)
      if (!question) {
        throw new ValidationError(`trialQuestionId ${decision.trialQuestionId} was not found`)
      }

      const duplicate = existingDuplicateMap.get(buildDecisionKey(decision))
      if (duplicate) {
        items.push({
          trialQuestionId: decision.trialQuestionId,
          trialTitle: question.trial.shortTitle,
          nctNumber: question.trial.nctNumber,
          proposedOutcome: decision.proposedOutcome,
          evidenceHash: decision.evidenceHash,
          status: 'duplicate',
          candidateId: duplicate.id,
        })
      } else {
        const [candidate] = await tx.insert(trialOutcomeCandidates)
          .values({
            trialQuestionId: decision.trialQuestionId,
            proposedOutcome: decision.proposedOutcome,
            proposedOutcomeDate: decision.proposedOutcome === 'NO_DECISION' ? null : decision.proposedOutcomeDate,
            confidence: decision.confidence,
            summary: decision.summary,
            verifierModelKey,
            providerResponseId: null,
            evidenceHash: decision.evidenceHash,
            status: 'pending_review',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              trialOutcomeCandidates.trialQuestionId,
              trialOutcomeCandidates.proposedOutcome,
              trialOutcomeCandidates.evidenceHash,
            ],
          })
          .returning({ id: trialOutcomeCandidates.id })

        if (candidate) {
          await tx.insert(trialOutcomeCandidateEvidence)
            .values(decision.evidence.map((evidence, index) => ({
              candidateId: candidate.id,
              sourceType: evidence.sourceType,
              title: evidence.title,
              url: evidence.url,
              publishedAt: evidence.publishedAt,
              excerpt: evidence.excerpt,
              domain: evidence.domain,
              displayOrder: index,
              createdAt: now,
            })))

          candidatesCreated += 1
          items.push({
            trialQuestionId: decision.trialQuestionId,
            trialTitle: question.trial.shortTitle,
            nctNumber: question.trial.nctNumber,
            proposedOutcome: decision.proposedOutcome,
            evidenceHash: decision.evidenceHash,
            status: 'inserted',
            candidateId: candidate.id,
          })
        } else {
          items.push({
            trialQuestionId: decision.trialQuestionId,
            trialTitle: question.trial.shortTitle,
            nctNumber: question.trial.nctNumber,
            proposedOutcome: decision.proposedOutcome,
            evidenceHash: decision.evidenceHash,
            status: 'duplicate',
            candidateId: null,
          })
        }
      }

      if (!updatedTrialIds.has(question.trial.id)) {
        updatedTrialIds.add(question.trial.id)
        await tx.update(trials)
          .set({
            lastMonitoredAt: now,
            updatedAt: now,
          })
          .where(eq(trials.id, question.trial.id))
      }
    }

    const duplicatesSkipped = items.filter((item) => item.status === 'duplicate').length
    const [run] = await tx.insert(trialMonitorRuns)
      .values({
        triggerSource: 'manual',
        status: 'completed',
        questionsScanned,
        candidatesCreated,
        errorSummary: null,
        debugLog: formatManualImportDebugLog({
          verifierModelKey,
          sourceFile,
          questionsScanned,
          candidatesCreated,
          duplicatesSkipped,
          items,
          importedAt: now.toISOString(),
        }),
        verifierModelKey,
        scopedNctNumber: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
      })
      .returning({ id: trialMonitorRuns.id })

    return {
      mode: 'apply',
      verifierModelKey,
      sourceFile,
      questionsScanned,
      candidatesCreated,
      duplicatesSkipped,
      lastMonitoredUpdated: updatedTrialIds.size,
      runId: run?.id ?? null,
      items,
    }
  })
}
