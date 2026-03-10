import { sql } from 'drizzle-orm'
import { db, marketRuntimeConfigs } from '../lib/db'
import { assertLocalV2DatabaseUrl } from './local-v2-utils'

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
] as const

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalV2DatabaseUrl(connectionString)

  const [tableRows, runtimeConfigRows] = await Promise.all([
    db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${sql.join(REQUIRED_TABLES.map((name) => sql`${name}`), sql`, `)})
    `),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuntimeConfigs),
  ])

  const presentTables = new Set(
    (tableRows as Array<{ table_name?: string }>).flatMap((row) => row.table_name ? [row.table_name] : []),
  )
  const missingTables = REQUIRED_TABLES.filter((name) => !presentTables.has(name))
  if (missingTables.length > 0) {
    throw new Error(`Missing required tables: ${missingTables.join(', ')}`)
  }

  const runtimeConfigCount = runtimeConfigRows[0]?.count ?? 0
  if (runtimeConfigCount <= 0) {
    throw new Error('Expected at least one market runtime config row')
  }

  console.log('Local v2 database contract looks correct.')
  console.log(`- Required tables present: ${REQUIRED_TABLES.length}`)
  console.log(`- Runtime config rows: ${runtimeConfigCount}`)
  console.log('- Seed fixture: optional')
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
