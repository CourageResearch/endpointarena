import { eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { CNPV_EVENT_SEEDS } from '../lib/cnpv-data'
import { ADMIN_EMAIL, STARTER_POINTS } from '../lib/constants'
import { db, fdaCalendarEvents, marketRuntimeConfigs, predictionMarkets, users } from '../lib/db'
import {
  replaceEventNewsLinks,
  upsertEventContext,
  upsertEventExternalId,
  upsertEventPrimarySource,
} from '../lib/fda-event-metadata'
import { openMarketForEvent } from '../lib/markets/engine'
import { scryptSync } from 'crypto'
import { LOCAL_V2_DATABASE_NAME } from './local-v2-utils'
import {
  assertLocalOneDrugDatabaseUrl,
  assertLocalSourceDatabaseUrl,
  getDatabaseName,
} from './one-drug-local-utils'

const CYTISINICLINE_EXTERNAL_KEY = 'cnpv/cytisinicline'
const CYTISINICLINE_DRUG_NAME = 'Cytisinicline'
const LOCAL_ADMIN_DISPLAY_NAME = 'mfischer1000'
const DEFAULT_LOCAL_ADMIN_PASSWORD_HASH = 'scrypt$9ef97ecfee9b2a5d39f70875ed30e179$0246c87c6c35661f2eea0813c69a8230c4124e63bd155c1913128850e35dfa124ae4b92de5c72e1b77fe5cd4128d180a4dc95b27601d45ed999275679be44cd9'
const REQUIRED_BASE_TABLES = [
  'users',
  'market_runtime_configs',
  'fda_calendar_events',
  'fda_event_external_ids',
  'fda_event_sources',
  'fda_event_contexts',
  'fda_event_analyses',
  'market_actors',
  'prediction_markets',
] as const

type SourceSqlClient = ReturnType<typeof postgres>

type SourceEventRow = {
  id: string
  company_name: string
  symbols: string
  drug_name: string
  application_type: string
  decision_date: unknown
  event_description: string
  outcome: string
  outcome_date: unknown
  decision_date_kind: string | null
  cnpv_award_date: unknown
  drug_status: string | null
  therapeutic_area: string | null
  created_at: unknown
  updated_at: unknown
  scraped_at: unknown
}

type SourceUserRow = {
  id: string
  name: string | null
  email: string | null
  signup_location: string | null
  signup_state: string | null
  email_verified: unknown
  image: string | null
  created_at: unknown
  predictions: number | null
  correct_preds: number | null
  x_user_id: string | null
  x_username: string | null
  x_connected_at: unknown
  tweet_challenge_token_hash: string | null
  tweet_challenge_expires_at: unknown
  tweet_verified_at: unknown
  tweet_verified_tweet_id: string | null
  tweet_must_stay_until: unknown
  points_balance: number | null
  last_points_refill_at: unknown
}

type SourceRuntimeConfigRow = {
  id: string
  warmup_run_count: number | null
  warmup_max_trade_usd: number | null
  warmup_buy_cash_fraction: number | null
  steady_max_trade_usd: number | null
  steady_buy_cash_fraction: number | null
  max_position_per_side_shares: number | null
  opening_lmsr_b: number | null
  signup_user_limit: number | null
  created_at: unknown
  updated_at: unknown
}

function normalizeNonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTimestamp(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) {
      return parsed
    }
  }
  return fallback
}

function normalizeUtcDate(value: unknown, fallback = new Date()): Date {
  const base = normalizeTimestamp(value, fallback)
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function hashPassword(password: string): string {
  const saltHex = '9ef97ecfee9b2a5d39f70875ed30e179'
  const salt = Buffer.from(saltHex, 'hex')
  const derived = scryptSync(password, salt, 64)
  return `scrypt$${saltHex}$${derived.toString('hex')}`
}

function resolveLocalAdminPasswordHash(): string {
  const configuredPassword = process.env.LOCAL_ADMIN_PASSWORD?.trim()
  if (!configuredPassword) {
    return DEFAULT_LOCAL_ADMIN_PASSWORD_HASH
  }
  if (configuredPassword.length < 8) {
    throw new Error('LOCAL_ADMIN_PASSWORD must be at least 8 characters long.')
  }
  return hashPassword(configuredPassword)
}

function resolveSourceDatabaseUrl(targetUrl: URL): string {
  const configured = process.env.SOURCE_DATABASE_URL?.trim()
  if (configured) {
    const sourceUrl = assertLocalSourceDatabaseUrl(configured)
    if (sourceUrl.toString() === targetUrl.toString()) {
      throw new Error('SOURCE_DATABASE_URL must not point to the target one-drug database.')
    }
    return sourceUrl.toString()
  }

  const sourceUrl = new URL(targetUrl.toString())
  sourceUrl.pathname = `/${LOCAL_V2_DATABASE_NAME}`
  return sourceUrl.toString()
}

async function assertBaseSchemaPresent() {
  const rows = await db.execute(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${sql.join(REQUIRED_BASE_TABLES.map((name) => sql`${name}`), sql`, `)})
  `)

  const presentTables = new Set(
    (rows as Array<{ table_name?: string }>).flatMap((row) => row.table_name ? [row.table_name] : []),
  )
  const missingTables = REQUIRED_BASE_TABLES.filter((tableName) => !presentTables.has(tableName))

  if (missingTables.length > 0) {
    throw new Error(`Base schema is missing tables (${missingTables.join(', ')}). Run db:push-one-drug-local before bootstrap.`)
  }
}

async function resetFixtureData() {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      analytics_events,
      contact_messages,
      crash_events,
      model_decision_snapshots,
      market_price_snapshots,
      market_actions,
      market_positions,
      prediction_markets,
      market_run_logs,
      market_runs,
      market_daily_snapshots,
      market_accounts,
      market_actors,
      market_runtime_configs,
      verification_tokens,
      sessions,
      accounts,
      users,
      fda_event_analyses,
      fda_event_contexts,
      fda_event_sources,
      fda_event_external_ids,
      fda_calendar_events,
      waitlist_entries
    RESTART IDENTITY CASCADE
  `))
}

async function loadSourceEvent(sourceSql: SourceSqlClient): Promise<SourceEventRow> {
  const byExternalKey = await sourceSql<SourceEventRow[]>`
    select e.*
    from fda_calendar_events e
    inner join fda_event_external_ids external_key
      on external_key.event_id = e.id
     and external_key.id_type = 'external_key'
     and external_key.id_value = ${CYTISINICLINE_EXTERNAL_KEY}
    order by e.decision_date asc, e.id asc
  `

  if (byExternalKey.length > 1) {
    throw new Error(`Expected exactly 1 source event for ${CYTISINICLINE_EXTERNAL_KEY}, found ${byExternalKey.length}`)
  }
  if (byExternalKey[0]) {
    return byExternalKey[0]
  }

  const byDrugName = await sourceSql<SourceEventRow[]>`
    select e.*
    from fda_calendar_events e
    where lower(e.drug_name) = lower(${CYTISINICLINE_DRUG_NAME})
    order by e.decision_date asc, e.id asc
  `

  if (byDrugName.length !== 1) {
    throw new Error(`Expected exactly 1 source event for ${CYTISINICLINE_DRUG_NAME}, found ${byDrugName.length}`)
  }

  return byDrugName[0]
}

async function loadSourceAdminUser(sourceSql: SourceSqlClient): Promise<SourceUserRow> {
  const rows = await sourceSql<SourceUserRow[]>`
    select
      id,
      name,
      email,
      signup_location,
      signup_state,
      email_verified,
      image,
      created_at,
      predictions,
      correct_preds,
      x_user_id,
      x_username,
      x_connected_at,
      tweet_challenge_token_hash,
      tweet_challenge_expires_at,
      tweet_verified_at,
      tweet_verified_tweet_id,
      tweet_must_stay_until,
      points_balance,
      last_points_refill_at
    from users
    where lower(email) = lower(${ADMIN_EMAIL})
    order by created_at asc, id asc
  `

  if (rows.length !== 1) {
    throw new Error(`Expected exactly 1 source admin user for ${ADMIN_EMAIL}, found ${rows.length}`)
  }

  return rows[0]
}

async function loadSourceRuntimeConfigs(sourceSql: SourceSqlClient): Promise<SourceRuntimeConfigRow[]> {
  return await sourceSql<SourceRuntimeConfigRow[]>`
    select *
    from market_runtime_configs
    order by id asc
  `
}

async function syncRuntimeConfigs(sourceRows: SourceRuntimeConfigRow[]) {
  if (sourceRows.length === 0) {
    await db.insert(marketRuntimeConfigs)
      .values({
        id: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: marketRuntimeConfigs.id })
    return
  }

  for (const row of sourceRows) {
    const values = {
      id: row.id,
      warmupRunCount: normalizeNumber(row.warmup_run_count, 3),
      warmupMaxTradeUsd: normalizeNumber(row.warmup_max_trade_usd, 1000),
      warmupBuyCashFraction: normalizeNumber(row.warmup_buy_cash_fraction, 0.02),
      steadyMaxTradeUsd: normalizeNumber(row.steady_max_trade_usd, 1000),
      steadyBuyCashFraction: normalizeNumber(row.steady_buy_cash_fraction, 0.02),
      maxPositionPerSideShares: normalizeNumber(row.max_position_per_side_shares, 10000),
      openingLmsrB: normalizeNumber(row.opening_lmsr_b, 100000),
      signupUserLimit: normalizeNumber(row.signup_user_limit, 56),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }

    await db.insert(marketRuntimeConfigs)
      .values(values)
      .onConflictDoUpdate({
        target: marketRuntimeConfigs.id,
        set: {
          warmupRunCount: values.warmupRunCount,
          warmupMaxTradeUsd: values.warmupMaxTradeUsd,
          warmupBuyCashFraction: values.warmupBuyCashFraction,
          steadyMaxTradeUsd: values.steadyMaxTradeUsd,
          steadyBuyCashFraction: values.steadyBuyCashFraction,
          maxPositionPerSideShares: values.maxPositionPerSideShares,
          openingLmsrB: values.openingLmsrB,
          signupUserLimit: values.signupUserLimit,
          updatedAt: values.updatedAt,
        },
      })
  }
}

async function seedAdminUser(sourceUser: SourceUserRow) {
  const now = new Date()
  const passwordHash = resolveLocalAdminPasswordHash()
  const email = normalizeNonEmpty(sourceUser.email) ?? ADMIN_EMAIL
  const name = normalizeNonEmpty(sourceUser.name) ?? LOCAL_ADMIN_DISPLAY_NAME

  await db.insert(users)
    .values({
      id: sourceUser.id,
      name,
      email,
      signupLocation: normalizeNonEmpty(sourceUser.signup_location),
      signupState: normalizeNonEmpty(sourceUser.signup_state),
      passwordHash,
      emailVerified: sourceUser.email_verified ? normalizeTimestamp(sourceUser.email_verified, now) : now,
      image: normalizeNonEmpty(sourceUser.image),
      createdAt: normalizeTimestamp(sourceUser.created_at, now),
      predictions: normalizeNumber(sourceUser.predictions, 0),
      correctPreds: normalizeNumber(sourceUser.correct_preds, 0),
      xUserId: normalizeNonEmpty(sourceUser.x_user_id),
      xUsername: normalizeNonEmpty(sourceUser.x_username),
      xConnectedAt: sourceUser.x_connected_at ? normalizeTimestamp(sourceUser.x_connected_at, now) : null,
      tweetChallengeTokenHash: normalizeNonEmpty(sourceUser.tweet_challenge_token_hash),
      tweetChallengeExpiresAt: sourceUser.tweet_challenge_expires_at ? normalizeTimestamp(sourceUser.tweet_challenge_expires_at, now) : null,
      tweetVerifiedAt: sourceUser.tweet_verified_at ? normalizeTimestamp(sourceUser.tweet_verified_at, now) : null,
      tweetVerifiedTweetId: normalizeNonEmpty(sourceUser.tweet_verified_tweet_id),
      tweetMustStayUntil: sourceUser.tweet_must_stay_until ? normalizeTimestamp(sourceUser.tweet_must_stay_until, now) : null,
      pointsBalance: normalizeNumber(sourceUser.points_balance, STARTER_POINTS),
      lastPointsRefillAt: sourceUser.last_points_refill_at ? normalizeTimestamp(sourceUser.last_points_refill_at, now) : null,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name,
        signupLocation: normalizeNonEmpty(sourceUser.signup_location),
        signupState: normalizeNonEmpty(sourceUser.signup_state),
        passwordHash,
        emailVerified: sourceUser.email_verified ? normalizeTimestamp(sourceUser.email_verified, now) : now,
        image: normalizeNonEmpty(sourceUser.image),
        predictions: normalizeNumber(sourceUser.predictions, 0),
        correctPreds: normalizeNumber(sourceUser.correct_preds, 0),
        xUserId: normalizeNonEmpty(sourceUser.x_user_id),
        xUsername: normalizeNonEmpty(sourceUser.x_username),
        xConnectedAt: sourceUser.x_connected_at ? normalizeTimestamp(sourceUser.x_connected_at, now) : null,
        tweetChallengeTokenHash: normalizeNonEmpty(sourceUser.tweet_challenge_token_hash),
        tweetChallengeExpiresAt: sourceUser.tweet_challenge_expires_at ? normalizeTimestamp(sourceUser.tweet_challenge_expires_at, now) : null,
        tweetVerifiedAt: sourceUser.tweet_verified_at ? normalizeTimestamp(sourceUser.tweet_verified_at, now) : null,
        tweetVerifiedTweetId: normalizeNonEmpty(sourceUser.tweet_verified_tweet_id),
        tweetMustStayUntil: sourceUser.tweet_must_stay_until ? normalizeTimestamp(sourceUser.tweet_must_stay_until, now) : null,
        pointsBalance: normalizeNumber(sourceUser.points_balance, STARTER_POINTS),
        lastPointsRefillAt: sourceUser.last_points_refill_at ? normalizeTimestamp(sourceUser.last_points_refill_at, now) : null,
      },
    })
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const targetUrl = assertLocalOneDrugDatabaseUrl(connectionString)
  const sourceConnectionString = resolveSourceDatabaseUrl(targetUrl)
  const sourceUrl = assertLocalSourceDatabaseUrl(sourceConnectionString)
  const sourceDatabaseName = getDatabaseName(sourceUrl)
  const sourceSql = postgres(sourceConnectionString, { prepare: false, max: 1 })

  try {
    const seed = CNPV_EVENT_SEEDS.find((entry) => entry.externalKey === CYTISINICLINE_EXTERNAL_KEY)
    if (!seed) {
      throw new Error(`Seed ${CYTISINICLINE_EXTERNAL_KEY} was not found`)
    }

    const [sourceEvent, sourceAdminUser, sourceRuntimeConfigs] = await Promise.all([
      loadSourceEvent(sourceSql),
      loadSourceAdminUser(sourceSql),
      loadSourceRuntimeConfigs(sourceSql),
    ])

    if (sourceEvent.outcome !== 'Pending') {
      throw new Error(`Refusing to bootstrap from non-pending Cytisinicline event. Source outcome: ${sourceEvent.outcome}`)
    }

    await assertBaseSchemaPresent()
    await resetFixtureData()
    await syncRuntimeConfigs(sourceRuntimeConfigs)

    const [event] = await db.insert(fdaCalendarEvents)
      .values({
        id: sourceEvent.id,
        companyName: sourceEvent.company_name,
        symbols: sourceEvent.symbols,
        drugName: sourceEvent.drug_name,
        applicationType: sourceEvent.application_type,
        decisionDate: normalizeUtcDate(sourceEvent.decision_date),
        eventDescription: sourceEvent.event_description,
        outcome: 'Pending',
        outcomeDate: sourceEvent.outcome_date ? normalizeTimestamp(sourceEvent.outcome_date) : null,
        decisionDateKind: sourceEvent.decision_date_kind === 'soft' ? 'soft' : 'hard',
        cnpvAwardDate: sourceEvent.cnpv_award_date ? normalizeUtcDate(sourceEvent.cnpv_award_date) : null,
        drugStatus: normalizeNonEmpty(sourceEvent.drug_status),
        therapeuticArea: normalizeNonEmpty(sourceEvent.therapeutic_area),
        createdAt: normalizeTimestamp(sourceEvent.created_at),
        updatedAt: normalizeTimestamp(sourceEvent.updated_at),
        scrapedAt: normalizeTimestamp(sourceEvent.scraped_at),
      })
      .returning()

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

    await seedAdminUser(sourceAdminUser)
    const market = await openMarketForEvent(event.id)

    const [eventCountRows, marketCountRows, userCountRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
      db.select({ count: sql<number>`count(*)::int` })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.status, 'OPEN')),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
    ])

    console.log(`Copied ${event.drugName} (${event.companyName}) from ${sourceDatabaseName}.`)
    console.log(`Opened market ${market.id}.`)
    console.log(`Seeded admin user ${ADMIN_EMAIL}.`)
    console.log(`FDA events in DB: ${eventCountRows[0]?.count ?? 0}`)
    console.log(`Open markets in DB: ${marketCountRows[0]?.count ?? 0}`)
    console.log(`Users in DB: ${userCountRows[0]?.count ?? 0}`)
    process.exit(0)
  } finally {
    await sourceSql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
