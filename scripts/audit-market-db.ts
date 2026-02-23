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
    id: 'orphan_positions_account',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_positions p
      left join market_accounts a on a.model_id = p.model_id
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
    id: 'orphan_actions_run',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions a
      left join market_runs r on r.id = a.run_id
      where a.run_id is not null and r.id is null
    `,
  },
  {
    id: 'action_event_market_mismatch',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions a
      join prediction_markets m on m.id = a.market_id
      where a.fda_event_id <> m.fda_event_id
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
       and p.model_id = a.model_id
      where m.status = 'OPEN'
        and p.id is null
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
    id: 'market_opening_probability_out_of_range',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where opening_probability < 0 or opening_probability > 1
    `,
  },
  {
    id: 'market_non_positive_b',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where b <= 0
    `,
  },
  {
    id: 'position_negative_shares',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_positions
      where yes_shares < 0 or no_shares < 0
    `,
  },
  {
    id: 'action_negative_usd',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where usd_amount < 0
    `,
  },
  {
    id: 'action_price_out_of_range',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where price_before < 0 or price_before > 1 or price_after < 0 or price_after > 1
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
    id: 'duplicate_price_snapshots',
    severity: 'error',
    sql: `
      with dupes as (
        select market_id, snapshot_date, count(*) c
        from market_price_snapshots
        group by market_id, snapshot_date
        having count(*) > 1
      )
      select count(*)::int as value from dupes
    `,
  },
  {
    id: 'duplicate_daily_snapshots',
    severity: 'error',
    sql: `
      with dupes as (
        select model_id, snapshot_date, count(*) c
        from market_daily_snapshots
        group by model_id, snapshot_date
        having count(*) > 1
      )
      select count(*)::int as value from dupes
    `,
  },
  {
    id: 'non_midnight_run_dates',
    severity: 'warn',
    sql: `
      select count(*)::int as value
      from market_runs
      where run_date::time <> time '00:00:00'
    `,
  },
  {
    id: 'non_midnight_action_run_dates',
    severity: 'warn',
    sql: `
      select count(*)::int as value
      from market_actions
      where run_date::time <> time '00:00:00'
    `,
  },
  {
    id: 'stale_running_runs',
    severity: 'warn',
    sql: `
      select count(*)::int as value
      from market_runs
      where status = 'running'
        and coalesce(updated_at, created_at, run_date) < now() - interval '2 hours'
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
    console.log('Market DB audit')
    for (const row of rows) {
      const level = row.severity.toUpperCase().padEnd(5, ' ')
      const id = row.id.padEnd(labelWidth, ' ')
      const marker = row.value === 0 ? 'OK ' : 'BAD'
      console.log(`${marker}  [${level}] ${id}  ${row.value}`)
    }

    if (errorCount > 0) {
      console.error(`\\nFailed: ${errorCount} error checks have violations.`)
      process.exit(1)
    }

    if (warnCount > 0) {
      console.warn(`\\nPassed with warnings: ${warnCount} warning checks have violations.`)
      return
    }

    console.log('\\nPassed: all checks clean.')
  } finally {
    await sql.end({ timeout: 1 })
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
