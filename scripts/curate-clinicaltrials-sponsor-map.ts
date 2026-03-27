import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getClinicalTrialsLeadSponsorName,
  getClinicalTrialsNctNumber,
  isClinicalTrialsStudyOnOrAfterDate,
  parseClinicalTrialsDate,
} from '../lib/clinicaltrials-gov'
import {
  getMatchedStudiesFromSnapshot,
  loadClinicalTrialsSnapshotFile,
} from './clinicaltrials-gov-bulk-utils'

type ParsedArgs = {
  configFile: string
  inputFile: string
  outputFile: string | null
  snapshotFile: string | null
}

type SponsorConfig = {
  defaultDecision?: 'skip'
  sponsors?: Array<{
    normalizedSponsorKey: string
    sponsorName: string
    sponsorTicker: string
  }>
}

type CsvRow = Record<string, string>

function parseArgs(argv: string[]): ParsedArgs {
  let configFile = 'config/clinicaltrials-first-run-sponsors.json'
  let inputFile: string | null = null
  let outputFile: string | null = null
  let snapshotFile: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config-file') {
      configFile = argv[index + 1]?.trim() || configFile
      index += 1
      continue
    }
    if (arg === '--input-file') {
      inputFile = argv[index + 1]?.trim() || null
      index += 1
      continue
    }
    if (arg === '--output-file') {
      outputFile = argv[index + 1]?.trim() || null
      index += 1
      continue
    }
    if (arg === '--snapshot-file') {
      snapshotFile = argv[index + 1]?.trim() || null
      index += 1
    }
  }

  if (!inputFile) {
    throw new Error('Usage: npx tsx scripts/curate-clinicaltrials-sponsor-map.ts --input-file path [--output-file path] [--snapshot-file path] [--config-file path]')
  }

  return { configFile, inputFile, outputFile, snapshotFile }
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

function toRows(text: string) {
  const parsed = parseCsv(text)
  const [headers, ...dataRows] = parsed
  if (!headers) {
    throw new Error('Sponsor CSV is empty')
  }

  return {
    headers,
    rows: dataRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as CsvRow),
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function buildDefaultOutputFile(inputFile: string) {
  const directory = path.dirname(inputFile)
  const baseName = path.basename(inputFile, path.extname(inputFile))
  return path.join(directory, `${baseName}-curated.csv`)
}

function shouldOpenStudy(study: Parameters<typeof getClinicalTrialsLeadSponsorName>[0], now: Date) {
  const primaryCompletionDate = parseClinicalTrialsDate(study.protocolSection?.statusModule?.primaryCompletionDateStruct?.date)
  const currentStatus = normalizeWhitespace(study.protocolSection?.statusModule?.overallStatus ?? '').toUpperCase()
  if (!primaryCompletionDate) return false
  if (currentStatus === 'COMPLETED' || currentStatus === 'TERMINATED' || currentStatus === 'WITHDRAWN' || currentStatus === 'SUSPENDED') {
    return false
  }
  return primaryCompletionDate.getTime() >= now.getTime()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outputFile = args.outputFile ?? buildDefaultOutputFile(args.inputFile)

  const [rawConfig, csvText] = await Promise.all([
    readFile(args.configFile, 'utf8'),
    readFile(args.inputFile, 'utf8'),
  ])

  const config = JSON.parse(rawConfig) as SponsorConfig
  const sponsors = new Map(
    (config.sponsors ?? []).map((entry) => [
      normalizeWhitespace(entry.normalizedSponsorKey).toUpperCase(),
      entry,
    ]),
  )

  const { headers, rows } = toRows(csvText)
  const curatedRows: CsvRow[] = rows.map((row) => {
    const sponsorKey = normalizeWhitespace(row['Normalized Sponsor Key'] || row['Sponsor Name']).toUpperCase()
    const sponsor = sponsors.get(sponsorKey)

    return {
      ...row,
      Decision: sponsor ? 'allow' : (config.defaultDecision ?? 'skip'),
      Ticker: sponsor?.sponsorTicker ?? '',
    }
  })

  await writeFile(
    outputFile,
    toCsv([
      headers,
      ...curatedRows.map((row) => headers.map((header) => row[header] ?? '')),
    ]),
  )

  const summary: Record<string, unknown> = {
    configFile: args.configFile,
    inputFile: args.inputFile,
    outputFile,
    allowedSponsors: curatedRows.filter((row) => row.Decision === 'allow').length,
    skippedSponsors: curatedRows.filter((row) => row.Decision !== 'allow').length,
  }

  if (args.snapshotFile) {
    const snapshot = await loadClinicalTrialsSnapshotFile(args.snapshotFile)
    const { matchedStudies, completionSinceDate } = getMatchedStudiesFromSnapshot(snapshot)
    const now = new Date()
    const allowedSponsorKeys = new Set(
      curatedRows
        .filter((row) => row.Decision === 'allow')
        .map((row) => normalizeWhitespace(row['Normalized Sponsor Key'] || row['Sponsor Name']).toUpperCase()),
    )

    const allowedStudies = matchedStudies.filter((study) => {
      const sponsorName = getClinicalTrialsLeadSponsorName(study)
      if (!sponsorName) return false
      const sponsorKey = normalizeWhitespace(sponsorName).toUpperCase()
      return allowedSponsorKeys.has(sponsorKey)
    })

    summary.completionSinceDate = completionSinceDate
    summary.allowedMatchedStudies = allowedStudies.length
    summary.allowedUniqueSponsorsInSnapshot = new Set(
      allowedStudies
        .map((study) => getClinicalTrialsLeadSponsorName(study))
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeWhitespace(value).toUpperCase()),
    ).size
    summary.allowedOpenableStudies = allowedStudies.filter((study) => shouldOpenStudy(study, now)).length
    summary.allowedEndedStudiesSinceWindowStart = allowedStudies.filter((study) => !shouldOpenStudy(study, now) && isClinicalTrialsStudyOnOrAfterDate(study, new Date(`${completionSinceDate ?? '1970-01-01'}T00:00:00.000Z`))).length
    summary.sampleAllowedNcts = allowedStudies
      .map((study) => getClinicalTrialsNctNumber(study))
      .filter((value): value is string => Boolean(value))
      .slice(0, 10)
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
