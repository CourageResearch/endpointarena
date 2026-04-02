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
  const { db, phase2Trials } = await import('../lib/db')

  const manualSponsorMap = await loadManualPublicSponsorMap()
  const referenceFile = args.referenceFile
    ? await loadPublicCompanyReferenceFile(path.resolve(process.cwd(), args.referenceFile))
    : null
  const referenceIndexes = referenceFile ? buildReferenceIndexes(referenceFile) : null

  const sponsorRows = await db
    .select({
      sponsorName: phase2Trials.sponsorName,
      trialCount: sql<number>`count(*)::int`,
    })
    .from(phase2Trials)
    .groupBy(phase2Trials.sponsorName)
    .orderBy(phase2Trials.sponsorName)

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
      ? await db.update(phase2Trials)
        .set({
          sponsorTicker: match.sponsorTicker,
          updatedAt: new Date(),
        })
        .where(and(
          eq(phase2Trials.sponsorName, row.sponsorName),
          or(
            isNull(phase2Trials.sponsorTicker),
            ne(phase2Trials.sponsorTicker, match.sponsorTicker),
          ),
        ))
        .returning({ id: phase2Trials.id })
      : await db.select({ id: phase2Trials.id })
        .from(phase2Trials)
        .where(and(
          eq(phase2Trials.sponsorName, row.sponsorName),
          or(
            isNull(phase2Trials.sponsorTicker),
            ne(phase2Trials.sponsorTicker, match.sponsorTicker),
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
