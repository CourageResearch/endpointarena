import { and, eq, sql } from 'drizzle-orm'
import { CNPV_EVENT_SEEDS } from '../lib/cnpv-data'
import { ADMIN_EMAIL, MODEL_IDS } from '../lib/constants'
import {
  db,
  fdaCalendarEvents,
  fdaEventContexts,
  fdaEventExternalIds,
  fdaEventSources,
  marketAccounts,
  marketActors,
  marketPositions,
  marketRuntimeConfigs,
  predictionMarkets,
  users,
} from '../lib/db'
import { assertLocalOneDrugDatabaseUrl } from './one-drug-local-utils'

const CYTISINICLINE_EXTERNAL_KEY = 'cnpv/cytisinicline'
const REQUIRED_TABLES = [
  'users',
  'market_actors',
  'market_accounts',
  'market_positions',
  'market_runs',
  'market_run_logs',
  'market_actions',
  'model_decision_snapshots',
  'market_price_snapshots',
  'market_daily_snapshots',
  'market_runtime_configs',
  'fda_calendar_events',
  'fda_event_external_ids',
  'fda_event_sources',
  'fda_event_contexts',
  'fda_event_analyses',
  'prediction_markets',
] as const

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalOneDrugDatabaseUrl(connectionString)

  const seed = CNPV_EVENT_SEEDS.find((entry) => entry.externalKey === CYTISINICLINE_EXTERNAL_KEY)
  if (!seed) {
    throw new Error(`Seed ${CYTISINICLINE_EXTERNAL_KEY} was not found`)
  }

  const nctIdPromise = seed.nctId
    ? db.query.fdaEventExternalIds.findFirst({
        where: and(
          eq(fdaEventExternalIds.idType, 'nct'),
          eq(fdaEventExternalIds.idValue, seed.nctId),
        ),
      })
    : Promise.resolve(null)

  const [
    tableRows,
    legacyPredictionTableRows,
    events,
    openMarkets,
    userCounts,
    modelActorCounts,
    marketAccountCounts,
    marketPositionCounts,
    runtimeConfigCounts,
    pendingEvent,
    adminUser,
    externalKey,
    nctId,
    primarySource,
    context,
    newsLinkCounts,
  ] = await Promise.all([
    db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${sql.join(REQUIRED_TABLES.map((name) => sql`${name}`), sql`, `)})
    `),
    db.execute(sql`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'fda_predictions'
      ) as exists
    `),
    db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)::int` })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.status, 'OPEN')),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db.select({ count: sql<number>`count(*)::int` })
      .from(marketActors)
      .where(eq(marketActors.actorType, 'model')),
    db.select({ count: sql<number>`count(*)::int` }).from(marketAccounts),
    db.select({ count: sql<number>`count(*)::int` }).from(marketPositions),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuntimeConfigs),
    db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.drugName, seed.drugName),
    }),
    db.query.users.findFirst({
      where: eq(users.email, ADMIN_EMAIL),
    }),
    db.query.fdaEventExternalIds.findFirst({
      where: and(
        eq(fdaEventExternalIds.idType, 'external_key'),
        eq(fdaEventExternalIds.idValue, seed.externalKey),
      ),
    }),
    nctIdPromise,
    db.query.fdaEventSources.findFirst({
      where: and(
        eq(fdaEventSources.sourceType, 'primary'),
        eq(fdaEventSources.url, seed.source),
      ),
    }),
    db.query.fdaEventContexts.findFirst(),
    db.select({ count: sql<number>`count(*)::int` })
      .from(fdaEventSources)
      .where(eq(fdaEventSources.sourceType, 'news_link')),
  ])

  const presentTables = new Set(
    (tableRows as Array<{ table_name?: string }>).flatMap((row) => row.table_name ? [row.table_name] : []),
  )
  const missingTables = REQUIRED_TABLES.filter((name) => !presentTables.has(name))
  const hasLegacyPredictionsTable = Boolean((legacyPredictionTableRows as Array<{ exists?: boolean }>)[0]?.exists)
  const eventCount = events[0]?.count ?? 0
  const openMarketCount = openMarkets[0]?.count ?? 0
  const userCount = userCounts[0]?.count ?? 0
  const modelActorCount = modelActorCounts[0]?.count ?? 0
  const marketAccountCount = marketAccountCounts[0]?.count ?? 0
  const marketPositionCount = marketPositionCounts[0]?.count ?? 0
  const runtimeConfigCount = runtimeConfigCounts[0]?.count ?? 0
  const expectedModelCount = MODEL_IDS.length
  const expectedNewsLinkCount = seed.newsLinks?.length ?? 0

  if (missingTables.length > 0) {
    throw new Error(`Missing required current-schema tables: ${missingTables.join(', ')}`)
  }
  if (hasLegacyPredictionsTable) {
    throw new Error('Legacy table fda_predictions still exists; one-drug DB was not rebuilt from scratch')
  }
  if (eventCount !== 1) {
    throw new Error(`Expected exactly 1 FDA event, found ${eventCount}`)
  }
  if (openMarketCount !== 1) {
    throw new Error(`Expected exactly 1 open market, found ${openMarketCount}`)
  }
  if (userCount !== 1) {
    throw new Error(`Expected exactly 1 user, found ${userCount}`)
  }
  if (runtimeConfigCount <= 0) {
    throw new Error('Expected at least 1 runtime config row')
  }
  if (!pendingEvent) {
    throw new Error(`Expected ${seed.drugName} event to exist`)
  }
  if (pendingEvent.outcome !== 'Pending') {
    throw new Error(`Expected ${seed.drugName} outcome to be Pending, found ${pendingEvent.outcome}`)
  }
  if (!adminUser) {
    throw new Error(`Expected admin user ${ADMIN_EMAIL} to exist`)
  }
  if (!adminUser.passwordHash) {
    throw new Error(`Expected admin user ${ADMIN_EMAIL} to have a password hash`)
  }
  if (!externalKey) {
    throw new Error(`Expected external_key metadata row for ${seed.drugName}`)
  }
  if (seed.nctId && !nctId) {
    throw new Error(`Expected NCT metadata row for ${seed.drugName}`)
  }
  if (!primarySource) {
    throw new Error(`Expected primary source metadata row for ${seed.drugName}`)
  }
  if (seed.otherApprovals && context?.otherApprovals !== seed.otherApprovals) {
    throw new Error(`Expected ${seed.drugName} event context row with matching otherApprovals`)
  }
  if ((newsLinkCounts[0]?.count ?? 0) !== expectedNewsLinkCount) {
    throw new Error(`Expected ${expectedNewsLinkCount} news links, found ${newsLinkCounts[0]?.count ?? 0}`)
  }
  if (modelActorCount !== expectedModelCount) {
    throw new Error(`Expected ${expectedModelCount} model actors, found ${modelActorCount}`)
  }
  if (marketAccountCount !== expectedModelCount) {
    throw new Error(`Expected ${expectedModelCount} market accounts, found ${marketAccountCount}`)
  }
  if (marketPositionCount !== expectedModelCount) {
    throw new Error(`Expected ${expectedModelCount} market positions, found ${marketPositionCount}`)
  }

  console.log('One-drug local database looks correct.')
  console.log(`- Event: ${pendingEvent.drugName} (${pendingEvent.companyName})`)
  console.log(`- Open markets: ${openMarketCount}`)
  console.log(`- Admin user: ${adminUser.email}`)
  console.log(`- Model actors/accounts/positions: ${modelActorCount}/${marketAccountCount}/${marketPositionCount}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
