import { eq, sql } from 'drizzle-orm'
import { db, fdaCalendarEvents, predictionMarkets } from '../lib/db'
import { assertLocalOneDrugDatabaseUrl } from './one-drug-local-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalOneDrugDatabaseUrl(connectionString)

  const [events, openMarkets, pendingEvent] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)::int` })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.status, 'OPEN')),
    db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.drugName, 'Cytisinicline'),
    }),
  ])

  const eventCount = events[0]?.count ?? 0
  const openMarketCount = openMarkets[0]?.count ?? 0

  if (eventCount !== 1) {
    throw new Error(`Expected exactly 1 FDA event, found ${eventCount}`)
  }
  if (openMarketCount !== 1) {
    throw new Error(`Expected exactly 1 open market, found ${openMarketCount}`)
  }
  if (!pendingEvent) {
    throw new Error('Expected Cytisinicline event to exist')
  }
  if (pendingEvent.outcome !== 'Pending') {
    throw new Error(`Expected Cytisinicline outcome to be Pending, found ${pendingEvent.outcome}`)
  }

  console.log('One-drug local database looks correct.')
  console.log(`- Event: ${pendingEvent.drugName} (${pendingEvent.companyName})`)
  console.log(`- Open markets: ${openMarketCount}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
