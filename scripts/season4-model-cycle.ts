import dotenv from 'dotenv'
import { closeDbConnections } from '@/lib/db'
import { runSeason4ModelCycle } from '@/lib/season4-ops'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

async function main() {
  const summary = await runSeason4ModelCycle()
  console.log(JSON.stringify(summary, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}).finally(async () => {
  await closeDbConnections()
})
