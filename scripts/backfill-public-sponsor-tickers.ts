import dotenv from 'dotenv'
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
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
  apply: boolean
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
  let apply = false
  let referenceFile: string | null = DEFAULT_PUBLIC_COMPANY_REFERENCE_FILE

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--reference-file') {
      referenceFile = argv[index + 1]?.trim() || referenceFile
      index += 1
      continue
    }
    if (arg === '--no-reference-file') {
      referenceFile = null
    }
  }

  return { apply, referenceFile }
}

async function loadManualPublicSponsorMap() {
  const filePath = path.join(process.cwd(), 'config', 'clinicaltrials-first-run-sponsors.json')
  const raw = await readFile(filePath, 'utf8')
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { db, trials } = await import('../lib/db')

  const manualSponsorMap = await loadManualPublicSponsorMap()
  const referenceFile = args.referenceFile
    ? await loadPublicCompanyReferenceFile(path.resolve(process.cwd(), args.referenceFile))
    : null
  const referenceIndexes = referenceFile ? buildReferenceIndexes(referenceFile) : null

  const sponsorRows = await db
    .select({
      sponsorName: trials.sponsorName,
      trialCount: sql<number>`count(*)::int`,
    })
    .from(trials)
    .groupBy(trials.sponsorName)
    .orderBy(trials.sponsorName)

  const changes: Array<{
    matchSource: 'manual' | 'reference_canonical' | 'reference_exact'
    rowsChanged: number
    sponsorName: string
    sponsorTicker: string
    trialCount: number
  }> = []

  const unresolved: Array<{
    sponsorName: string
    trialCount: number
  }> = []

  for (const row of sponsorRows) {
    const trialCount = Number(row.trialCount)
    const match = matchSponsorToPublicCompany(row.sponsorName, manualSponsorMap, referenceIndexes)

    if (match.matchSource === 'unresolved' || !('sponsorTicker' in match) || !match.sponsorTicker) {
      unresolved.push({
        sponsorName: row.sponsorName,
        trialCount,
      })
      continue
    }

    const updatedRows = args.apply
      ? await db.update(trials)
        .set({
          sponsorTicker: match.sponsorTicker,
          updatedAt: new Date(),
        })
        .where(and(
          eq(trials.sponsorName, row.sponsorName),
          or(
            isNull(trials.sponsorTicker),
            ne(trials.sponsorTicker, match.sponsorTicker),
          ),
        ))
        .returning({ id: trials.id })
      : await db.select({ id: trials.id })
        .from(trials)
        .where(and(
          eq(trials.sponsorName, row.sponsorName),
          or(
            isNull(trials.sponsorTicker),
            ne(trials.sponsorTicker, match.sponsorTicker),
          ),
        ))

    if (updatedRows.length === 0) {
      continue
    }

    changes.push({
      matchSource: match.matchSource,
      rowsChanged: updatedRows.length,
      sponsorName: row.sponsorName,
      sponsorTicker: match.sponsorTicker,
      trialCount,
    })
  }

  const payload = {
    apply: args.apply,
    changedSponsorCount: changes.length,
    changedTrialCount: changes.reduce((sum, row) => sum + row.rowsChanged, 0),
    unresolvedSponsorCount: unresolved.length,
    unresolvedTrialCount: unresolved.reduce((sum, row) => sum + row.trialCount, 0),
    changes,
    unresolved,
  }

  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
