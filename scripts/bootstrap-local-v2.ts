import { eq, sql } from 'drizzle-orm'
import { CNPV_EVENT_SEEDS } from '../lib/cnpv-data'
import { db, fdaCalendarEvents, marketRuntimeConfigs, predictionMarkets } from '../lib/db'
import {
  replaceEventNewsLinks,
  upsertEventContext,
  upsertEventExternalId,
  upsertEventPrimarySource,
} from '../lib/fda-event-metadata'
import { openMarketForEvent } from '../lib/markets/engine'
import { assertLocalV2DatabaseUrl } from './local-v2-utils'

const CYTISINICLINE_EXTERNAL_KEY = 'cnpv/cytisinicline'

function parseUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

async function assertBaseSchemaPresent() {
  const rows = await db.execute(sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'fda_calendar_events'
    ) as exists
  `)

  const exists = Boolean((rows as Array<{ exists?: boolean }>)[0]?.exists)
  if (!exists) {
    throw new Error('Base schema is missing. Run db:push-local-v2 before bootstrap.')
  }
}

async function resetFixtureData() {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      model_decision_snapshots,
      market_price_snapshots,
      market_actions,
      market_positions,
      prediction_markets,
      market_run_logs,
      market_runs,
      market_daily_snapshots,
      market_accounts,
      fda_event_analyses,
      fda_event_contexts,
      fda_event_sources,
      fda_event_external_ids,
      fda_calendar_events
    RESTART IDENTITY CASCADE
  `))
}

async function ensureRuntimeConfig() {
  await db.insert(marketRuntimeConfigs)
    .values({
      id: 'default',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: marketRuntimeConfigs.id })
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalV2DatabaseUrl(connectionString)

  await assertBaseSchemaPresent()
  await ensureRuntimeConfig()
  await resetFixtureData()
  await ensureRuntimeConfig()

  const seed = CNPV_EVENT_SEEDS.find((entry) => entry.externalKey === CYTISINICLINE_EXTERNAL_KEY)
  if (!seed) {
    throw new Error(`Seed ${CYTISINICLINE_EXTERNAL_KEY} was not found`)
  }

  const [event] = await db.insert(fdaCalendarEvents).values({
    companyName: seed.companyName,
    symbols: seed.symbols,
    drugName: seed.drugName,
    applicationType: seed.applicationType,
    pdufaDate: parseUtcDate(seed.publicActionDate || '2026-06-20'),
    dateKind: seed.publicActionDate ? 'public' : 'synthetic',
    cnpvAwardDate: seed.cnpvAwardDate ? parseUtcDate(seed.cnpvAwardDate) : null,
    eventDescription: seed.eventDescription,
    outcome: 'Pending',
    outcomeDate: null,
    drugStatus: seed.publicActionDate && seed.cnpvAwardDate
      ? `Pending under FDA CNPV (award date ${seed.cnpvAwardDate}; public action date ${seed.publicActionDate}).`
      : 'Pending under FDA CNPV.',
    therapeuticArea: seed.therapeuticArea,
    scrapedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning()

  await Promise.all([
    upsertEventExternalId(event.id, 'external_key', seed.externalKey),
    upsertEventExternalId(event.id, 'nct', seed.nctId ?? null),
    upsertEventPrimarySource(event.id, seed.source),
    replaceEventNewsLinks(event.id, seed.newsLinks ?? []),
    upsertEventContext({
      eventId: event.id,
      otherApprovals: seed.otherApprovals ?? null,
    }),
  ])

  const market = await openMarketForEvent(event.id)

  const [eventCountRows, marketCountRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)::int` })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.status, 'OPEN')),
  ])

  console.log(`Seeded ${event.drugName} (${event.companyName}) into ${event.id}.`)
  console.log(`Opened market ${market.id}.`)
  console.log(`FDA events in DB: ${eventCountRows[0]?.count ?? 0}`)
  console.log(`Open markets in DB: ${marketCountRows[0]?.count ?? 0}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
