import dotenv from 'dotenv'
import {
  DAILY_RUN_AUTOMATION_SOURCES,
  type DailyRunAutomationSource,
} from '../lib/markets/automation-handoff-shared'
import { exportDailyRunAutomationPacket, getDailyRunAutomationPaths } from '../lib/markets/automation-handoff'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  source: DailyRunAutomationSource
  nctNumber?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  let source: DailyRunAutomationSource = 'claude-code-subscription'
  let nctNumber: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--source') {
      const candidate = argv[index + 1] as DailyRunAutomationSource | undefined
      if (!candidate || !DAILY_RUN_AUTOMATION_SOURCES.includes(candidate)) {
        throw new Error(`--source must be one of: ${DAILY_RUN_AUTOMATION_SOURCES.join(', ')}`)
      }
      source = candidate
      index += 1
      continue
    }
    if (arg === '--nct-number') {
      const candidate = (argv[index + 1] ?? '').trim().toUpperCase()
      if (!/^NCT\d{8}$/.test(candidate)) {
        throw new Error('--nct-number must look like NCT12345678')
      }
      nctNumber = candidate
      index += 1
    }
  }

  return {
    source,
    nctNumber,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await exportDailyRunAutomationPacket({
    source: args.source,
    nctNumber: args.nctNumber,
  })

  console.log(JSON.stringify({
    source: args.source,
    nctNumber: args.nctNumber ?? null,
    filePath: result.filePath,
    taskCount: result.packet.taskCount,
    paths: getDailyRunAutomationPaths(),
  }, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
