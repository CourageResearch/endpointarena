import dotenv from 'dotenv'
import { parseIndexerIntervalSeconds, syncSeason4IndexerNow } from '@/lib/season4-ops'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const intervalSeconds = parseIndexerIntervalSeconds()
  console.log(`[season4-indexer-worker] starting with ${intervalSeconds}s interval`)

  while (true) {
    const startedAt = new Date().toISOString()
    try {
      const summary = await syncSeason4IndexerNow()
      console.log(JSON.stringify({
        worker: 'season4-indexer-worker',
        startedAt,
        completedAt: new Date().toISOString(),
        intervalSeconds,
        summary,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[season4-indexer-worker] ${startedAt} ${message}`)
    }

    await sleep(intervalSeconds * 1000)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
