import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const REQUIRED_TABLES = [
  'phase2_trials',
  'trial_questions',
  'trial_monitor_runs',
  'trial_sync_configs',
  'trial_sync_runs',
  'trial_outcome_candidates',
  'prediction_markets',
  'market_accounts',
  'market_runs',
] as const

type ParsedArgs = {
  apply: boolean
}

type RollbackSummary = {
  phase2Trials: number
  trialQuestions: number
  trialMarkets: number
  resolvedTrialMarkets: number
  trialSyncRuns: number
  trialMonitorRuns: number
  trialOutcomeCandidates: number
  trialOnlyMarketRuns: number
  affectedActors: number
  tradeRollbackUsd: number
  settlementRollbackUsd: number
}

function parseArgs(argv: string[]): ParsedArgs {
  return {
    apply: argv.includes('--apply'),
  }
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0)
}

async function loadExistingTables(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'phase2_trials',
        'trial_questions',
        'trial_monitor_runs',
        'trial_sync_configs',
        'trial_sync_runs',
        'trial_outcome_candidates',
        'prediction_markets',
        'market_accounts',
        'market_runs'
      )
    order by table_name
  `

  return rows.map((row) => row.table_name)
}

async function loadSummary(sql: postgres.Sql): Promise<RollbackSummary> {
  const [row] = await sql<{
    phase2_trials: string | number
    trial_questions: string | number
    trial_markets: string | number
    resolved_trial_markets: string | number
    trial_sync_runs: string | number
    trial_monitor_runs: string | number
    trial_outcome_candidates: string | number
    trial_only_market_runs: string | number
    affected_actors: string | number
    trade_rollback_usd: string | number
    settlement_rollback_usd: string | number
  }[]>`
    with trial_only_runs as (
      select mr.id
      from market_runs mr
      where (
        exists (select 1 from market_actions ma where ma.run_id = mr.id and ma.trial_question_id is not null)
        or exists (select 1 from model_decision_snapshots mds where mds.run_id = mr.id and mds.trial_question_id is not null)
        or exists (select 1 from market_run_logs mrl where mrl.run_id = mr.id and mrl.trial_question_id is not null)
      )
      and not exists (select 1 from market_actions ma where ma.run_id = mr.id and ma.fda_event_id is not null)
      and not exists (select 1 from model_decision_snapshots mds where mds.run_id = mr.id and mds.fda_event_id is not null)
      and not exists (select 1 from market_run_logs mrl where mrl.run_id = mr.id and mrl.fda_event_id is not null)
    ),
    affected_actors as (
      select actor_id
      from market_actions
      where trial_question_id is not null
      union
      select mp.actor_id
      from market_positions mp
      join prediction_markets pm on pm.id = mp.market_id
      where pm.trial_question_id is not null
        and pm.status = 'RESOLVED'
        and pm.resolved_outcome is not null
    )
    select
      (select count(*)::bigint from phase2_trials) as phase2_trials,
      (select count(*)::bigint from trial_questions) as trial_questions,
      (select count(*)::bigint from prediction_markets where trial_question_id is not null) as trial_markets,
      (select count(*)::bigint from prediction_markets where trial_question_id is not null and status = 'RESOLVED') as resolved_trial_markets,
      (select count(*)::bigint from trial_sync_runs) as trial_sync_runs,
      (select count(*)::bigint from trial_monitor_runs) as trial_monitor_runs,
      (select count(*)::bigint from trial_outcome_candidates) as trial_outcome_candidates,
      (select count(*)::bigint from trial_only_runs) as trial_only_market_runs,
      (select count(*)::bigint from affected_actors) as affected_actors,
      (
        select coalesce(sum(
          case
            when action in ('BUY_YES', 'BUY_NO') and status = 'ok' then usd_amount
            when action in ('SELL_YES', 'SELL_NO') and status = 'ok' then -usd_amount
            else 0
          end
        ), 0)
        from market_actions
        where trial_question_id is not null
      ) as trade_rollback_usd,
      (
        select coalesce(sum(
          case
            when pm.status = 'RESOLVED' and pm.resolved_outcome in ('Approved', 'YES') then mp.yes_shares
            when pm.status = 'RESOLVED' and pm.resolved_outcome in ('Rejected', 'NO') then mp.no_shares
            else 0
          end
        ), 0)
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        where pm.trial_question_id is not null
      ) as settlement_rollback_usd
  `

  return {
    phase2Trials: toNumber(row?.phase2_trials),
    trialQuestions: toNumber(row?.trial_questions),
    trialMarkets: toNumber(row?.trial_markets),
    resolvedTrialMarkets: toNumber(row?.resolved_trial_markets),
    trialSyncRuns: toNumber(row?.trial_sync_runs),
    trialMonitorRuns: toNumber(row?.trial_monitor_runs),
    trialOutcomeCandidates: toNumber(row?.trial_outcome_candidates),
    trialOnlyMarketRuns: toNumber(row?.trial_only_market_runs),
    affectedActors: toNumber(row?.affected_actors),
    tradeRollbackUsd: toNumber(row?.trade_rollback_usd),
    settlementRollbackUsd: toNumber(row?.settlement_rollback_usd),
  }
}

async function applyRollback(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      with actor_trade_reversal as (
        select actor_id,
          coalesce(sum(
            case
              when action in ('BUY_YES', 'BUY_NO') and status = 'ok' then usd_amount
              when action in ('SELL_YES', 'SELL_NO') and status = 'ok' then -usd_amount
              else 0
            end
          ), 0)::double precision as delta
        from market_actions
        where trial_question_id is not null
        group by actor_id
      ),
      actor_settlement_reversal as (
        select mp.actor_id,
          coalesce(sum(
            case
              when pm.status = 'RESOLVED' and pm.resolved_outcome in ('Approved', 'YES') then -mp.yes_shares
              when pm.status = 'RESOLVED' and pm.resolved_outcome in ('Rejected', 'NO') then -mp.no_shares
              else 0
            end
          ), 0)::double precision as delta
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        where pm.trial_question_id is not null
        group by mp.actor_id
      ),
      actor_net as (
        select actor_id, sum(delta)::double precision as delta
        from (
          select actor_id, delta from actor_trade_reversal
          union all
          select actor_id, delta from actor_settlement_reversal
        ) adjustments
        group by actor_id
      )
      update market_accounts ma
      set cash_balance = ma.cash_balance + actor_net.delta,
          updated_at = now()
      from actor_net
      where ma.actor_id = actor_net.actor_id
    `)

    await tx.unsafe(`
      with trial_only_runs as (
        select mr.id
        from market_runs mr
        where (
          exists (select 1 from market_actions ma where ma.run_id = mr.id and ma.trial_question_id is not null)
          or exists (select 1 from model_decision_snapshots mds where mds.run_id = mr.id and mds.trial_question_id is not null)
          or exists (select 1 from market_run_logs mrl where mrl.run_id = mr.id and mrl.trial_question_id is not null)
        )
        and not exists (select 1 from market_actions ma where ma.run_id = mr.id and ma.fda_event_id is not null)
        and not exists (select 1 from model_decision_snapshots mds where mds.run_id = mr.id and mds.fda_event_id is not null)
        and not exists (select 1 from market_run_logs mrl where mrl.run_id = mr.id and mrl.fda_event_id is not null)
      )
      delete from market_runs mr
      using trial_only_runs tor
      where mr.id = tor.id
    `)

    await tx.unsafe(`
      delete from trial_outcome_candidates
      where trial_question_id in (select id from trial_questions)
    `)
    await tx.unsafe('delete from trial_monitor_runs')
    await tx.unsafe('delete from trial_sync_runs')
    await tx.unsafe(`
      update trial_sync_configs
      set last_successful_update_post_date = null,
          last_successful_data_timestamp = null,
          updated_at = now()
    `)
    await tx.unsafe('delete from phase2_trials')
    await tx.unsafe(`
      delete from market_daily_snapshots
      where snapshot_date = current_date
    `)
  })
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const args = parseArgs(process.argv.slice(2))
  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    const existingTables = await loadExistingTables(sql)
    const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTables.includes(tableName))

    if (missingTables.length > 0) {
      console.log(JSON.stringify({
        mode: args.apply ? 'apply' : 'dry-run',
        skipped: true,
        reason: 'missing_tables',
        existingTables,
        missingTables,
      }, null, 2))
      return
    }

    const summary = await loadSummary(sql)

    if (!args.apply) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        existingTables,
        summary,
        notes: [
          'tradeRollbackUsd adds back trial-market buy spend and removes trial-market sell proceeds from shared model cash balances.',
          'settlementRollbackUsd removes payouts from currently resolved trial markets before trial-linked rows are deleted.',
          'market_daily_snapshots for the current DB date are deleted during apply so snapshots can be regenerated with corrected balances.',
        ],
      }, null, 2))
      return
    }

    await applyRollback(sql)

    console.log(JSON.stringify({
      mode: 'apply',
      applied: true,
      existingTables,
      deletedSummary: summary,
    }, null, 2))
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
