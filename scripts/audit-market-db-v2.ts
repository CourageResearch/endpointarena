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
    id: 'snapshot_action_source_mismatch',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots s
      join market_actions a on a.id = s.linked_market_action_id
      where (s.run_source = 'cycle' and a.action_source <> 'cycle')
         or (s.run_source = 'manual' and a.action_source <> 'human')
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
    id: 'trade_pairs_missing_positions',
    severity: 'error',
    sql: `
      with traded_pairs as (
        select distinct market_id, actor_id
        from market_actions
        where status = 'ok'
          and action in ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO')
      )
      select count(*)::int as value
      from traded_pairs tp
      left join market_positions p
        on p.market_id = tp.market_id
       and p.actor_id = tp.actor_id
      where p.id is null
    `,
  },
  {
    id: 'negative_position_shares',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_positions
      where yes_shares < -0.000001
         or no_shares < -0.000001
    `,
  },
  {
    id: 'daily_snapshot_equity_drift',
    severity: 'warn',
    sql: `
      select count(*)::int as value
      from market_daily_snapshots
      where abs(total_equity - (cash_balance + positions_value)) > 0.05
    `,
  },
  {
    id: 'daily_snapshot_missing_for_accounts',
    severity: 'warn',
    sql: `
      with latest_snapshot_date as (
        select max(snapshot_date) as snapshot_date
        from market_daily_snapshots
      )
      select count(*)::int as value
      from market_accounts a
      cross join latest_snapshot_date lsd
      left join market_daily_snapshots s
        on s.actor_id = a.actor_id
       and s.snapshot_date = lsd.snapshot_date
      where lsd.snapshot_date is not null
        and s.actor_id is null
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
    id: 'missing_trial_source',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from trials
      where source is null
         or btrim(source) = ''
    `,
  },
  {
    id: 'invalid_trial_source',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from trials
      where source not in ('sync_import', 'manual_admin')
    `,
  },
  {
    id: 'house_opening_probability_out_of_range',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where house_opening_probability < 0
         or house_opening_probability > 1
    `,
  },
  {
    id: 'invalid_opening_line_source',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where opening_line_source not in ('house_model', 'admin_override')
    `,
  },
  {
    id: 'house_model_opening_line_drift',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where opening_line_source = 'house_model'
        and abs(opening_probability - house_opening_probability) > 0.000001
    `,
  },
  {
    id: 'admin_override_missing_opened_by_user',
    severity: 'warn',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where opening_line_source = 'admin_override'
        and opened_by_user_id is null
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
    id: 'ownerless_market_actions',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from market_actions
      where trial_question_id is null
    `,
  },
  {
    id: 'ownerless_model_snapshots',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots
      where trial_question_id is null
    `,
  },
  {
    id: 'invalid_market_outcomes',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from prediction_markets
      where resolved_outcome is not null
        and resolved_outcome not in ('YES', 'NO')
    `,
  },
  {
    id: 'invalid_snapshot_binary_calls',
    severity: 'error',
    sql: `
      select count(*)::int as value
      from model_decision_snapshots
      where binary_call not in ('yes', 'no')
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
