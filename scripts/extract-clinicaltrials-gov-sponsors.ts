import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildSponsorMapTemplateCsv,
  loadClinicalTrialsSnapshotFile,
} from './clinicaltrials-gov-bulk-utils'

type ParsedArgs = {
  inputFile: string | null
  outputFile: string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let inputFile: string | null = null
  let outputFile: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input-file') {
      const next = argv[index + 1]?.trim()
      if (!next) {
        throw new Error('Usage: npx tsx scripts/extract-clinicaltrials-gov-sponsors.ts --input-file path [--output-file path]')
      }
      inputFile = next
      index += 1
      continue
    }
    if (arg === '--output-file') {
      const next = argv[index + 1]?.trim()
      if (!next) {
        throw new Error('Usage: npx tsx scripts/extract-clinicaltrials-gov-sponsors.ts --input-file path [--output-file path]')
      }
      outputFile = next
      index += 1
    }
  }

  if (!inputFile) {
    throw new Error('Usage: npx tsx scripts/extract-clinicaltrials-gov-sponsors.ts --input-file path [--output-file path]')
  }

  return { inputFile, outputFile }
}

function buildDefaultOutputFile(inputFile: string) {
  const directory = path.dirname(inputFile)
  const baseName = path.basename(inputFile).replace(/\.json(?:\.gz)?$/i, '')
  return path.join(directory, `${baseName}-sponsor-map.csv`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputFile = args.inputFile
  if (!inputFile) {
    throw new Error('Usage: npx tsx scripts/extract-clinicaltrials-gov-sponsors.ts --input-file path [--output-file path]')
  }

  const snapshot = await loadClinicalTrialsSnapshotFile(inputFile)
  const outputFile = args.outputFile ?? buildDefaultOutputFile(inputFile)
  const summary = buildSponsorMapTemplateCsv(snapshot)

  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, summary.csvText)

  console.log(JSON.stringify({
    completionSinceDate: summary.completionSinceDate,
    inputFile,
    outputFile,
    lookbackDays: summary.lookbackDays,
    matchedStudyCount: summary.matchedStudyCount,
    uniqueSponsors: summary.uniqueSponsors,
    snapshotCreatedAt: summary.snapshotCreatedAt,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
