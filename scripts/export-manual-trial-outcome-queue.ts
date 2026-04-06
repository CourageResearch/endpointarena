import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { getTrialMonitorConfig } from '../lib/trial-monitor-config'
import { listEligibleTrialOutcomeQuestionsForManualResearch } from '../lib/trial-monitor'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  outputFile: string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let outputFile: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output-file') {
      outputFile = argv[index + 1] ?? null
      index += 1
    }
  }

  return { outputFile }
}

function getDefaultOutputPath(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[:.]/g, '-')
  return path.resolve(process.cwd(), 'tmp', 'manual-trial-outcomes', `eligible-queue-${compact}.json`)
}

async function writeJsonFile(filePath: string, value: unknown): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return resolvedPath
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const now = new Date()
  const [config, questions] = await Promise.all([
    getTrialMonitorConfig(),
    listEligibleTrialOutcomeQuestionsForManualResearch(),
  ])

  const payload = {
    metadata: {
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      eligibleCount: questions.length,
      recommendedBatchSize: 10,
      runConfig: {
        enabled: config.enabled,
        lookaheadDays: config.lookaheadDays,
        overdueRecheckHours: config.overdueRecheckHours,
        maxQuestionsPerRun: config.maxQuestionsPerRun,
        verifierModelKey: config.verifierModelKey,
      },
    },
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      trial: {
        id: question.trial.id,
        shortTitle: question.trial.shortTitle,
        sponsorName: question.trial.sponsorName,
        sponsorTicker: question.trial.sponsorTicker,
        nctNumber: question.trial.nctNumber,
        exactPhase: question.trial.exactPhase,
        indication: question.trial.indication,
        intervention: question.trial.intervention,
        primaryEndpoint: question.trial.primaryEndpoint,
        currentStatus: question.trial.currentStatus,
        estPrimaryCompletionDate: question.trial.estPrimaryCompletionDate.toISOString(),
        briefSummary: question.trial.briefSummary,
        lastMonitoredAt: question.trial.lastMonitoredAt ? question.trial.lastMonitoredAt.toISOString() : null,
      },
    })),
  }

  const outputFile = args.outputFile ?? getDefaultOutputPath(now)
  const resolvedPath = await writeJsonFile(outputFile, payload)

  console.log(JSON.stringify({
    mode: 'export',
    filePath: resolvedPath,
    eligibleCount: questions.length,
    verifierModelKey: config.verifierModelKey,
    firstNctNumbers: questions.slice(0, 5).map((question) => question.trial.nctNumber),
  }, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
