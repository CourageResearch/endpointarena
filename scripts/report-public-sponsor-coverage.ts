import dotenv from 'dotenv'
import { desc, sql } from 'drizzle-orm'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { db, phase2Trials } from '../lib/db'
import {
  buildReferenceIndexes,
  DEFAULT_PUBLIC_COMPANY_REFERENCE_FILE,
  loadPublicCompanyReferenceFile,
  matchSponsorToPublicCompany,
  normalizeSponsorKey,
  type ManualSponsorMapping,
} from './public-company-reference-utils'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config()

type ParsedArgs = {
  detailsFile: string | null
  limit: number
  referenceFile: string | null
}

type SponsorMapConfig = {
  sponsors?: Array<{
    normalizedSponsorKey?: string
    sponsorName?: string
    sponsorTicker?: string | null
  }>
}

function parseArgs(argv: string[]): ParsedArgs {
  let limit = 25
  let referenceFile: string | null = DEFAULT_PUBLIC_COMPANY_REFERENCE_FILE
  let detailsFile: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--limit') {
      const next = Number(argv[index + 1])
      if (!Number.isFinite(next) || next < 1) {
        throw new Error('Usage: npx tsx scripts/report-public-sponsor-coverage.ts [--limit number]')
      }
      limit = Math.round(next)
      index += 1
      continue
    }
    if (arg === '--reference-file') {
      referenceFile = argv[index + 1]?.trim() || referenceFile
      index += 1
      continue
    }
    if (arg === '--no-reference-file') {
      referenceFile = null
      continue
    }
    if (arg === '--details-file') {
      detailsFile = argv[index + 1]?.trim() || null
      index += 1
    }
  }

  return { detailsFile, limit, referenceFile }
}

async function loadPublicSponsorMap() {
  const filePath = path.join(process.cwd(), 'config', 'clinicaltrials-first-run-sponsors.json')
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw) as SponsorMapConfig

  return new Map(
    (parsed.sponsors ?? [])
      .map((entry) => {
        const normalizedSponsorKey = normalizeSponsorKey(entry.normalizedSponsorKey ?? entry.sponsorName)
        if (!normalizedSponsorKey) return null
        return [
          normalizedSponsorKey,
          {
            sponsorName: entry.sponsorName ?? normalizedSponsorKey,
            sponsorTicker: entry.sponsorTicker?.trim() || null,
          },
        ] as const satisfies readonly [string, ManualSponsorMapping]
      })
      .filter((entry): entry is readonly [string, ManualSponsorMapping] => Boolean(entry)),
    )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const publicSponsorMap = await loadPublicSponsorMap()
  const referenceFile = args.referenceFile ? await loadPublicCompanyReferenceFile(path.resolve(process.cwd(), args.referenceFile)) : null
  const referenceIndexes = referenceFile ? buildReferenceIndexes(referenceFile) : null

  const sponsorRows = await db
    .select({
      sponsorName: phase2Trials.sponsorName,
      trialCount: sql<number>`count(*)::int`,
    })
    .from(phase2Trials)
    .groupBy(phase2Trials.sponsorName)
    .orderBy(desc(sql<number>`count(*)::int`), phase2Trials.sponsorName)

  const publicSponsors: Array<{
    exchange: string | null
    matchSource: 'manual' | 'reference_exact' | 'reference_canonical'
    matchedCompanyName: string
    referenceSources: string[]
    sponsorName: string
    trialCount: number
    sponsorTicker: string | null
  }> = []
  const unresolvedSponsors: Array<{
    canonicalSponsorKey: string
    sponsorName: string
    trialCount: number
  }> = []

  const allSponsors: Array<{
    canonicalSponsorKey: string
    exchange: string | null
    matchSource: 'manual' | 'reference_exact' | 'reference_canonical' | 'unresolved'
    matchedCompanyName: string | null
    normalizedSponsorKey: string
    referenceSources: string[]
    sponsorName: string
    sponsorTicker: string | null
    trialCount: number
  }> = []

  const matchedSourceCounts = {
    manual: 0,
    referenceCanonical: 0,
    referenceExact: 0,
  }

  for (const row of sponsorRows) {
    const sponsorName = row.sponsorName
    const trialCount = Number(row.trialCount)
    const match = matchSponsorToPublicCompany(sponsorName, publicSponsorMap, referenceIndexes)

    if (match.matchSource !== 'unresolved') {
      if (match.matchSource === 'manual') {
        matchedSourceCounts.manual += trialCount
      } else if (match.matchSource === 'reference_exact') {
        matchedSourceCounts.referenceExact += trialCount
      } else {
        matchedSourceCounts.referenceCanonical += trialCount
      }

      publicSponsors.push({
        exchange: 'exchange' in match ? match.exchange : null,
        matchSource: match.matchSource,
        matchedCompanyName: match.matchedCompanyName,
        referenceSources: 'referenceSources' in match ? match.referenceSources : [],
        sponsorName,
        sponsorTicker: match.sponsorTicker,
        trialCount,
      })
      allSponsors.push({
        canonicalSponsorKey: match.canonicalSponsorKey,
        exchange: 'exchange' in match ? match.exchange : null,
        matchSource: match.matchSource,
        matchedCompanyName: match.matchedCompanyName,
        normalizedSponsorKey: match.normalizedSponsorKey,
        referenceSources: 'referenceSources' in match ? match.referenceSources : [],
        sponsorName,
        sponsorTicker: match.sponsorTicker,
        trialCount,
      })
    } else {
      unresolvedSponsors.push({
        canonicalSponsorKey: match.canonicalSponsorKey,
        sponsorName,
        trialCount,
      })
      allSponsors.push({
        canonicalSponsorKey: match.canonicalSponsorKey,
        exchange: null,
        matchSource: 'unresolved',
        matchedCompanyName: null,
        normalizedSponsorKey: match.normalizedSponsorKey,
        referenceSources: [],
        sponsorName,
        sponsorTicker: null,
        trialCount,
      })
    }
  }

  const totalTrials = sponsorRows.reduce((sum, row) => sum + Number(row.trialCount), 0)
  const mappedTrials = publicSponsors.reduce((sum, row) => sum + row.trialCount, 0)

  const payloadObject = {
    totalTrials,
    totalSponsors: sponsorRows.length,
    publicMappedTrials: mappedTrials,
    publicMappedSponsors: publicSponsors.length,
    unresolvedTrials: totalTrials - mappedTrials,
    unresolvedSponsors: unresolvedSponsors.length,
    mappedCoveragePct: Number(((mappedTrials / Math.max(totalTrials, 1)) * 100).toFixed(2)),
    matchSourceTrialCounts: matchedSourceCounts,
    referenceSummary: referenceFile ? {
      generatedAt: referenceFile.generatedAt,
      issuerCount: referenceFile.issuers.length,
      sourceCounts: Object.fromEntries(referenceFile.sources.map((source) => [source.source, source.recordCount])),
    } : null,
    topPublicSponsors: publicSponsors.slice(0, args.limit),
    topUnresolvedSponsors: unresolvedSponsors.slice(0, args.limit),
  }

  if (args.detailsFile) {
    const detailsPath = path.resolve(process.cwd(), args.detailsFile)
    await mkdir(path.dirname(detailsPath), { recursive: true })
    await writeFile(detailsPath, `${JSON.stringify({
      ...payloadObject,
      allSponsors,
    }, null, 2)}\n`, 'utf8')
  }

  const payload = JSON.stringify(payloadObject, null, 2)

  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${payload}\n`, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
