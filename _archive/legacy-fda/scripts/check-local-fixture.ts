import { and, eq, sql } from 'drizzle-orm'
import {
  db,
  fdaCalendarEvents,
  fdaEventContexts,
  fdaEventExternalIds,
  fdaEventSources,
  marketActors,
  predictionMarkets,
} from '../lib/db'
import { assertLocalProjectDatabaseUrl } from './local-db-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalProjectDatabaseUrl(connectionString)

  const [events, openMarkets, pendingEvent, externalKey, nctId, primarySource, context, modelActorsCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)::int` })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.status, 'OPEN')),
    db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.drugName, 'Cytisinicline'),
    }),
    db.query.fdaEventExternalIds.findFirst({
      where: and(
        eq(fdaEventExternalIds.idType, 'external_key'),
        eq(fdaEventExternalIds.idValue, 'cnpv/cytisinicline'),
      ),
    }),
    db.query.fdaEventExternalIds.findFirst({
      where: and(
        eq(fdaEventExternalIds.idType, 'nct'),
        eq(fdaEventExternalIds.idValue, 'NCT06154382'),
      ),
    }),
    db.query.fdaEventSources.findFirst({
      where: and(
        eq(fdaEventSources.sourceType, 'primary'),
        eq(fdaEventSources.url, 'https://ir.achievelifesciences.com/news-events/press-releases/detail/238/achieve-life-sciences-announces-fda-acceptance-of-cytisinicline-new-drug-application-for-treatment-of-nicotine-dependence-for-smoking-cessation'),
      ),
    }),
    db.query.fdaEventContexts.findFirst(),
    db.select({ count: sql<number>`count(*)::int` })
      .from(marketActors)
      .where(eq(marketActors.actorType, 'model')),
  ])

  const eventCount = events[0]?.count ?? 0
  const openMarketCount = openMarkets[0]?.count ?? 0
  const modelActorCount = modelActorsCount[0]?.count ?? 0

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
  if (!externalKey) {
    throw new Error('Expected external_key metadata row for Cytisinicline')
  }
  if (!nctId) {
    throw new Error('Expected NCT metadata row for Cytisinicline')
  }
  if (!primarySource) {
    throw new Error('Expected primary source metadata row for Cytisinicline')
  }
  if (!context?.otherApprovals) {
    throw new Error('Expected event context row with otherApprovals')
  }
  if (modelActorCount <= 0) {
    throw new Error('Expected seeded model market actors to exist')
  }

  console.log('Local seeded fixture looks correct.')
  console.log(`- Event: ${pendingEvent.drugName} (${pendingEvent.companyName})`)
  console.log(`- Open markets: ${openMarketCount}`)
  console.log(`- Model actors: ${modelActorCount}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
