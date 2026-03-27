import dotenv from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import {
  buildClinicalTrialsReconcileQueryTerm,
  fetchClinicalTrialsStudies,
  fetchClinicalTrialsVersion,
  isClinicalTrialsActiveStatusStudy,
  isClinicalTrialsBaseUniverseStudy,
  isClinicalTrialsStudyOnOrAfterDate,
  isClinicalTrialsStudyInRollingWindow,
  toUtcDayStart,
} from '../lib/clinicaltrials-gov'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config()

const gzipAsync = promisify(gzip)

type ParsedArgs = {
  compressOutput: boolean
  lookbackDays: number
  outputFile: string | null
  sinceDate: string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let compressOutput = false
  let lookbackDays = 180
  let outputFile: string | null = null
  let sinceDate: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--gzip') {
      compressOutput = true
      continue
    }
    if (arg === '--lookback-days') {
      const next = Number(argv[index + 1])
      if (!Number.isFinite(next) || next < 1) {
        throw new Error('Usage: npx tsx scripts/download-clinicaltrials-gov-snapshot.ts [--lookback-days number | --since-date YYYY-MM-DD] [--output-file path] [--gzip]')
      }
      lookbackDays = Math.round(next)
      index += 1
      continue
    }
    if (arg === '--since-date') {
      const next = argv[index + 1]?.trim()
      if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
        throw new Error('Usage: npx tsx scripts/download-clinicaltrials-gov-snapshot.ts [--lookback-days number | --since-date YYYY-MM-DD] [--output-file path] [--gzip]')
      }
      sinceDate = next
      index += 1
      continue
    }
    if (arg === '--output-file') {
      const next = argv[index + 1]?.trim()
      if (!next) {
        throw new Error('Usage: npx tsx scripts/download-clinicaltrials-gov-snapshot.ts [--lookback-days number | --since-date YYYY-MM-DD] [--output-file path] [--gzip]')
      }
      outputFile = next
      index += 1
    }
  }

  return { compressOutput, lookbackDays, outputFile, sinceDate }
}

function buildDefaultOutputFile(now: Date, compressOutput: boolean): string {
  const stamp = now.toISOString().replace(/[:]/g, '-')
  const suffix = compressOutput ? '.json.gz' : '.json'
  return path.join('tmp', 'clinicaltrials-gov', `reconcile-snapshot-${stamp}${suffix}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const now = new Date()
  const cutoffDate = args.sinceDate
    ? new Date(`${args.sinceDate}T00:00:00.000Z`)
    : new Date(toUtcDayStart(now).getTime() - (args.lookbackDays * 24 * 60 * 60 * 1000))
  const outputFile = args.outputFile ?? buildDefaultOutputFile(now, args.compressOutput)
  const queryTerm = buildClinicalTrialsReconcileQueryTerm(cutoffDate)

  const [version, sourceResult] = await Promise.all([
    fetchClinicalTrialsVersion(),
    fetchClinicalTrialsStudies({ queryTerm }),
  ])

  const matchedStudyCount = sourceResult.studies.filter((study) => (
    isClinicalTrialsBaseUniverseStudy(study)
    && isClinicalTrialsActiveStatusStudy(study)
    && (
      args.sinceDate
        ? isClinicalTrialsStudyOnOrAfterDate(study, cutoffDate)
        : isClinicalTrialsStudyInRollingWindow(study, args.lookbackDays, now)
    )
  )).length

  const payload = {
    completionSinceDate: args.sinceDate,
    createdAt: now.toISOString(),
    sourceDataTimestamp: version.dataTimestamp?.trim() || null,
    mode: 'reconcile',
    lookbackDays: args.sinceDate ? null : args.lookbackDays,
    cutoffDate: cutoffDate.toISOString(),
    queryTerm,
    rawStudyCount: sourceResult.studies.length,
    totalCount: sourceResult.totalCount,
    matchedStudyCount,
    studies: sourceResult.studies,
  }

  await mkdir(path.dirname(outputFile), { recursive: true })
  const serializedPayload = JSON.stringify(payload, null, 2)
  const shouldCompressOutput = args.compressOutput || outputFile.endsWith('.gz')

  await writeFile(
    outputFile,
    shouldCompressOutput ? await gzipAsync(serializedPayload) : serializedPayload,
  )

  console.log(JSON.stringify({
    compressed: shouldCompressOutput,
    completionSinceDate: payload.completionSinceDate,
    outputFile,
    sourceDataTimestamp: payload.sourceDataTimestamp,
    rawStudyCount: payload.rawStudyCount,
    matchedStudyCount: payload.matchedStudyCount,
    cutoffDate: payload.cutoffDate,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
