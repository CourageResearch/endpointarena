import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const IDLE_SLEEP_MS = 60 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('[season4-model-cycle-worker] disabled: Season 4 model cycles are manual-only from the admin panel.')

  while (true) {
    await sleep(IDLE_SLEEP_MS)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
