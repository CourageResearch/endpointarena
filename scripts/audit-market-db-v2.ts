import { config } from 'dotenv'
import postgres from 'postgres'

config({ path: '.env.local', quiet: true })

const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString) {
  console.error('DATABASE_URL is not set. Add it to .env.local before running this audit.')
  process.exit(1)
}

type Severity = 'error' | 'warn'

type Check = {
  id: string
  severity: Severity
  sql: string
}

const CHECKS: Check[] = [
  {
    id: 'orphan_accounts_actor',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_accounts a
      left join market_actors ma on ma.id = a.actor_id
      where ma.id is null
    `,
  },
  {
    id: 'orphan_positions_market',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_positions p
      left join prediction_markets m on m.id = p.market_id
      where m.id is null
    `,
  },
  {
    id: 'orphan_positions_actor',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_positions p
      left join market_actors a on a.id = p.actor_id
      where a.id is null
    `,
  },
  {
    id: 'orphan_actions_market',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions a
      left join prediction_markets m on m.id = a.market_id
      where m.id is null
    `,
  },
  {
    id: 'orphan_actions_event',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions a
      left join fda_calendar_events e on e.id = a.fda_event_id
      where e.id is null
    `,
  },
  {
    id: 'orphan_actions_actor',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions a
      left join market_actors ma on ma.id = a.actor_id
      where ma.id is null
    `,
  },
  {
    id: 'duplicate_cycle_actions',
    severity: 'error',
    sql: `
      with dupes as (
        select market_id, actor_id, run_date, count(*) c
        from market_actions
        where action_source = 'cycle'
        group by market_id, actor_id, run_date
        having count(*) > 1
      )
      select count(*)::int as value from dupes
    `,
  },
  {
    id: 'human_actions_with_run_id',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where action_source = 'human'
        and run_id is not null
    `,
  },
  {
    id: 'cycle_actions_missing_run_id',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where action_source = 'cycle'
        and run_id is null
    `,
  },
  {
    id: 'snapshot_links_non_cycle_action',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots s
      join market_actions a on a.id = s.linked_market_action_id
      where a.action_source <> 'cycle'
    `,
  },
  {
    id: 'cycle_snapshots_missing_run_id',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots
      where run_source = 'cycle'
        and run_id is null
    `,
  },
  {
    id: 'manual_snapshots_with_run_id',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots
      where run_source = 'manual'
        and run_id is not null
    `,
  },
  {
    id: 'null_snapshot_run_dates',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots
      where run_date is null
    `,
  },
  {
    id: 'orphan_snapshots_actor',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots s
      left join market_actors a on a.id = s.actor_id
      where a.id is null
    `,
  },
  {
    id: 'orphan_daily_snapshots_actor',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_daily_snapshots s
      left join market_actors a on a.id = s.actor_id
      where a.id is null
    `,
  },
  {
    id: 'open_market_missing_positions',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets m
      join market_accounts a on true
      left join market_positions p
        on p.market_id = m.id
       and p.actor_id = a.actor_id
      where m.status = 'OPEN'
        and p.id is null
    `,
  },
  {
    id: 'duplicate_daily_snapshots',
    severity: 'error',
    sql: `
      with dupes as (
        select actor_id, snapshot_date, count(*) c
        from market_daily_snapshots
        group by actor_id, snapshot_date
        having count(*) > 1
      )
      select count(*)::int as value from dupes
    `,
  },
  {
    id: 'duplicate_actor_model_keys',
    severity: 'error',
    sql: `
      with dupes as (
        select model_key, count(*) c
        from market_actors
        where actor_type = 'model'
          and model_key is not null
        group by model_key
        having count(*) > 1
      )
      select count(*)::int as value from dupes
    `,
  },
  {
    id: 'duplicate_actor_user_ids',
    severity: 'error',
    sql: `
      with dupes as (
        select user_id, count(*) c
        from market_actors
        where actor_type = 'human'
          and user_id is not null
        group by user_id
        having count(*) > 1
      )
      select count(*)::int as value from dupes
    `,
  },
  {
    id: 'market_price_out_of_range',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where price_yes < 0 or price_yes > 1
    `,
  },
  {
    id: 'action_direction_inconsistent',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where not (
        (action in ('BUY_YES', 'BUY_NO') and shares_delta >= 0 and usd_amount >= 0)
        or
        (action in ('SELL_YES', 'SELL_NO') and shares_delta <= 0 and usd_amount >= 0)
        or
        (action = 'HOLD' and shares_delta = 0 and usd_amount = 0)
      )
    `,
  },
  {
    id: 'resolved_market_state_inconsistent',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where not (
        (status = 'OPEN' and resolved_outcome is null and resolved_at is null)
        or
        (status = 'RESOLVED' and resolved_outcome is not null and resolved_at is not null)
      )
    `,
  },
  {
    id: 'non_midnight_run_dates',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_runs
      where run_date::text <> to_char(run_date, 'YYYY-MM-DD')
    `,
  },
  {
    id: 'non_midnight_action_run_dates',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where run_date::text <> to_char(run_date, 'YYYY-MM-DD')
    `,
  },
]

async function run(): Promise<void> {
  const sql = postgres(connectionString!, { prepare: false, max: 1 })

  try {
    let errorCount = 0
    let warnCount = 0
    const rows: Array<{ id: string; severity: Severity; value: number }> = []

    for (const check of CHECKS) {
      const result = await sql.unsafe<{ value: number }[]>(check.sql)
      const value = Number(result[0]?.value ?? 0)
      rows.push({ id: check.id, severity: check.severity, value })
      if (value > 0) {
        if (check.severity === 'error') errorCount += 1
        if (check.severity === 'warn') warnCount += 1
      }
    }

    const labelWidth = Math.max(...rows.map((row) => row.id.length), 10)
    console.log('Market DB audit (v2)')
    for (const row of rows) {
      const level = row.severity.toUpperCase().padEnd(5, ' ')
      const id = row.id.padEnd(labelWidth, ' ')
      const marker = row.value === 0 ? 'OK ' : 'BAD'
      console.log(`${marker}  [${level}] ${id}  ${row.value}`)
    }

    if (errorCount > 0) {
      console.error(`\nFailed: ${errorCount} error checks have violations.`)
      process.exit(1)
    }

    if (warnCount > 0) {
      console.warn(`\nPassed with warnings: ${warnCount} warning checks have violations.`)
      return
    }

    console.log('\nPassed: all checks clean.')
  } finally {
    await sql.end({ timeout: 1 })
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
