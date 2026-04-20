import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config()

const EXPECTED_HEADERS = [
  'NCT Number',
  'Short Title',
  'Sponsor (Ticker)',
  'Indication',
  'Exact Phase',
  'Intervention',
  'Primary Endpoint',
  'Study Start Date',
  'Est. Primary Completion',
  'Est. Study Completion',
  'Est. Results Posting Date',
  'Current Status',
  'Est. Enrollment',
  'Key Locations',
  'Brief Summary',
  'Standard Betting Markets',
] as const

type ExpectedHeader = (typeof EXPECTED_HEADERS)[number]

type CsvRow = Record<ExpectedHeader, string>
type ParsedCsv = {
  rows: CsvRow[]
  extraHeaders: string[]
}

type ParsedArgs = {
  filePath: string | null
  apply: boolean
  reset: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  let filePath: string | null = null
  let apply = false
  let reset = true

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--no-reset') {
      reset = false
      continue
    }
    if (arg === '--file') {
      filePath = argv[index + 1] ?? null
      index += 1
      continue
    }
  }

  return { filePath, apply, reset }
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

function parseRows(rawHeaders: string[], dataRows: string[][]): ParsedCsv {
  const headerIndex = new Map(rawHeaders.map((header, index) => [header, index]))
  const missingHeaders = EXPECTED_HEADERS.filter((header) => !headerIndex.has(header))
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required CSV headers: ${missingHeaders.join(', ')}`)
  }

  const extraHeaders = rawHeaders.filter((header) => !EXPECTED_HEADERS.includes(header as ExpectedHeader))
  const rows: CsvRow[] = dataRows.map((row, rowIndex) => {
    if (row.length > rawHeaders.length) {
      throw new Error(`Row ${rowIndex + 2} has ${row.length} columns; expected at most ${rawHeaders.length}`)
    }

    return Object.fromEntries(EXPECTED_HEADERS.map((header) => {
      const index = headerIndex.get(header)
      return [header, index == null ? '' : (row[index] ?? '')]
    })) as CsvRow
  })

  return { rows, extraHeaders }
}

function toNullableString(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseUtcDate(value: string, fieldName: string, rowLabel: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} for ${rowLabel}: "${value}"`)
  }
  return date
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = Number(trimmed.replace(/,/g, ''))
  if (!Number.isFinite(normalized)) {
    throw new Error(`Invalid integer value: "${value}"`)
  }
  return Math.max(0, Math.round(normalized))
}

function parseSponsorField(value: string): { sponsorName: string; sponsorTicker: string | null } {
  const trimmed = value.trim()
  const match = trimmed.match(/^(.*?)(?:\s*\(([^)]+)\))?$/)
  const sponsorName = match?.[1]?.trim() || trimmed
  const sponsorTicker = match?.[2]?.trim() || null
  return { sponsorName, sponsorTicker }
}

function parseNctNumber(value: string, rowLabel: string): string {
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) {
    throw new Error(`Missing NCT Number for ${rowLabel}`)
  }
  if (!/^NCT\d{8}$/.test(trimmed)) {
    throw new Error(`Invalid NCT Number for ${rowLabel}: "${value}". Expected format NCT########.`)
  }
  return trimmed
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.filePath) {
    throw new Error('Usage: npx tsx scripts/import-trials.ts --file /absolute/path/to/trials.csv [--apply] [--no-reset]')
  }

  const csvPath = path.resolve(process.cwd(), args.filePath)
  const csvText = await fs.readFile(csvPath, 'utf8')
  const parsedRows = parseCsv(csvText)
  const [rawHeaders, ...dataRows] = parsedRows
  if (!rawHeaders) {
    throw new Error('CSV is empty')
  }
  const { rows: rawRows, extraHeaders } = parseRows(rawHeaders, dataRows)

  const [{ ingestTrials }] = await Promise.all([
    import('../lib/trial-ingestion'),
  ])

  const summary = {
    trialsParsed: rawRows.length,
    duplicateNctsCollapsed: 0,
    trialsUpserted: 0,
    questionsUpserted: 0,
    marketsOpened: 0,
  }

  const dedupedRowsByNct = new Map<string, CsvRow>()
  for (const [index, row] of rawRows.entries()) {
    const nctNumber = parseNctNumber(row['NCT Number'], `row ${index + 2}`)
    if (dedupedRowsByNct.has(nctNumber)) {
      summary.duplicateNctsCollapsed += 1
    }
    dedupedRowsByNct.set(nctNumber, {
      ...row,
      'NCT Number': nctNumber,
    })
  }
  const rows = Array.from(dedupedRowsByNct.values())

  if (!args.apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      filePath: csvPath,
      trialsParsed: rawRows.length,
      trialsAfterDedup: rows.length,
      extraHeaders,
      resetOnApply: args.reset,
      sampleNcts: rows.slice(0, 5).map((row) => row['NCT Number']),
    }, null, 2))
    return
  }

  const ingestionSummary = await ingestTrials(
    rows.map((row) => {
      const nctNumber = parseNctNumber(row['NCT Number'], row['Short Title'].trim() || 'trial row')
      const rowLabel = `${nctNumber} / ${row['Short Title'].trim()}`
      const sponsor = parseSponsorField(row['Sponsor (Ticker)'])

      return {
        nctNumber,
        shortTitle: row['Short Title'].trim(),
        sponsorName: sponsor.sponsorName,
        sponsorTicker: sponsor.sponsorTicker,
        indication: row['Indication'].trim(),
        therapeuticArea: null,
        exactPhase: row['Exact Phase'].trim(),
        intervention: row['Intervention'].trim(),
        primaryEndpoint: row['Primary Endpoint'].trim(),
        studyStartDate: parseUtcDate(row['Study Start Date'], 'Study Start Date', rowLabel),
        estPrimaryCompletionDate: parseUtcDate(row['Est. Primary Completion'], 'Est. Primary Completion', rowLabel) ?? (() => { throw new Error(`Missing Est. Primary Completion for ${rowLabel}`) })(),
        estStudyCompletionDate: parseUtcDate(row['Est. Study Completion'], 'Est. Study Completion', rowLabel),
        estResultsPostingDate: parseUtcDate(row['Est. Results Posting Date'], 'Est. Results Posting Date', rowLabel),
        currentStatus: row['Current Status'].trim(),
        estEnrollment: parseInteger(row['Est. Enrollment']),
        keyLocations: toNullableString(row['Key Locations']),
        briefSummary: row['Brief Summary'].trim(),
        standardBettingMarkets: toNullableString(row['Standard Betting Markets']),
      }
    }),
    {
      reset: args.reset,
    },
  )

  summary.trialsUpserted = ingestionSummary.trialsUpserted
  summary.questionsUpserted = ingestionSummary.questionsUpserted
  summary.marketsOpened = ingestionSummary.marketsOpened

  console.log(JSON.stringify({
    mode: 'apply',
    filePath: csvPath,
    resetApplied: args.reset,
    ...summary,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
