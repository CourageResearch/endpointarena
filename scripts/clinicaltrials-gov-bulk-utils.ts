import { readFile } from 'node:fs/promises'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import {
  getClinicalTrialsLeadSponsorName,
  getClinicalTrialsNctNumber,
  isClinicalTrialsActiveStatusStudy,
  isClinicalTrialsBaseUniverseStudy,
  isClinicalTrialsStudyOnOrAfterDate,
  isClinicalTrialsStudyInRollingWindow,
  type ClinicalTrialsGovStudy,
} from '../lib/clinicaltrials-gov'

const gunzipAsync = promisify(gunzip)

export type ClinicalTrialsSnapshotFile = {
  completionSinceDate?: string | null
  createdAt?: string | null
  sourceDataTimestamp?: string | null
  lookbackDays?: number | null
  studies?: ClinicalTrialsGovStudy[]
}

export type SponsorMapDecision = 'allow' | 'skip'

export type SponsorMapEntry = {
  normalizedSponsorKey: string
  sponsorName: string
  decision: SponsorMapDecision | null
  sponsorTicker: string | null
  notes: string | null
}

const SPONSOR_MAP_HEADERS = [
  'Normalized Sponsor Key',
  'Sponsor Name',
  'Decision',
  'Ticker',
  'Study Count',
  'Sample NCTs',
  'Notes',
] as const

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell)
      if (row.some((value) => value.length > 0)) {
        rows.push(row)
      }
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((value) => value.length > 0)) {
    rows.push(row)
  }

  return rows
}

function escapeCsvCell(value: string) {
  if (!/[",\r\n]/.test(value)) {
    return value
  }
  return `"${value.replace(/"/g, '""')}"`
}

function toCsv(rows: string[][]) {
  return `${rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\n')}\n`
}

async function readTextFileMaybeGzip(filePath: string) {
  const raw = await readFile(filePath)
  if (filePath.endsWith('.gz')) {
    return (await gunzipAsync(raw)).toString('utf8')
  }
  return raw.toString('utf8')
}

function parseDecision(value: string): SponsorMapDecision | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'allow' || normalized === 'skip') {
    return normalized
  }
  throw new Error(`Unsupported sponsor decision "${value}". Expected allow or skip.`)
}

function parseSnapshot(payload: string, filePath: string) {
  const parsed = JSON.parse(payload) as ClinicalTrialsSnapshotFile
  if (!Array.isArray(parsed.studies)) {
    throw new Error(`Snapshot file "${filePath}" is missing a "studies" array`)
  }
  return parsed
}

export function normalizeSponsorKey(value: string) {
  return normalizeWhitespace(value).toUpperCase()
}

export async function loadClinicalTrialsSnapshotFile(filePath: string) {
  const text = await readTextFileMaybeGzip(filePath)
  return parseSnapshot(text, filePath)
}

export function getMatchedStudiesFromSnapshot(snapshot: ClinicalTrialsSnapshotFile) {
  if (!Array.isArray(snapshot.studies)) {
    throw new Error('Snapshot is missing a "studies" array')
  }

  const referenceTime = typeof snapshot.createdAt === 'string' && snapshot.createdAt.trim()
    ? new Date(snapshot.createdAt)
    : new Date()
  const now = Number.isNaN(referenceTime.getTime()) ? new Date() : referenceTime
  const completionSinceDate = typeof snapshot.completionSinceDate === 'string' && snapshot.completionSinceDate.trim()
    ? new Date(`${snapshot.completionSinceDate.trim()}T00:00:00.000Z`)
    : null
  const lookbackDays = Number(snapshot.lookbackDays)

  if (!completionSinceDate && (!Number.isFinite(lookbackDays) || lookbackDays < 1)) {
    throw new Error('Snapshot is missing a valid "completionSinceDate" or "lookbackDays" value')
  }
  if (completionSinceDate && Number.isNaN(completionSinceDate.getTime())) {
    throw new Error('Snapshot contains an invalid "completionSinceDate" value')
  }

  return {
    completionSinceDate: completionSinceDate ? completionSinceDate.toISOString().slice(0, 10) : null,
    lookbackDays: Number.isFinite(lookbackDays) && lookbackDays >= 1 ? Math.round(lookbackDays) : null,
    now,
    matchedStudies: snapshot.studies.filter((study) => (
      isClinicalTrialsBaseUniverseStudy(study)
      && isClinicalTrialsActiveStatusStudy(study)
      && (
        completionSinceDate
          ? isClinicalTrialsStudyOnOrAfterDate(study, completionSinceDate)
          : isClinicalTrialsStudyInRollingWindow(study, Math.round(lookbackDays), now)
      )
    )),
  }
}

export function buildSponsorMapTemplateCsv(snapshot: ClinicalTrialsSnapshotFile) {
  const { matchedStudies, completionSinceDate, lookbackDays, now } = getMatchedStudiesFromSnapshot(snapshot)
  const sponsors = new Map<string, {
    sponsorName: string
    studyCount: number
    sampleNcts: string[]
  }>()

  for (const study of matchedStudies) {
    const sponsorName = getClinicalTrialsLeadSponsorName(study)
    if (!sponsorName) continue

    const normalizedSponsorKey = normalizeSponsorKey(sponsorName)
    if (!normalizedSponsorKey) continue

    const existing = sponsors.get(normalizedSponsorKey) ?? {
      sponsorName,
      studyCount: 0,
      sampleNcts: [],
    }

    existing.studyCount += 1

    const nctNumber = getClinicalTrialsNctNumber(study)
    if (nctNumber && !existing.sampleNcts.includes(nctNumber) && existing.sampleNcts.length < 5) {
      existing.sampleNcts.push(nctNumber)
    }

    sponsors.set(normalizedSponsorKey, existing)
  }

  const rows = [
    [...SPONSOR_MAP_HEADERS],
    ...Array.from(sponsors.entries())
      .sort((left, right) => {
        if (right[1].studyCount !== left[1].studyCount) {
          return right[1].studyCount - left[1].studyCount
        }
        return left[1].sponsorName.localeCompare(right[1].sponsorName)
      })
      .map(([normalizedSponsorKey, sponsor]) => ([
        normalizedSponsorKey,
        sponsor.sponsorName,
        '',
        '',
        String(sponsor.studyCount),
        sponsor.sampleNcts.join(' | '),
        '',
      ])),
  ]

  return {
    csvText: toCsv(rows),
    completionSinceDate,
    matchedStudyCount: matchedStudies.length,
    uniqueSponsors: sponsors.size,
    lookbackDays,
    snapshotCreatedAt: now.toISOString(),
  }
}

export async function loadSponsorMapFile(filePath: string) {
  const text = await readTextFileMaybeGzip(filePath)
  const rows = parseCsv(text)
  const [rawHeaders, ...dataRows] = rows

  if (!rawHeaders) {
    throw new Error(`Sponsor map file "${filePath}" is empty`)
  }

  const headerIndex = new Map(rawHeaders.map((header, index) => [normalizeWhitespace(header), index]))
  const requiredHeaders = ['Normalized Sponsor Key', 'Sponsor Name', 'Decision', 'Ticker']
  const missingHeaders = requiredHeaders.filter((header) => !headerIndex.has(header))

  if (missingHeaders.length > 0) {
    throw new Error(`Sponsor map file "${filePath}" is missing required headers: ${missingHeaders.join(', ')}`)
  }

  const mappings = new Map<string, SponsorMapEntry>()

  for (const [rowIndex, row] of dataRows.entries()) {
    const rawSponsorKey = row[headerIndex.get('Normalized Sponsor Key') ?? -1] ?? ''
    const rawSponsorName = row[headerIndex.get('Sponsor Name') ?? -1] ?? ''
    const rawDecision = row[headerIndex.get('Decision') ?? -1] ?? ''
    const rawTicker = row[headerIndex.get('Ticker') ?? -1] ?? ''
    const rawNotes = headerIndex.has('Notes')
      ? (row[headerIndex.get('Notes') ?? -1] ?? '')
      : ''

    const normalizedSponsorKey = normalizeSponsorKey(rawSponsorKey || rawSponsorName)
    if (!normalizedSponsorKey) {
      continue
    }

    if (mappings.has(normalizedSponsorKey)) {
      throw new Error(`Duplicate sponsor map entry for "${normalizedSponsorKey}" on row ${rowIndex + 2}`)
    }

    const sponsorName = normalizeWhitespace(rawSponsorName || rawSponsorKey)
    const decision = parseDecision(rawDecision)
    const sponsorTicker = normalizeWhitespace(rawTicker).toUpperCase() || null

    if (decision === 'allow' && !sponsorTicker) {
      throw new Error(`Allowed sponsor "${sponsorName || normalizedSponsorKey}" is missing a ticker on row ${rowIndex + 2}`)
    }

    mappings.set(normalizedSponsorKey, {
      normalizedSponsorKey,
      sponsorName: sponsorName || normalizedSponsorKey,
      decision,
      sponsorTicker,
      notes: normalizeWhitespace(rawNotes) || null,
    })
  }

  return mappings
}
