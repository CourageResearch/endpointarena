import { ExternalServiceError } from '@/lib/errors'
import type { NormalizedTrialInput } from '@/lib/trial-ingestion'

const CLINICAL_TRIALS_API_BASE_URL = 'https://clinicaltrials.gov/api/v2'
const CLINICAL_TRIALS_REQUEST_TIMEOUT_MS = 30_000
const CLINICAL_TRIALS_DEFAULT_PAGE_SIZE = 100
const STANDARD_BETTING_MARKETS = 'Will the Primary Endpoint be met? (Yes/No)'

const ACTIVE_SYNC_STATUSES = new Set([
  'NOT_YET_RECRUITING',
  'RECRUITING',
  'ENROLLING_BY_INVITATION',
  'ACTIVE_NOT_RECRUITING',
  'COMPLETED',
])

const STATUS_LABELS: Record<string, string> = {
  NOT_YET_RECRUITING: 'Not Yet Recruiting',
  RECRUITING: 'Recruiting',
  ENROLLING_BY_INVITATION: 'Enrolling By Invitation',
  ACTIVE_NOT_RECRUITING: 'Active Not Recruiting',
  SUSPENDED: 'Suspended',
  TERMINATED: 'Terminated',
  COMPLETED: 'Completed',
  WITHDRAWN: 'Withdrawn',
  UNKNOWN: 'Unknown',
}

const PHASE_LABELS: Record<string, string> = {
  EARLY_PHASE1: 'Early Phase 1',
  PHASE1: 'Phase 1',
  PHASE2: 'Phase 2',
  PHASE3: 'Phase 3',
  PHASE4: 'Phase 4',
  NA: 'N/A',
}

type DateStruct = {
  date?: string | null
  type?: string | null
}

type Location = {
  facility?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
}

type Intervention = {
  type?: string | null
  name?: string | null
}

type Outcome = {
  measure?: string | null
  description?: string | null
  timeFrame?: string | null
}

export type ClinicalTrialsGovStudy = {
  protocolSection?: {
    identificationModule?: {
      nctId?: string | null
      briefTitle?: string | null
      officialTitle?: string | null
    }
    sponsorCollaboratorsModule?: {
      leadSponsor?: {
        name?: string | null
        class?: string | null
      }
    }
    statusModule?: {
      overallStatus?: string | null
      startDateStruct?: DateStruct | null
      primaryCompletionDateStruct?: DateStruct | null
      completionDateStruct?: DateStruct | null
      resultsFirstPostDateStruct?: DateStruct | null
      lastUpdatePostDateStruct?: DateStruct | null
    }
    designModule?: {
      studyType?: string | null
      phases?: string[] | null
      enrollmentInfo?: {
        count?: number | null
      } | null
    }
    conditionsModule?: {
      conditions?: string[] | null
    }
    armsInterventionsModule?: {
      interventions?: Intervention[] | null
    }
    outcomesModule?: {
      primaryOutcomes?: Outcome[] | null
    }
    contactsLocationsModule?: {
      locations?: Location[] | null
    }
    descriptionModule?: {
      briefSummary?: string | null
    }
  }
}

type ClinicalTrialsGovStudiesResponse = {
  totalCount?: number
  nextPageToken?: string | null
  studies?: ClinicalTrialsGovStudy[]
}

type ClinicalTrialsGovVersionResponse = {
  apiVersion?: string
  dataTimestamp?: string
}

type FetchStudiesInput = {
  queryTerm: string
  pageSize?: number
}

export type ClinicalTrialsGovFetchResult = {
  totalCount: number
  studies: ClinicalTrialsGovStudy[]
}

export type ClinicalTrialsSponsorOverride = {
  sponsorName?: string
  sponsorTicker?: string | null
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function titleizeToken(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatUtcDateForQuery(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function toUtcDayStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + (days * 24 * 60 * 60 * 1000))
}

export function parseClinicalTrialsDate(value: string | null | undefined): Date | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null

  let normalized: string
  if (/^\d{4}$/.test(trimmed)) {
    normalized = `${trimmed}-01-01T00:00:00.000Z`
  } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
    normalized = `${trimmed}-01T00:00:00.000Z`
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    normalized = `${trimmed}T00:00:00.000Z`
  } else {
    normalized = trimmed
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function fetchJson<T>(path: string, searchParams?: URLSearchParams): Promise<T> {
  const url = new URL(`${CLINICAL_TRIALS_API_BASE_URL}${path}`)
  if (searchParams) {
    url.search = searchParams.toString()
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(CLINICAL_TRIALS_REQUEST_TIMEOUT_MS),
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new ExternalServiceError(`ClinicalTrials.gov request failed with status ${response.status}`, {
      details: {
        url: url.toString(),
        status: response.status,
      },
    })
  }

  try {
    return await response.json() as T
  } catch (error) {
    throw new ExternalServiceError('ClinicalTrials.gov returned invalid JSON', {
      cause: error,
      details: {
        url: url.toString(),
      },
    })
  }
}

export async function fetchClinicalTrialsVersion(): Promise<ClinicalTrialsGovVersionResponse> {
  return fetchJson<ClinicalTrialsGovVersionResponse>('/version')
}

export async function fetchClinicalTrialsStudies(input: FetchStudiesInput): Promise<ClinicalTrialsGovFetchResult> {
  const pageSize = input.pageSize ?? CLINICAL_TRIALS_DEFAULT_PAGE_SIZE
  const studies: ClinicalTrialsGovStudy[] = []
  let totalCount = 0
  let nextPageToken: string | null | undefined = null

  do {
    const searchParams = new URLSearchParams({
      'query.term': input.queryTerm,
      pageSize: String(pageSize),
      countTotal: 'true',
    })
    if (nextPageToken) {
      searchParams.set('pageToken', nextPageToken)
    }

    const payload = await fetchJson<ClinicalTrialsGovStudiesResponse>('/studies', searchParams)
    if (typeof payload.totalCount === 'number') {
      totalCount = payload.totalCount
    }
    if (Array.isArray(payload.studies)) {
      studies.push(...payload.studies)
    }

    nextPageToken = payload.nextPageToken
  } while (nextPageToken)

  return {
    totalCount,
    studies,
  }
}

export async function fetchClinicalTrialsStudyByNctNumber(nctNumber: string): Promise<ClinicalTrialsGovStudy | null> {
  const normalizedNctNumber = nctNumber.trim().toUpperCase()
  if (!/^NCT\d{8}$/.test(normalizedNctNumber)) {
    return null
  }

  try {
    return await fetchJson<ClinicalTrialsGovStudy>(`/studies/${encodeURIComponent(normalizedNctNumber)}`)
  } catch (error) {
    if (
      error instanceof ExternalServiceError
      && typeof error.details?.status === 'number'
      && error.details.status === 404
    ) {
      return null
    }
    throw error
  }
}

function buildClinicalTrialsBaseQueryTerm() {
  return 'AREA[LeadSponsorClass]INDUSTRY AND AREA[StudyType]INTERVENTIONAL AND AREA[Phase]PHASE2'
}

export function buildClinicalTrialsReconcileQueryTerm(cutoffDate: Date) {
  return `${buildClinicalTrialsBaseQueryTerm()} AND (AREA[PrimaryCompletionDate]RANGE[${formatUtcDateForQuery(cutoffDate)},MAX] OR AREA[CompletionDate]RANGE[${formatUtcDateForQuery(cutoffDate)},MAX])`
}

export function buildClinicalTrialsIncrementalQueryTerm(sinceDate: Date) {
  return `${buildClinicalTrialsBaseQueryTerm()} AND AREA[LastUpdatePostDate]RANGE[${formatUtcDateForQuery(sinceDate)},MAX]`
}

export function isClinicalTrialsBaseUniverseStudy(study: ClinicalTrialsGovStudy) {
  const leadSponsorClass = study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.class?.trim().toUpperCase() ?? ''
  const studyType = study.protocolSection?.designModule?.studyType?.trim().toUpperCase() ?? ''
  const phases = study.protocolSection?.designModule?.phases ?? []

  return leadSponsorClass === 'INDUSTRY'
    && studyType === 'INTERVENTIONAL'
    && phases.some((phase) => phase?.trim().toUpperCase() === 'PHASE2')
}

export function isClinicalTrialsActiveStatusStudy(study: ClinicalTrialsGovStudy) {
  const overallStatus = study.protocolSection?.statusModule?.overallStatus?.trim().toUpperCase() ?? ''
  return ACTIVE_SYNC_STATUSES.has(overallStatus)
}

export function isClinicalTrialsStudyOnOrAfterDate(
  study: ClinicalTrialsGovStudy,
  sinceDate: Date,
) {
  const cutoff = toUtcDayStart(sinceDate)
  const primaryCompletionDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.primaryCompletionDateStruct?.date)
  const completionDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.completionDateStruct?.date)

  return Boolean(
    (primaryCompletionDate && primaryCompletionDate.getTime() >= cutoff.getTime())
    || (completionDate && completionDate.getTime() >= cutoff.getTime()),
  )
}

export function isClinicalTrialsStudyInRollingWindow(
  study: ClinicalTrialsGovStudy,
  lookbackDays: number,
  now: Date = new Date(),
) {
  const cutoff = addUtcDays(toUtcDayStart(now), -lookbackDays)
  return isClinicalTrialsStudyOnOrAfterDate(study, cutoff)
}

function summarizeInterventions(interventions: Intervention[] | null | undefined) {
  const items = (interventions ?? [])
    .map((entry) => {
      const type = normalizeWhitespace(entry.type ?? '')
      const name = normalizeWhitespace(entry.name ?? '')
      if (!type && !name) return null
      return type ? `${type}: ${name || 'Unnamed intervention'}` : name
    })
    .filter((value): value is string => Boolean(value))

  if (items.length === 0) {
    return 'See ClinicalTrials.gov record for intervention details.'
  }

  const uniqueItems = Array.from(new Set(items))
  const visible = uniqueItems.slice(0, 4)
  const suffix = uniqueItems.length > visible.length ? ` +${uniqueItems.length - visible.length} more` : ''
  return truncate(`${visible.join(' | ')}${suffix}`, 500)
}

function summarizePrimaryOutcomes(primaryOutcomes: Outcome[] | null | undefined) {
  const items = (primaryOutcomes ?? [])
    .map((entry) => {
      const parts = [
        normalizeWhitespace(entry.measure ?? ''),
        normalizeWhitespace(entry.description ?? ''),
        normalizeWhitespace(entry.timeFrame ?? ''),
      ].filter(Boolean)

      if (parts.length === 0) return null
      return parts.join(', ')
    })
    .filter((value): value is string => Boolean(value))

  if (items.length === 0) {
    return 'Primary endpoint not available in the ClinicalTrials.gov API response.'
  }

  return truncate(items.slice(0, 2).join(' | '), 1000)
}

function summarizeConditions(conditions: string[] | null | undefined) {
  const items = Array.from(new Set((conditions ?? []).map((value) => normalizeWhitespace(value)).filter(Boolean)))
  if (items.length === 0) return 'Unspecified indication'
  return truncate(items.join('; '), 500)
}

function summarizeLocations(locations: Location[] | null | undefined) {
  const countries = Array.from(new Set(
    (locations ?? [])
      .map((location) => normalizeWhitespace(location.country ?? ''))
      .filter(Boolean),
  ))

  if (countries.length === 0) {
    return null
  }

  const visible = countries.slice(0, 4)
  const suffix = countries.length > visible.length ? ` +${countries.length - visible.length} more` : ''
  return truncate(`${visible.join('; ')}${suffix}`, 300)
}

function humanizeStatus(value: string | null | undefined) {
  const trimmed = value?.trim().toUpperCase() ?? ''
  if (!trimmed) return 'Unknown'
  return STATUS_LABELS[trimmed] ?? titleizeToken(trimmed)
}

function humanizePhases(phases: string[] | null | undefined) {
  const items = (phases ?? [])
    .map((phase) => phase?.trim().toUpperCase() ?? '')
    .filter(Boolean)
    .map((phase) => PHASE_LABELS[phase] ?? titleizeToken(phase))

  if (items.length === 0) return 'Unspecified'
  return items.join('/')
}

export function getClinicalTrialsLastUpdatePostDate(study: ClinicalTrialsGovStudy) {
  return parseClinicalTrialsDate(study.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date)
}

export function getClinicalTrialsNctNumber(study: ClinicalTrialsGovStudy) {
  const value = study.protocolSection?.identificationModule?.nctId?.trim().toUpperCase() ?? ''
  return /^NCT\d{8}$/.test(value) ? value : null
}

export function getClinicalTrialsLeadSponsorName(study: ClinicalTrialsGovStudy) {
  const sponsorName = normalizeWhitespace(study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name ?? '')
  return sponsorName || null
}

export function normalizeClinicalTrialsSponsorKey(value: string) {
  return normalizeWhitespace(value).toUpperCase()
}

export function mapClinicalTrialsStudyToTrialInput(
  study: ClinicalTrialsGovStudy,
  sponsorOverride?: ClinicalTrialsSponsorOverride,
): NormalizedTrialInput | null {
  const nctNumber = getClinicalTrialsNctNumber(study)
  const briefTitle = normalizeWhitespace(
    study.protocolSection?.identificationModule?.briefTitle
    ?? study.protocolSection?.identificationModule?.officialTitle
    ?? '',
  )
  const sponsorName = normalizeWhitespace(sponsorOverride?.sponsorName ?? getClinicalTrialsLeadSponsorName(study) ?? '')
  const primaryCompletionDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.primaryCompletionDateStruct?.date)

  if (!nctNumber || !briefTitle || !sponsorName || !primaryCompletionDate) {
    return null
  }

  const startDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.startDateStruct?.date)
  const completionDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.completionDateStruct?.date)
  const resultsFirstPostDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.resultsFirstPostDateStruct?.date)
  const briefSummary = normalizeWhitespace(study.protocolSection?.descriptionModule?.briefSummary ?? '')

  return {
    nctNumber,
    shortTitle: briefTitle,
    sponsorName,
    sponsorTicker: sponsorOverride?.sponsorTicker?.trim() || null,
    indication: summarizeConditions(study.protocolSection?.conditionsModule?.conditions),
    therapeuticArea: null,
    exactPhase: humanizePhases(study.protocolSection?.designModule?.phases),
    intervention: summarizeInterventions(study.protocolSection?.armsInterventionsModule?.interventions),
    primaryEndpoint: summarizePrimaryOutcomes(study.protocolSection?.outcomesModule?.primaryOutcomes),
    studyStartDate: startDate,
    estPrimaryCompletionDate: primaryCompletionDate,
    estStudyCompletionDate: completionDate,
    estResultsPostingDate: resultsFirstPostDate,
    currentStatus: humanizeStatus(study.protocolSection?.statusModule?.overallStatus),
    estEnrollment: study.protocolSection?.designModule?.enrollmentInfo?.count ?? null,
    keyLocations: summarizeLocations(study.protocolSection?.contactsLocationsModule?.locations),
    briefSummary: briefSummary || `ClinicalTrials.gov record for ${briefTitle}.`,
    standardBettingMarkets: STANDARD_BETTING_MARKETS,
  }
}
