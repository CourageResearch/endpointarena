import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import {
  DAILY_RUN_AUTOMATION_SOURCES,
  type DailyRunAutomationSource,
} from '../lib/markets/automation-handoff-shared'
import {
  getDailyRunAutomationPaths,
  previewDailyRunAutomationImport,
} from '../lib/markets/automation-handoff'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  inputFile: string | null
  source?: DailyRunAutomationSource
  apply: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  let inputFile: string | null = null
  let source: DailyRunAutomationSource | undefined
  let apply = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input-file') {
      inputFile = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--source') {
      const candidate = argv[index + 1] as DailyRunAutomationSource | undefined
      if (!candidate || !DAILY_RUN_AUTOMATION_SOURCES.includes(candidate)) {
        throw new Error(`--source must be one of: ${DAILY_RUN_AUTOMATION_SOURCES.join(', ')}`)
      }
      source = candidate
      index += 1
      continue
    }
    if (arg === '--apply') {
      apply = true
    }
  }

  return { inputFile, source, apply }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.inputFile) {
    throw new Error('Usage: npx tsx scripts/import-admin-ai-automation-decisions.ts --input-file path/to/decisions.json [--source claude-code-subscription|codex-subscription] [--apply]')
  }

  const inputFile = path.resolve(process.cwd(), args.inputFile)
  const contents = await fs.readFile(inputFile, 'utf8')
  const preview = await previewDailyRunAutomationImport({
    contents,
    source: args.source,
    filename: path.basename(inputFile),
  })

  let payload: null = null
  let archivePath: string | null = null

  if (args.apply) {
    throw new Error('Legacy Season 3 automation imports are retired in Season 4. Use the Season 4 admin AI live batch import flow instead.')
  }

  console.log(JSON.stringify({
    filePath: inputFile,
    preview: preview.preview,
    payload,
    archivePath,
    paths: getDailyRunAutomationPaths(),
  }, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
