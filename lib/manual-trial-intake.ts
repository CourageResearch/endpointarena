import path from 'node:path'
import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { getServerSession } from 'next-auth'
import { eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { createRequestId } from '@/lib/api-response'
import {
  fetchClinicalTrialsStudies,
  getClinicalTrialsLeadSponsorName,
  getClinicalTrialsNctNumber,
  mapClinicalTrialsStudyToTrialInput,
  type ClinicalTrialsGovStudy,
} from '@/lib/clinicaltrials-gov'
import { db, trials, trialQuestions } from '@/lib/db'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors'
import { ADMIN_EMAIL } from '@/lib/constants'
import { isLocalDevBypassEmail } from '@/lib/local-dev-bypass'
import { openMarketForTrialQuestion } from '@/lib/markets/engine'
import {
  DEFAULT_BINARY_MARKET_BASELINE,
  OPENING_PROBABILITY_CEIL,
  OPENING_PROBABILITY_FLOOR,
} from '@/lib/markets/constants'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { MODEL_PROVIDER_MODEL_IDS } from '@/lib/model-runtime-metadata'
import { TRIAL_QUESTION_DEFINITIONS } from '@/lib/trial-questions'
import type { NormalizedTrialInput } from '@/lib/trial-ingestion'

const MANUAL_TRIAL_DRAFT_MODEL = process.env.MANUAL_TRIAL_INTAKE_MODEL?.trim() || MODEL_PROVIDER_MODEL_IDS['gpt-5.4']
const MANUAL_TRIAL_AI_TIMEOUT_MS = 90_000
const MANUAL_TRIAL_SPONSOR_MAP_URL = new URL('../config/clinicaltrials-first-run-sponsors.json', import.meta.url)
const PUBLIC_COMPANY_REFERENCE_PATH = path.resolve(process.cwd(), 'tmp', 'reports', 'public-company-reference-current.json')
export type ManualTrialOpeningLineSource = 'draft_ai' | 'house_model' | 'fallback_default'
const MANUAL_TRIAL_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shortTitle: { type: 'string' },
    sponsorName: { type: 'string' },
    sponsorTicker: { type: ['string', 'null'] },
    exactPhase: { type: 'string' },
    indication: { type: 'string' },
    intervention: { type: 'string' },
    primaryEndpoint: { type: 'string' },
    currentStatus: { type: 'string' },
    keyLocations: { type: ['string', 'null'] },
    briefSummary: { type: 'string' },
    openingProbabilitySuggestion: {
      type: 'number',
      minimum: OPENING_PROBABILITY_FLOOR,
      maximum: OPENING_PROBABILITY_CEIL,
    },
  },
  required: [
    'shortTitle',
    'sponsorName',
    'sponsorTicker',
    'exactPhase',
    'indication',
    'intervention',
    'primaryEndpoint',
    'currentStatus',
    'keyLocations',
    'briefSummary',
    'openingProbabilitySuggestion',
  ],
} as const

type SponsorMapConfig = {
  sponsors?: Array<{
    normalizedSponsorKey?: string
    sponsorName?: string
    sponsorTicker?: string | null
  }>
}

type ManualSponsorMapping = {
  sponsorName: string
  sponsorTicker: string | null
}

type PublicCompanyReferenceIssuer = {
  canonicalCompanyKey: string
  companyName: string
  normalizedCompanyKey: string
  ticker: string
}

type ReferenceIndexes = {
  canonical: Map<string, PublicCompanyReferenceIssuer[]>
  exact: Map<string, PublicCompanyReferenceIssuer[]>
}

export type ManualTrialIntakeInput = {
  nctNumber?: unknown
  shortTitle?: unknown
  sponsorName?: unknown
  sponsorTicker?: unknown
  exactPhase?: unknown
  indication?: unknown
  intervention?: unknown
  primaryEndpoint?: unknown
  estPrimaryCompletionDate?: unknown
  currentStatus?: unknown
  studyStartDate?: unknown
  estStudyCompletionDate?: unknown
  estResultsPostingDate?: unknown
  estEnrollment?: unknown
  keyLocations?: unknown
  briefSummary?: unknown
  openingProbabilityOverride?: unknown
}

export type ManualTrialDraftForm = {
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string
  exactPhase: string
  indication: string
  intervention: string
  primaryEndpoint: string
  estPrimaryCompletionDate: string
  currentStatus: string
  studyStartDate: string
  estStudyCompletionDate: string
  estResultsPostingDate: string
  estEnrollment: string
  keyLocations: string
  briefSummary: string
  openingProbabilityOverride: string
}

export type ManualTrialPreview = {
  requestId: string
  normalizedTrial: NormalizedTrialInput
  question: {
    prompt: string
    slug: string
    status: 'live' | 'coming_soon'
    isBettable: boolean
  }
  openingLine: {
    suggestedProbability: number
    suggestedSource: ManualTrialOpeningLineSource
    errorMessage: string | null
    effectiveProbability: number
    overrideProbability: number | null
    openingLmsrB: number
    overrideApplied: boolean
  }
}

export type ManualTrialDraft = {
  requestId: string
  form: ManualTrialDraftForm
  source: {
    nctNumber: string
    source: 'clinicaltrials_gov'
    sponsorTickerMatched: boolean
  }
}

export type ManualTrialCalculation = {
  requestId: string
  form: ManualTrialDraftForm
  preview: ManualTrialPreview
  source: {
    nctNumber: string
    source: 'clinicaltrials_gov'
    usedAi: boolean
    aiModel: string | null
    aiError: string | null
  }
}

type ManualTrialAiDraft = {
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  exactPhase: string
  indication: string
  intervention: string
  primaryEndpoint: string
  currentStatus: string
  keyLocations: string | null
  briefSummary: string
  openingProbabilitySuggestion: number
}

type ManualTrialDraftRefinement = {
  normalizedTrial: NormalizedTrialInput
  usedAi: boolean
  aiModel: string | null
  suggestedOpeningProbability: number | null
  aiError: string | null
}

let sponsorTickerLookupPromise: Promise<{
  manualSponsorMap: Map<string, ManualSponsorMapping>
  referenceIndexes: ReferenceIndexes | null
}> | null = null

const LEGAL_SUFFIX_PATTERNS = [
  ['CO', 'LTD'],
  ['CO', 'LIMITED'],
  ['S', 'P', 'A'],
  ['INCORPORATED'],
  ['INC'],
  ['CORPORATION'],
  ['CORP'],
  ['COMPANY'],
  ['CO'],
  ['LIMITED'],
  ['LTD'],
  ['LLC'],
  ['PLC'],
  ['AG'],
  ['SA'],
  ['SE'],
  ['NV'],
  ['BV'],
  ['GMBH'],
  ['SAS'],
  ['SPA'],
  ['KK'],
] as const

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeSponsorKey(value: string | null | undefined) {
  return compactWhitespace(value ?? '').toUpperCase()
}

function canonicalizeEntityName(value: string | null | undefined) {
  let normalized = normalizeSponsorKey(value)
  if (!normalized) return ''

  normalized = normalized
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = normalized.split(' ').filter(Boolean)

  let changed = true
  while (changed && tokens.length > 0) {
    changed = false
    for (const suffix of LEGAL_SUFFIX_PATTERNS) {
      if (suffix.length > tokens.length) continue
      const tail = tokens.slice(tokens.length - suffix.length)
      if (tail.every((token, index) => token === suffix[index])) {
        tokens.splice(tokens.length - suffix.length, suffix.length)
        changed = true
        break
      }
    }
  }

  return tokens.join(' ').trim()
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} is required`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new ValidationError(`${fieldName} is required`)
  }

  return trimmed
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseUtcDate(value: unknown, fieldName: string, required: boolean): Date | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`)
    }
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ValidationError(`${fieldName} must be a YYYY-MM-DD date`)
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid date`)
  }

  return parsed
}

function parseOptionalInteger(value: unknown, fieldName: string): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${fieldName} must be a valid number`)
  }

  const rounded = Math.round(parsed)
  if (rounded < 0) {
    throw new ValidationError(`${fieldName} must be zero or greater`)
  }

  return rounded
}

function parseOptionalProbability(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('openingProbabilityOverride must be a valid number')
  }

  if (parsed < OPENING_PROBABILITY_FLOOR || parsed > OPENING_PROBABILITY_CEIL) {
    throw new ValidationError(
      `openingProbabilityOverride must be between ${OPENING_PROBABILITY_FLOOR} and ${OPENING_PROBABILITY_CEIL}`,
    )
  }

  return parsed
}

function normalizeNctNumber(value: unknown): string {
  const trimmed = requireNonEmptyString(value, 'nctNumber').toUpperCase()
  if (!/^NCT\d{8}$/.test(trimmed)) {
    throw new ValidationError('nctNumber must look like NCT12345678')
  }
  return trimmed
}

function formatDateInput(value: Date | null): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return ''
  }

  return value.toISOString().slice(0, 10)
}

function nonEmptyOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = compactWhitespace(value)
  return normalized.length > 0 ? normalized : fallback
}

function nullableOrFallback(value: unknown, fallback: string | null): string | null {
  if (value == null) return fallback
  if (typeof value !== 'string') return fallback

  const normalized = compactWhitespace(value)
  return normalized.length > 0 ? normalized : null
}

function normalizeSuggestedOpeningProbability(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  if (value < OPENING_PROBABILITY_FLOOR || value > OPENING_PROBABILITY_CEIL) {
    return null
  }

  return value
}

function extractResponseText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim()
  }

  const messages = (response?.output || []).filter((item: any) => item?.type === 'message')
  const parts: string[] = []

  for (const message of messages) {
    for (const content of message?.content || []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') {
        const text = content.text.trim()
        if (text.length > 0) {
          parts.push(text)
        }
      }
    }
  }

  return parts.join('\n').trim()
}

async function assertNctAvailable(nctNumber: string): Promise<void> {
  const existing = await db.query.trials.findFirst({
    where: eq(trials.nctNumber, nctNumber),
    columns: {
      id: true,
    },
  })

  if (existing) {
    throw new ConflictError(`Trial ${nctNumber} already exists`)
  }
}

function buildManualTrialDraftForm(
  normalizedTrial: NormalizedTrialInput,
  openingProbabilityOverride: number | null = null,
): ManualTrialDraftForm {
  return {
    nctNumber: normalizedTrial.nctNumber,
    shortTitle: normalizedTrial.shortTitle,
    sponsorName: normalizedTrial.sponsorName,
    sponsorTicker: normalizedTrial.sponsorTicker ?? '',
    exactPhase: normalizedTrial.exactPhase,
    indication: normalizedTrial.indication,
    intervention: normalizedTrial.intervention,
    primaryEndpoint: normalizedTrial.primaryEndpoint,
    estPrimaryCompletionDate: formatDateInput(normalizedTrial.estPrimaryCompletionDate),
    currentStatus: normalizedTrial.currentStatus,
    studyStartDate: formatDateInput(normalizedTrial.studyStartDate),
    estStudyCompletionDate: formatDateInput(normalizedTrial.estStudyCompletionDate),
    estResultsPostingDate: formatDateInput(normalizedTrial.estResultsPostingDate),
    estEnrollment: normalizedTrial.estEnrollment != null ? String(normalizedTrial.estEnrollment) : '',
    keyLocations: normalizedTrial.keyLocations ?? '',
    briefSummary: normalizedTrial.briefSummary,
    openingProbabilityOverride: openingProbabilityOverride != null ? String(openingProbabilityOverride) : '',
  }
}

function normalizeManualTrialInput(input: ManualTrialIntakeInput): {
  normalizedTrial: NormalizedTrialInput
  openingProbabilityOverride: number | null
} {
  return {
    normalizedTrial: {
      nctNumber: normalizeNctNumber(input.nctNumber),
      shortTitle: requireNonEmptyString(input.shortTitle, 'shortTitle'),
      sponsorName: requireNonEmptyString(input.sponsorName, 'sponsorName'),
      sponsorTicker: optionalString(input.sponsorTicker),
      indication: requireNonEmptyString(input.indication, 'indication'),
      exactPhase: requireNonEmptyString(input.exactPhase, 'exactPhase'),
      intervention: requireNonEmptyString(input.intervention, 'intervention'),
      primaryEndpoint: requireNonEmptyString(input.primaryEndpoint, 'primaryEndpoint'),
      studyStartDate: parseUtcDate(input.studyStartDate, 'studyStartDate', false),
      estPrimaryCompletionDate: parseUtcDate(input.estPrimaryCompletionDate, 'estPrimaryCompletionDate', true) as Date,
      estStudyCompletionDate: parseUtcDate(input.estStudyCompletionDate, 'estStudyCompletionDate', false),
      estResultsPostingDate: parseUtcDate(input.estResultsPostingDate, 'estResultsPostingDate', false),
      currentStatus: requireNonEmptyString(input.currentStatus, 'currentStatus'),
      estEnrollment: parseOptionalInteger(input.estEnrollment, 'estEnrollment'),
      keyLocations: optionalString(input.keyLocations),
      briefSummary: optionalString(input.briefSummary) ?? '',
      standardBettingMarkets: null,
    },
    openingProbabilityOverride: parseOptionalProbability(input.openingProbabilityOverride),
  }
}

async function fetchClinicalTrialsStudyByNctNumber(nctNumber: string): Promise<ClinicalTrialsGovStudy> {
  const result = await fetchClinicalTrialsStudies({
    queryTerm: nctNumber,
    pageSize: 10,
  })

  const study = result.studies.find((candidate) => getClinicalTrialsNctNumber(candidate) === nctNumber)
  if (!study) {
    throw new NotFoundError(`No ClinicalTrials.gov study found for ${nctNumber}`)
  }

  return study
}

async function loadManualPublicSponsorMap() {
  const raw = await readFile(MANUAL_TRIAL_SPONSOR_MAP_URL, 'utf8')
  const parsed = JSON.parse(raw) as SponsorMapConfig

  const entries = (parsed.sponsors ?? []).flatMap((entry): Array<readonly [string, ManualSponsorMapping]> => {
    const normalizedSponsorKey = normalizeSponsorKey(entry.normalizedSponsorKey ?? entry.sponsorName)
    const sponsorTicker = entry.sponsorTicker?.trim() || null
    if (!normalizedSponsorKey || !sponsorTicker) return []

    return [[
      normalizedSponsorKey,
      {
        sponsorName: entry.sponsorName ?? normalizedSponsorKey,
        sponsorTicker,
      },
    ] as const]
  })

  return new Map(entries)
}

async function loadPublicCompanyReferenceIndexes(): Promise<ReferenceIndexes | null> {
  const raw = await readFile(PUBLIC_COMPANY_REFERENCE_PATH, 'utf8').catch(() => null)
  if (!raw) {
    return null
  }

  const parsed = JSON.parse(raw) as {
    issuers?: Array<{
      canonicalCompanyKey?: string
      companyName?: string
      normalizedCompanyKey?: string
      ticker?: string
    }>
  }

  const exact = new Map<string, PublicCompanyReferenceIssuer[]>()
  const canonical = new Map<string, PublicCompanyReferenceIssuer[]>()

  for (const issuer of parsed.issuers ?? []) {
    const companyName = compactWhitespace(issuer.companyName ?? '')
    const ticker = normalizeSponsorKey(issuer.ticker)
    if (!companyName || !ticker) continue

    const normalizedCompanyKey = normalizeSponsorKey(issuer.normalizedCompanyKey ?? companyName)
    const canonicalCompanyKey = canonicalizeEntityName(issuer.canonicalCompanyKey ?? companyName)
    const normalizedIssuer: PublicCompanyReferenceIssuer = {
      canonicalCompanyKey,
      companyName,
      normalizedCompanyKey,
      ticker,
    }

    if (normalizedCompanyKey) {
      exact.set(normalizedCompanyKey, [...(exact.get(normalizedCompanyKey) ?? []), normalizedIssuer])
    }
    if (canonicalCompanyKey) {
      canonical.set(canonicalCompanyKey, [...(canonical.get(canonicalCompanyKey) ?? []), normalizedIssuer])
    }
  }

  return { canonical, exact }
}

function resolveReferenceMatch(matches: PublicCompanyReferenceIssuer[]) {
  const distinct = new Map(matches.map((issuer) => [`${issuer.normalizedCompanyKey}::${issuer.ticker}`, issuer]))
  return distinct.size === 1 ? Array.from(distinct.values())[0] : null
}

function matchSponsorToPublicCompany(
  sponsorName: string,
  manualMappings: Map<string, ManualSponsorMapping>,
  indexes?: ReferenceIndexes | null,
) {
  const normalizedSponsorKey = normalizeSponsorKey(sponsorName)
  const canonicalSponsorKey = canonicalizeEntityName(sponsorName)

  const manualMatch = manualMappings.get(normalizedSponsorKey)
  if (manualMatch) {
    return {
      matchSource: 'manual' as const,
      sponsorTicker: manualMatch.sponsorTicker,
    }
  }

  if (!indexes) {
    return { matchSource: 'unresolved' as const }
  }

  const canonicalMatch = canonicalSponsorKey ? resolveReferenceMatch(indexes.canonical.get(canonicalSponsorKey) ?? []) : null
  if (canonicalMatch) {
    return {
      matchSource: 'reference_canonical' as const,
      sponsorTicker: canonicalMatch.ticker,
    }
  }

  const exactMatch = normalizedSponsorKey ? resolveReferenceMatch(indexes.exact.get(normalizedSponsorKey) ?? []) : null
  if (exactMatch) {
    return {
      matchSource: 'reference_exact' as const,
      sponsorTicker: exactMatch.ticker,
    }
  }

  return { matchSource: 'unresolved' as const }
}

async function getSponsorTickerLookup() {
  if (!sponsorTickerLookupPromise) {
    sponsorTickerLookupPromise = (async () => {
      const manualSponsorMap = await loadManualPublicSponsorMap().catch(() => new Map<string, ManualSponsorMapping>())
      const referenceIndexes = await loadPublicCompanyReferenceIndexes()

      return {
        manualSponsorMap,
        referenceIndexes,
      }
    })()
  }

  return sponsorTickerLookupPromise
}

async function resolveSponsorOverrideForStudy(study: ClinicalTrialsGovStudy): Promise<{
  sponsorName: string
  sponsorTicker: string | null
} | undefined> {
  const sponsorName = getClinicalTrialsLeadSponsorName(study)
  if (!sponsorName) {
    return undefined
  }

  const { manualSponsorMap, referenceIndexes } = await getSponsorTickerLookup()
  const match = matchSponsorToPublicCompany(sponsorName, manualSponsorMap, referenceIndexes)
  if (match.matchSource === 'unresolved' || !('sponsorTicker' in match) || !match.sponsorTicker) {
    return undefined
  }

  return {
    sponsorName,
    sponsorTicker: match.sponsorTicker,
  }
}

function buildManualTrialDraftPrompt(study: ClinicalTrialsGovStudy, baseline: NormalizedTrialInput): string {
  return [
    'You are preparing an editable admin draft for a biotech trial intake form.',
    'The admin flow is: enter the NCT number, review the ClinicalTrials.gov fields, optionally run AI calculations, then approve the trial and market.',
    'Use the ClinicalTrials.gov study record plus the baseline parsed row to produce a faithful draft.',
    'Rules:',
    '- Never invent facts that are not supported by the source record.',
    '- Keep sponsorName official and exact.',
    '- Only set sponsorTicker when you are confident the lead sponsor is publicly traded and the ticker is unambiguous. Otherwise use null.',
    `- Include openingProbabilitySuggestion as a decimal between ${OPENING_PROBABILITY_FLOOR} and ${OPENING_PROBABILITY_CEIL} for the suggested YES opening line.`,
    '- Base openingProbabilitySuggestion on the trial facts only, not on any current market price.',
    '- Keep shortTitle concise and readable for an admin review queue.',
    '- Keep indication, intervention, and primaryEndpoint specific but compact.',
    '- exactPhase should stay concise like "Phase 2" or "Phase 1/Phase 2".',
    '- keyLocations should be a semicolon-separated country list or null.',
    '- briefSummary should be 1 to 3 sentences for market review and should not overstate certainty.',
    '- If the baseline wording is already strong, keep it close to baseline.',
    '',
    'Return JSON only.',
    '',
    `Baseline parsed row:\n${JSON.stringify(baseline, null, 2)}`,
    '',
    `ClinicalTrials.gov study:\n${JSON.stringify(study, null, 2)}`,
  ].join('\n')
}

function mergeAiDraftIntoNormalizedTrial(
  baseline: NormalizedTrialInput,
  aiDraft: ManualTrialAiDraft,
): NormalizedTrialInput {
  return {
    ...baseline,
    shortTitle: nonEmptyOrFallback(aiDraft.shortTitle, baseline.shortTitle),
    sponsorName: nonEmptyOrFallback(aiDraft.sponsorName, baseline.sponsorName),
    sponsorTicker: nullableOrFallback(aiDraft.sponsorTicker, baseline.sponsorTicker),
    exactPhase: nonEmptyOrFallback(aiDraft.exactPhase, baseline.exactPhase),
    indication: nonEmptyOrFallback(aiDraft.indication, baseline.indication),
    intervention: nonEmptyOrFallback(aiDraft.intervention, baseline.intervention),
    primaryEndpoint: nonEmptyOrFallback(aiDraft.primaryEndpoint, baseline.primaryEndpoint),
    currentStatus: nonEmptyOrFallback(aiDraft.currentStatus, baseline.currentStatus),
    keyLocations: nullableOrFallback(aiDraft.keyLocations, baseline.keyLocations),
    briefSummary: nonEmptyOrFallback(aiDraft.briefSummary, baseline.briefSummary),
  }
}

async function refineManualTrialDraftWithAi(
  study: ClinicalTrialsGovStudy,
  baseline: NormalizedTrialInput,
): Promise<ManualTrialDraftRefinement> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      normalizedTrial: baseline,
      usedAi: false,
      aiModel: null,
      suggestedOpeningProbability: null,
      aiError: 'OpenAI API key is not configured.',
    }
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await client.responses.create({
      model: MANUAL_TRIAL_DRAFT_MODEL,
      input: buildManualTrialDraftPrompt(study, baseline),
      max_output_tokens: 3000,
      reasoning: { effort: 'medium' },
      text: {
        format: {
          type: 'json_schema',
          name: 'manual_trial_intake_draft',
          strict: true,
          schema: MANUAL_TRIAL_DRAFT_SCHEMA,
        },
      },
    }, {
      signal: AbortSignal.timeout(MANUAL_TRIAL_AI_TIMEOUT_MS),
    })

    const content = extractResponseText(response)
    if (!content) {
      throw new Error('No content in manual trial draft response')
    }

    const parsed = JSON.parse(content) as ManualTrialAiDraft

    return {
      normalizedTrial: mergeAiDraftIntoNormalizedTrial(baseline, parsed),
      usedAi: true,
      aiModel: MANUAL_TRIAL_DRAFT_MODEL,
      suggestedOpeningProbability: normalizeSuggestedOpeningProbability(parsed.openingProbabilitySuggestion),
      aiError: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI draft error'
    console.warn(`[manual-trial-intake] Falling back to ClinicalTrials.gov baseline for draft: ${message}`)

    return {
      normalizedTrial: baseline,
      usedAi: false,
      aiModel: null,
      suggestedOpeningProbability: null,
      aiError: message,
    }
  }
}

function getSuggestedOpeningLine(args: {
  suggestedProbability?: number | null
  suggestedSource?: ManualTrialOpeningLineSource
  openingLineError?: string | null
}): {
  suggestedProbability: number
  suggestedSource: ManualTrialOpeningLineSource
  errorMessage: string | null
} {
  const aiSuggestedProbability = normalizeSuggestedOpeningProbability(args.suggestedProbability)
  if (aiSuggestedProbability != null) {
    return {
      suggestedProbability: aiSuggestedProbability,
      suggestedSource: args.suggestedSource ?? 'draft_ai',
      errorMessage: null,
    }
  }

  return {
    suggestedProbability: DEFAULT_BINARY_MARKET_BASELINE,
    suggestedSource: 'fallback_default',
    errorMessage: args.openingLineError ?? 'AI calculations did not return a suggested line.',
  }
}

async function previewManualTrialIntakeInternal(
  input: ManualTrialIntakeInput,
  options: {
    suggestedProbability?: number | null
    suggestedSource?: ManualTrialOpeningLineSource
    openingLineError?: string | null
  } = {},
): Promise<ManualTrialPreview> {
  const requestId = createRequestId()
  const { normalizedTrial, openingProbabilityOverride } = normalizeManualTrialInput(input)
  await assertNctAvailable(normalizedTrial.nctNumber)

  const definition = TRIAL_QUESTION_DEFINITIONS[0]
  if (!definition) {
    throw new ValidationError('No supported trial question definition is configured')
  }

  const runtimeConfig = await getMarketRuntimeConfig()
  const suggestedOpeningLine = getSuggestedOpeningLine({
    suggestedProbability: options.suggestedProbability,
    suggestedSource: options.suggestedSource,
    openingLineError: options.openingLineError,
  })

  const effectiveProbability = openingProbabilityOverride ?? suggestedOpeningLine.suggestedProbability

  return {
    requestId,
    normalizedTrial,
    question: {
      prompt: definition.prompt,
      slug: definition.slug,
      status: definition.status,
      isBettable: definition.isBettable,
    },
    openingLine: {
      suggestedProbability: suggestedOpeningLine.suggestedProbability,
      suggestedSource: suggestedOpeningLine.suggestedSource,
      errorMessage: suggestedOpeningLine.errorMessage,
      effectiveProbability,
      overrideProbability: openingProbabilityOverride,
      openingLmsrB: runtimeConfig.openingLmsrB,
      overrideApplied: openingProbabilityOverride != null,
    },
  }
}

export async function requireAdminUserId(): Promise<string> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id?.trim()
  const email = session?.user?.email?.trim().toLowerCase()

  if (!email) {
    throw new UnauthorizedError('Unauthorized - not logged in')
  }

  if (email !== ADMIN_EMAIL.toLowerCase() && !isLocalDevBypassEmail(email)) {
    throw new ForbiddenError('Forbidden - admin access required')
  }

  if (!userId) {
    throw new UnauthorizedError('Unauthorized - missing user id')
  }

  return userId
}

export async function generateManualTrialIntakeDraft(input: Pick<ManualTrialIntakeInput, 'nctNumber'>): Promise<ManualTrialDraft> {
  const requestId = createRequestId()
  const nctNumber = normalizeNctNumber(input.nctNumber)
  await assertNctAvailable(nctNumber)

  const study = await fetchClinicalTrialsStudyByNctNumber(nctNumber)
  const sponsorOverride = await resolveSponsorOverrideForStudy(study)
  const baseline = mapClinicalTrialsStudyToTrialInput(study, sponsorOverride)
  if (!baseline) {
    throw new ValidationError(`ClinicalTrials.gov did not return enough trial data to draft ${nctNumber}`)
  }

  const form = buildManualTrialDraftForm(baseline)

  return {
    requestId,
    form,
    source: {
      nctNumber,
      source: 'clinicaltrials_gov',
      sponsorTickerMatched: Boolean(sponsorOverride?.sponsorTicker),
    },
  }
}

export async function calculateManualTrialIntake(input: ManualTrialIntakeInput): Promise<ManualTrialCalculation> {
  const requestId = createRequestId()
  const { normalizedTrial, openingProbabilityOverride } = normalizeManualTrialInput(input)
  await assertNctAvailable(normalizedTrial.nctNumber)

  const study = await fetchClinicalTrialsStudyByNctNumber(normalizedTrial.nctNumber)
  const aiDraft = await refineManualTrialDraftWithAi(study, normalizedTrial)
  const form = buildManualTrialDraftForm(aiDraft.normalizedTrial, openingProbabilityOverride)
  const preview = await previewManualTrialIntakeInternal(form, {
    suggestedProbability: aiDraft.suggestedOpeningProbability,
    suggestedSource: aiDraft.suggestedOpeningProbability != null ? 'draft_ai' : 'fallback_default',
    openingLineError: aiDraft.aiError,
  })

  return {
    requestId,
    form,
    preview,
    source: {
      nctNumber: normalizedTrial.nctNumber,
      source: 'clinicaltrials_gov',
      usedAi: aiDraft.usedAi,
      aiModel: aiDraft.aiModel,
      aiError: aiDraft.aiError,
    },
  }
}

export async function previewManualTrialIntake(input: ManualTrialIntakeInput): Promise<ManualTrialPreview> {
  return previewManualTrialIntakeInternal(input, {
    suggestedSource: 'fallback_default',
    openingLineError: 'AI calculations have not been run yet.',
  })
}

export async function publishManualTrialIntake(
  input: ManualTrialIntakeInput,
  openedByUserId: string,
  options: {
    suggestedProbability?: number | null
    suggestedSource?: ManualTrialOpeningLineSource
    openingLineError?: string | null
  } = {},
) {
  const preview = await previewManualTrialIntakeInternal(input, options)
  const definition = TRIAL_QUESTION_DEFINITIONS[0]
  if (!definition) {
    throw new ValidationError('No supported trial question definition is configured')
  }

  return db.transaction(async (tx) => {
    const [trial] = await tx.insert(trials)
      .values({
        ...preview.normalizedTrial,
        source: 'manual_admin',
        briefSummary: preview.normalizedTrial.briefSummary,
        updatedAt: new Date(),
      })
      .returning()

    const [question] = await tx.insert(trialQuestions)
      .values({
        trialId: trial.id,
        slug: definition.slug,
        prompt: definition.prompt,
        status: definition.status,
        isBettable: definition.isBettable,
        sortOrder: definition.sortOrder,
        outcome: 'Pending',
        updatedAt: new Date(),
      })
      .returning()

    const market = await openMarketForTrialQuestion({
      trialQuestionId: question.id,
      houseOpeningProbability: preview.openingLine.suggestedProbability,
      openingProbabilityOverride: preview.openingLine.overrideProbability,
      openedByUserId,
    }, tx)

    return {
      trial,
      question,
      market,
      preview,
    }
  })
}
