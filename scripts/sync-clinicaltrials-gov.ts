import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config()

type ParsedArgs = {
  force: boolean
  mode: 'auto' | 'incremental' | 'reconcile'
}

function parseArgs(argv: string[]): ParsedArgs {
  let force = false
  let mode: ParsedArgs['mode'] = 'auto'

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--mode') {
      const next = argv[index + 1]
      if (next === 'auto' || next === 'incremental' || next === 'reconcile') {
        mode = next
        index += 1
        continue
      }
      throw new Error('Usage: npx tsx scripts/sync-clinicaltrials-gov.ts [--force] [--mode auto|incremental|reconcile]')
    }
  }

  return { force, mode }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { runTrialSync } = await import('../lib/trial-sync')

  const result = await runTrialSync({
    triggerSource: 'manual',
    force: args.force,
    mode: args.mode,
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
