import { readFile } from 'node:fs/promises'

export const DEFAULT_PUBLIC_COMPANY_REFERENCE_FILE = 'tmp/reports/public-company-reference-current.json'

export type PublicCompanyReferenceSource =
  | 'sec_company_tickers_exchange'
  | 'nasdaq_listed'
  | 'nasdaq_other_listed'

export type PublicCompanyReferenceIssuer = {
  canonicalCompanyKey: string
  companyName: string
  exchange: string | null
  normalizedCompanyKey: string
  sources: PublicCompanyReferenceSource[]
  ticker: string
}

export type PublicCompanyReferenceFile = {
  generatedAt: string
  issuers: PublicCompanyReferenceIssuer[]
  sources: Array<{
    downloadedAt: string
    recordCount: number
    source: PublicCompanyReferenceSource
    url: string
  }>
}

export type ManualSponsorMapping = {
  sponsorName: string
  sponsorTicker: string | null
}

export type SponsorMatchResult =
  | {
    canonicalSponsorKey: string
    matchSource: 'manual'
    matchedCompanyName: string
    normalizedSponsorKey: string
    sponsorTicker: string | null
  }
  | {
    canonicalSponsorKey: string
    exchange: string | null
    matchSource: 'reference_canonical' | 'reference_exact'
    matchedCompanyName: string
    normalizedSponsorKey: string
    referenceSources: PublicCompanyReferenceSource[]
    sponsorTicker: string
  }
  | {
    canonicalSponsorKey: string
    matchSource: 'unresolved'
    normalizedSponsorKey: string
  }

type ReferenceIndexes = {
  canonical: Map<string, PublicCompanyReferenceIssuer[]>
  exact: Map<string, PublicCompanyReferenceIssuer[]>
}

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

export function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeSponsorKey(value: string | null | undefined) {
  return normalizeWhitespace(value).toUpperCase()
}

export function canonicalizeEntityName(value: string | null | undefined) {
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

export function parsePipeDelimitedText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  if (lines.length === 0) {
    return []
  }

  const [headerLine, ...dataLines] = lines
  const headers = headerLine.split('|').map((header) => header.trim())

  return dataLines
    .filter((line) => !line.startsWith('File Creation Time:'))
    .map((line) => {
      const values = line.split('|')
      return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']))
    })
}

function cleanNasdaqSecurityName(value: string) {
  let normalized = normalizeWhitespace(value)
  if (!normalized) return ''

  const suffixPatterns = [
    /\s+-\s+American Depositary Shares?$/i,
    /\s+-\s+American Depositary Receipt[s]?$/i,
    /\s+-\s+ADR$/i,
    /\s+-\s+ADS$/i,
    /\s+-\s+Common Stock$/i,
    /\s+-\s+Ordinary Shares?$/i,
    /\s+-\s+Depositary Shares?$/i,
    /\s+-\s+Units?$/i,
    /\s+-\s+Warrants?$/i,
    /\s+-\s+Rights?$/i,
    /\s+Common Stock$/i,
    /\s+Ordinary Shares?$/i,
    /\s+American Depositary Shares?$/i,
    /\s+American Depositary Receipt[s]?$/i,
    /\s+Depositary Shares?$/i,
    /\s+Units?$/i,
    /\s+Warrants?$/i,
    /\s+Rights?$/i,
  ]

  for (const pattern of suffixPatterns) {
    normalized = normalized.replace(pattern, '').trim()
  }

  return normalized
}

function pushIssuer(
  issuers: Map<string, PublicCompanyReferenceIssuer>,
  companyName: string,
  ticker: string | null | undefined,
  exchange: string | null | undefined,
  source: PublicCompanyReferenceSource,
) {
  const normalizedCompanyKey = normalizeSponsorKey(companyName)
  const normalizedTicker = normalizeSponsorKey(ticker)
  if (!normalizedCompanyKey || !normalizedTicker) return

  const canonicalCompanyKey = canonicalizeEntityName(companyName)
  const dedupeKey = `${normalizedCompanyKey}::${normalizedTicker}`
  const existing = issuers.get(dedupeKey)

  if (existing) {
    if (!existing.sources.includes(source)) {
      existing.sources.push(source)
    }
    if (!existing.exchange && exchange) {
      existing.exchange = exchange
    }
    return
  }

  issuers.set(dedupeKey, {
    canonicalCompanyKey,
    companyName: normalizeWhitespace(companyName),
    exchange: normalizeWhitespace(exchange) || null,
    normalizedCompanyKey,
    sources: [source],
    ticker: normalizedTicker,
  })
}

export function buildPublicCompanyReferenceFromDownloads(downloads: {
  nasdaqListedText?: string | null
  nasdaqOtherListedText?: string | null
  secJsonText: string
}) {
  const issuers = new Map<string, PublicCompanyReferenceIssuer>()

  const secPayload = JSON.parse(downloads.secJsonText) as {
    data?: unknown[][]
    fields?: string[]
  }

  for (const row of secPayload.data ?? []) {
    const [, name, ticker, exchange] = row
    pushIssuer(
      issuers,
      typeof name === 'string' ? name : '',
      typeof ticker === 'string' ? ticker : '',
      typeof exchange === 'string' ? exchange : '',
      'sec_company_tickers_exchange',
    )
  }

  for (const row of parsePipeDelimitedText(downloads.nasdaqListedText ?? '')) {
    if ((row['Test Issue'] || '').toUpperCase() === 'Y') continue
    if ((row.ETF || '').toUpperCase() === 'Y') continue
    pushIssuer(
      issuers,
      cleanNasdaqSecurityName(row['Security Name'] || ''),
      row.Symbol,
      'Nasdaq',
      'nasdaq_listed',
    )
  }

  for (const row of parsePipeDelimitedText(downloads.nasdaqOtherListedText ?? '')) {
    if ((row['Test Issue'] || '').toUpperCase() === 'Y') continue
    if ((row.ETF || '').toUpperCase() === 'Y') continue
    pushIssuer(
      issuers,
      cleanNasdaqSecurityName(row['Security Name'] || ''),
      row['ACT Symbol'] || row['NASDAQ Symbol'],
      row.Exchange || null,
      'nasdaq_other_listed',
    )
  }

  return Array.from(issuers.values()).sort((left, right) => {
    const nameCompare = left.companyName.localeCompare(right.companyName)
    if (nameCompare !== 0) return nameCompare
    return left.ticker.localeCompare(right.ticker)
  })
}

export function buildReferenceIndexes(referenceFile: PublicCompanyReferenceFile): ReferenceIndexes {
  const exact = new Map<string, PublicCompanyReferenceIssuer[]>()
  const canonical = new Map<string, PublicCompanyReferenceIssuer[]>()

  for (const issuer of referenceFile.issuers) {
    if (issuer.normalizedCompanyKey) {
      exact.set(issuer.normalizedCompanyKey, [...(exact.get(issuer.normalizedCompanyKey) ?? []), issuer])
    }
    if (issuer.canonicalCompanyKey) {
      canonical.set(issuer.canonicalCompanyKey, [...(canonical.get(issuer.canonicalCompanyKey) ?? []), issuer])
    }
  }

  return { canonical, exact }
}

export async function loadPublicCompanyReferenceFile(filePath: string) {
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw) as PublicCompanyReferenceFile

  return {
    ...parsed,
    issuers: (parsed.issuers ?? []).map((issuer) => ({
      ...issuer,
      canonicalCompanyKey: issuer.canonicalCompanyKey ?? canonicalizeEntityName(issuer.companyName),
      normalizedCompanyKey: issuer.normalizedCompanyKey ?? normalizeSponsorKey(issuer.companyName),
      sources: Array.isArray(issuer.sources) ? issuer.sources : [],
    })),
  } satisfies PublicCompanyReferenceFile
}

function resolveReferenceMatch(matches: PublicCompanyReferenceIssuer[]) {
  const distinct = new Map(matches.map((issuer) => [`${issuer.normalizedCompanyKey}::${issuer.ticker}`, issuer]))
  return distinct.size === 1 ? Array.from(distinct.values())[0] : null
}

export function matchSponsorToPublicCompany(
  sponsorName: string,
  manualMappings: Map<string, ManualSponsorMapping>,
  indexes?: ReferenceIndexes | null,
): SponsorMatchResult {
  const normalizedSponsorKey = normalizeSponsorKey(sponsorName)
  const canonicalSponsorKey = canonicalizeEntityName(sponsorName)

  const manualMatch = manualMappings.get(normalizedSponsorKey)
  if (manualMatch) {
    return {
      canonicalSponsorKey,
      matchSource: 'manual',
      matchedCompanyName: manualMatch.sponsorName,
      normalizedSponsorKey,
      sponsorTicker: manualMatch.sponsorTicker,
    }
  }

  if (!indexes) {
    return {
      canonicalSponsorKey,
      matchSource: 'unresolved',
      normalizedSponsorKey,
    }
  }

  const exactMatch = resolveReferenceMatch(indexes.exact.get(normalizedSponsorKey) ?? [])
  if (exactMatch) {
    return {
      canonicalSponsorKey,
      exchange: exactMatch.exchange,
      matchSource: 'reference_exact',
      matchedCompanyName: exactMatch.companyName,
      normalizedSponsorKey,
      referenceSources: exactMatch.sources,
      sponsorTicker: exactMatch.ticker,
    }
  }

  const canonicalMatch = canonicalSponsorKey
    ? resolveReferenceMatch(indexes.canonical.get(canonicalSponsorKey) ?? [])
    : null
  if (canonicalMatch) {
    return {
      canonicalSponsorKey,
      exchange: canonicalMatch.exchange,
      matchSource: 'reference_canonical',
      matchedCompanyName: canonicalMatch.companyName,
      normalizedSponsorKey,
      referenceSources: canonicalMatch.sources,
      sponsorTicker: canonicalMatch.ticker,
    }
  }

  return {
    canonicalSponsorKey,
    matchSource: 'unresolved',
    normalizedSponsorKey,
  }
}
