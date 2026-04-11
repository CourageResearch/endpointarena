import { sql } from 'drizzle-orm'
import { getDbForTarget, marketRuntimeConfigs } from '../lib/db'
import { assertLocalProjectDatabaseUrl } from './local-db-utils'

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
  'trials',
  'trial_questions',
  'trial_monitor_configs',
  'trial_monitor_runs',
  'trial_outcome_candidates',
  'trial_outcome_candidate_evidence',
  'trial_question_outcome_history',
  'trial_sync_configs',
  'trial_sync_runs',
  'trial_sync_run_items',
] as const

const PROHIBITED_TABLES = [
  'fda_calendar_events',
  'fda_event_external_ids',
  'fda_event_sources',
  'fda_event_contexts',
  'fda_event_analyses',
  'event_monitor_configs',
  'event_monitor_runs',
  'event_outcome_candidates',
  'event_outcome_candidate_evidence',
] as const

const REQUIRED_COLUMNS = [
  { table: 'trials', column: 'source' },
  { table: 'prediction_markets', column: 'house_opening_probability' },
  { table: 'prediction_markets', column: 'opening_line_source' },
  { table: 'prediction_markets', column: 'opened_by_user_id' },
] as const

const PROHIBITED_COLUMNS = [
  { table: 'users', column: 'predictions' },
  { table: 'users', column: 'correct_preds' },
  { table: 'prediction_markets', column: 'fda_event_id' },
  { table: 'market_actions', column: 'fda_event_id' },
  { table: 'model_decision_snapshots', column: 'fda_event_id' },
  { table: 'market_run_logs', column: 'fda_event_id' },
] as const

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalProjectDatabaseUrl(connectionString)
  const db = getDbForTarget('main')

  const [tableRows, columnRows, runtimeConfigRows] = await Promise.all([
    db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${sql.join([...REQUIRED_TABLES, ...PROHIBITED_TABLES].map((name) => sql`${name}`), sql`, `)})
    `),
    db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (${sql.join(
          Array.from(new Set([...REQUIRED_COLUMNS, ...PROHIBITED_COLUMNS].map((entry) => entry.table))).map((name) => sql`${name}`),
          sql`, `,
        )})
        and column_name in (${sql.join(
          Array.from(new Set([...REQUIRED_COLUMNS, ...PROHIBITED_COLUMNS].map((entry) => entry.column))).map((name) => sql`${name}`),
          sql`, `,
        )})
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

  const prohibitedTablesPresent = PROHIBITED_TABLES.filter((name) => presentTables.has(name))
  if (prohibitedTablesPresent.length > 0) {
    throw new Error(`Legacy tables should be removed but are still present: ${prohibitedTablesPresent.join(', ')}`)
  }

  const presentColumns = new Set(
    (columnRows as Array<{ table_name?: string; column_name?: string }>).flatMap((row) => (
      row.table_name && row.column_name ? [`${row.table_name}.${row.column_name}`] : []
    )),
  )
  const missingColumns = REQUIRED_COLUMNS
    .filter((entry) => !presentColumns.has(`${entry.table}.${entry.column}`))
    .map((entry) => `${entry.table}.${entry.column}`)
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(', ')}`)
  }

  const prohibitedColumnsPresent = PROHIBITED_COLUMNS
    .filter((entry) => presentColumns.has(`${entry.table}.${entry.column}`))
    .map((entry) => `${entry.table}.${entry.column}`)
  if (prohibitedColumnsPresent.length > 0) {
    throw new Error(`Legacy columns should be removed but are still present: ${prohibitedColumnsPresent.join(', ')}`)
  }

  const runtimeConfigCount = runtimeConfigRows[0]?.count ?? 0
  if (runtimeConfigCount <= 0) {
    throw new Error('Expected at least one market runtime config row')
  }

  console.log('Local database contract looks correct.')
  console.log(`- Required tables present: ${REQUIRED_TABLES.length}`)
  console.log(`- Legacy tables removed: ${PROHIBITED_TABLES.length}`)
  console.log(`- Required columns present: ${REQUIRED_COLUMNS.length}`)
  console.log(`- Legacy columns removed: ${PROHIBITED_COLUMNS.length}`)
  console.log(`- Runtime config rows: ${runtimeConfigCount}`)
  console.log('- Seed fixture: optional')
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
