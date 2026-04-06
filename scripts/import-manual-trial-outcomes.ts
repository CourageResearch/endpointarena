import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { eq, sql } from 'drizzle-orm'
import { db, trialOutcomeCandidates } from '../lib/db'
import { importManualTrialOutcomeDecisions } from '../lib/manual-trial-outcome-import'
import { listEligibleTrialOutcomeQuestionsForManualResearch } from '../lib/trial-monitor'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  inputFile: string | null
  apply: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  let inputFile: string | null = null
  let apply = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input-file') {
      inputFile = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--apply') {
      apply = true
    }
  }

  return { inputFile, apply }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.inputFile) {
    throw new Error('Usage: npx tsx scripts/import-manual-trial-outcomes.ts --input-file /absolute/path/to/decisions.json [--apply]')
  }

  const inputFile = path.resolve(process.cwd(), args.inputFile)
  const text = await fs.readFile(inputFile, 'utf8')
  const parsed = JSON.parse(text) as unknown

  const result = await importManualTrialOutcomeDecisions({
    decisions: parsed,
    sourceFile: inputFile,
    apply: args.apply,
  })

  const [eligibleAfter, pendingReviewRow] = await Promise.all([
    listEligibleTrialOutcomeQuestionsForManualResearch(),
    db.select({
      count: sql<number>`count(*)::int`,
    }).from(trialOutcomeCandidates).where(eq(trialOutcomeCandidates.status, 'pending_review')),
  ])

  console.log(JSON.stringify({
    filePath: inputFile,
    ...result,
    eligibleQueueCountAfter: eligibleAfter.length,
    pendingReviewCountAfter: pendingReviewRow[0]?.count ?? 0,
  }, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
