import dotenv from 'dotenv'
import {
  loadClinicalTrialsSnapshotFile,
  loadSponsorMapFile,
} from './clinicaltrials-gov-bulk-utils'
import type { TrialSyncPreloadedSource } from '../lib/trial-sync'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config()

type ParsedArgs = {
  force: boolean
  maxOpenMarkets: number | null
  mode: 'auto' | 'incremental' | 'reconcile'
  inputFile: string | null
  sponsorMapFile: string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let force = false
  let maxOpenMarkets: number | null = null
  let mode: ParsedArgs['mode'] = 'auto'
  let inputFile: string | null = null
  let sponsorMapFile: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--max-open-markets') {
      const next = Number(argv[index + 1])
      if (!Number.isFinite(next) || next < 0) {
        throw new Error('Usage: npx tsx scripts/sync-clinicaltrials-gov.ts [--force] [--mode auto|incremental|reconcile] [--max-open-markets number] [--input-file path] [--sponsor-map path]')
      }
      maxOpenMarkets = Math.round(next)
      index += 1
      continue
    }
    if (arg === '--mode') {
      const next = argv[index + 1]
      if (next === 'auto' || next === 'incremental' || next === 'reconcile') {
        mode = next
        index += 1
        continue
      }
      throw new Error('Usage: npx tsx scripts/sync-clinicaltrials-gov.ts [--force] [--mode auto|incremental|reconcile] [--max-open-markets number] [--input-file path] [--sponsor-map path]')
    }
    if (arg === '--input-file') {
      const next = argv[index + 1]?.trim()
      if (!next) {
        throw new Error('Usage: npx tsx scripts/sync-clinicaltrials-gov.ts [--force] [--mode auto|incremental|reconcile] [--max-open-markets number] [--input-file path] [--sponsor-map path]')
      }
      inputFile = next
      index += 1
      continue
    }
    if (arg === '--sponsor-map') {
      const next = argv[index + 1]?.trim()
      if (!next) {
        throw new Error('Usage: npx tsx scripts/sync-clinicaltrials-gov.ts [--force] [--mode auto|incremental|reconcile] [--max-open-markets number] [--input-file path] [--sponsor-map path]')
      }
      sponsorMapFile = next
      index += 1
    }
  }

  if (sponsorMapFile && !inputFile) {
    throw new Error('--sponsor-map requires --input-file')
  }

  return { force, maxOpenMarkets, mode, inputFile, sponsorMapFile }
}

async function loadPreloadedSource(
  inputFile: string | null,
  sponsorMapFile: string | null,
): Promise<TrialSyncPreloadedSource | undefined> {
  if (!inputFile) return undefined

  const snapshot = await loadClinicalTrialsSnapshotFile(inputFile)
  const sponsorMappings = sponsorMapFile ? await loadSponsorMapFile(sponsorMapFile) : null

  return {
    completionSinceDate: typeof snapshot.completionSinceDate === 'string' ? snapshot.completionSinceDate : null,
    sourceDataTimestamp: typeof snapshot.sourceDataTimestamp === 'string' ? snapshot.sourceDataTimestamp : null,
    studies: snapshot.studies ?? [],
    sponsorMappings: sponsorMappings ? Object.fromEntries(sponsorMappings.entries()) : undefined,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const preloadedSource = await loadPreloadedSource(args.inputFile, args.sponsorMapFile)
  const { runTrialSync } = await import('../lib/trial-sync')

  const result = await runTrialSync({
    triggerSource: 'manual',
    force: args.force,
    maxMarketsToOpen: args.maxOpenMarkets ?? undefined,
    mode: args.mode,
    preloadedSource,
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
