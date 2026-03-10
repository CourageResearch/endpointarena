import { eq, sql } from 'drizzle-orm'
import { MODEL_IDS } from '../lib/constants'
import { db, fdaCalendarEvents, marketActions, marketPriceSnapshots, marketRuns, modelDecisionSnapshots, predictionMarkets } from '../lib/db'
import { assertLocalOneDrugDatabaseUrl } from './one-drug-local-utils'

const EXPECTED_MARKET_COUNT = 1
const EXPECTED_SNAPSHOTS_PER_MARKET = 5
const EXPECTED_DECISION_SNAPSHOTS = MODEL_IDS.length * EXPECTED_SNAPSHOTS_PER_MARKET
const EXPECTED_ACTIONS = MODEL_IDS.length * EXPECTED_SNAPSHOTS_PER_MARKET
const EXPECTED_RUNS = EXPECTED_SNAPSHOTS_PER_MARKET

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalOneDrugDatabaseUrl(connectionString)

  const [events, openMarkets, snapshots, decisionSnapshots, actions, runs, cytisinicline] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)::int` })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.status, 'OPEN')),
    db.select({ count: sql<number>`count(*)::int` }).from(marketPriceSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(modelDecisionSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(marketActions),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuns),
    db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.drugName, 'Cytisinicline'),
    }),
  ])

  const eventCount = events[0]?.count ?? 0
  const openMarketCount = openMarkets[0]?.count ?? 0
  const snapshotCount = snapshots[0]?.count ?? 0
  const decisionSnapshotCount = decisionSnapshots[0]?.count ?? 0
  const actionCount = actions[0]?.count ?? 0
  const runCount = runs[0]?.count ?? 0

  if (eventCount !== EXPECTED_MARKET_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_MARKET_COUNT} FDA events, found ${eventCount}`)
  }
  if (openMarketCount !== EXPECTED_MARKET_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_MARKET_COUNT} open markets, found ${openMarketCount}`)
  }
  if (snapshotCount !== EXPECTED_MARKET_COUNT * EXPECTED_SNAPSHOTS_PER_MARKET) {
    throw new Error(`Expected ${EXPECTED_MARKET_COUNT * EXPECTED_SNAPSHOTS_PER_MARKET} price snapshots, found ${snapshotCount}`)
  }
  if (decisionSnapshotCount !== EXPECTED_DECISION_SNAPSHOTS) {
    throw new Error(`Expected ${EXPECTED_DECISION_SNAPSHOTS} decision snapshots, found ${decisionSnapshotCount}`)
  }
  if (actionCount !== EXPECTED_ACTIONS) {
    throw new Error(`Expected ${EXPECTED_ACTIONS} market actions, found ${actionCount}`)
  }
  if (runCount !== EXPECTED_RUNS) {
    throw new Error(`Expected ${EXPECTED_RUNS} market runs, found ${runCount}`)
  }
  if (!cytisinicline) {
    throw new Error('Expected Cytisinicline event to exist')
  }
  if (cytisinicline.outcome !== 'Pending') {
    throw new Error(`Expected Cytisinicline outcome to be Pending, found ${cytisinicline.outcome}`)
  }

  console.log('Five-day backtest local database looks correct.')
  console.log(`- FDA events: ${eventCount}`)
  console.log(`- Open markets: ${openMarketCount}`)
  console.log(`- Price snapshots: ${snapshotCount}`)
  console.log(`- Decision snapshots: ${decisionSnapshotCount}`)
  console.log(`- Market actions: ${actionCount}`)
  console.log(`- Market runs: ${runCount}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
