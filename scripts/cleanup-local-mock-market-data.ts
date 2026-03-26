import { inArray } from 'drizzle-orm'
import { db, marketActions, modelDecisionSnapshots } from '../lib/db'
import { isMockMarketActionLike, isMockMarketSnapshotLike } from '../lib/mock-market-data'
import { assertLocalProjectDatabaseUrl } from './local-db-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  assertLocalProjectDatabaseUrl(connectionString)

  const [allActions, allSnapshots] = await Promise.all([
    db.query.marketActions.findMany(),
    db.query.modelDecisionSnapshots.findMany(),
  ])

  const mockActionIds = allActions
    .filter((action) => isMockMarketActionLike(action))
    .map((action) => action.id)

  const mockSnapshotIds = allSnapshots
    .filter((snapshot) => isMockMarketSnapshotLike(snapshot))
    .map((snapshot) => snapshot.id)

  if (mockSnapshotIds.length > 0) {
    await db.delete(modelDecisionSnapshots).where(inArray(modelDecisionSnapshots.id, mockSnapshotIds))
  }

  if (mockActionIds.length > 0) {
    await db.delete(marketActions).where(inArray(marketActions.id, mockActionIds))
  }

  console.log(JSON.stringify({
    deletedMarketActions: mockActionIds.length,
    deletedModelDecisionSnapshots: mockSnapshotIds.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
