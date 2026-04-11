import dotenv from 'dotenv'
import postgres from 'postgres'
import { ALL_MODEL_IDS, MODEL_IDS } from '../lib/constants'
import {
  computeTrialPublicStateCounts,
  getDefaultTrialPublicStateOutputPath,
  sanitizeForJson,
  type TrialBundleRow,
  type TrialMarketActionBundleRow,
  type TrialMarketBundleRow,
  type TrialMarketPositionBundleRow,
  type TrialMarketPriceSnapshotBundleRow,
  type TrialMarketRunBundleRow,
  type TrialMarketRunLogBundleRow,
  type TrialModelActorBundleRow,
  type TrialModelDecisionSnapshotBundleRow,
  type TrialMonitorConfigBundleRow,
  type TrialMonitorRunBundleRow,
  type TrialOutcomeCandidateBundleRow,
  type TrialOutcomeCandidateEvidenceBundleRow,
  type TrialPublicStateBundle,
  TRIAL_PUBLIC_STATE_SCHEMA_VERSION,
  type TrialQuestionBundleRow,
  type TrialQuestionOutcomeHistoryBundleRow,
  type TrialSyncConfigBundleRow,
  type TrialSyncRunBundleRow,
  type TrialSyncRunItemBundleRow,
  writeTrialPublicStateBundle,
} from './trial-public-state-utils'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  outputFile: string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let outputFile: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output-file') {
      outputFile = argv[index + 1] ?? null
      index += 1
    }
  }

  return { outputFile }
}

async function hasColumn(sql: postgres.Sql, tableName: string, columnName: string) {
  const [row] = await sql<{ present: boolean }[]>`
    select exists(
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${tableName}
        and column_name = ${columnName}
    ) as present
  `

  return Boolean(row?.present)
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const args = parseArgs(process.argv.slice(2))
  const outputFile = args.outputFile ?? getDefaultTrialPublicStateOutputPath()
  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    const monitorConfigHasWebSearchEnabled = await hasColumn(sql, 'trial_monitor_configs', 'web_search_enabled')

    const [
      trialMonitorConfig,
      trialSyncConfig,
      trials,
      trialQuestions,
      trialMarkets,
      trialMarketPriceSnapshots,
      trialOutcomeCandidates,
      trialOutcomeCandidateEvidence,
      trialMonitorRuns,
      trialQuestionOutcomeHistory,
      trialSyncRuns,
      trialSyncRunItems,
      trialMarketRuns,
      trialMarketRunLogs,
      trialMarketActions,
      trialModelDecisionSnapshots,
      trialMarketPositions,
      modelActors,
      ignoredHumanTrialPositions,
    ] = await Promise.all([
      monitorConfigHasWebSearchEnabled
        ? sql<TrialMonitorConfigBundleRow[]>`
            select
              id,
              enabled,
              web_search_enabled,
              run_interval_hours,
              lookahead_days,
              overdue_recheck_hours,
              max_questions_per_run,
              verifier_model_key,
              min_candidate_confidence,
              created_at,
              updated_at
            from trial_monitor_configs
            where id = 'default'
          `
        : sql<TrialMonitorConfigBundleRow[]>`
            select
              id,
              enabled,
              null::boolean as web_search_enabled,
              run_interval_hours,
              lookahead_days,
              overdue_recheck_hours,
              max_questions_per_run,
              verifier_model_key,
              min_candidate_confidence,
              created_at,
              updated_at
            from trial_monitor_configs
            where id = 'default'
          `,
      sql<TrialSyncConfigBundleRow[]>`
        select
          id,
          enabled,
          sync_interval_hours,
          recent_completion_lookback_days,
          reconcile_interval_hours,
          last_successful_update_post_date,
          last_successful_data_timestamp,
          created_at,
          updated_at
        from trial_sync_configs
        where id = 'default'
      `,
      sql<TrialBundleRow[]>`
        select
          id,
          nct_number,
          source,
          short_title,
          sponsor_name,
          sponsor_ticker,
          indication,
          exact_phase,
          intervention,
          primary_endpoint,
          study_start_date,
          est_primary_completion_date,
          est_study_completion_date,
          est_results_posting_date,
          current_status,
          est_enrollment,
          key_locations,
          brief_summary,
          standard_betting_markets,
          last_monitored_at,
          created_at,
          updated_at
        from trials
        order by nct_number
      `,
      sql<TrialQuestionBundleRow[]>`
        select
          id,
          trial_id,
          slug,
          prompt,
          status,
          is_bettable,
          sort_order,
          outcome,
          outcome_date,
          created_at,
          updated_at
        from trial_questions
        order by trial_id, sort_order, id
      `,
      sql<TrialMarketBundleRow[]>`
        select
          pm.id,
          pm.trial_question_id,
          pm.status,
          pm.opening_probability,
          pm.house_opening_probability,
          pm.opening_line_source,
          pm.b,
          pm.q_yes,
          pm.q_no,
          pm.price_yes,
          pm.opened_by_user_id,
          u.email as opened_by_user_email,
          pm.opened_at,
          pm.resolved_at,
          pm.resolved_outcome,
          pm.created_at,
          pm.updated_at
        from prediction_markets pm
        left join users u on u.id = pm.opened_by_user_id
        where pm.trial_question_id is not null
        order by trial_question_id, id
      `,
      sql<TrialMarketPriceSnapshotBundleRow[]>`
        select
          mps.id,
          mps.market_id,
          mps.snapshot_date,
          mps.price_yes,
          mps.q_yes,
          mps.q_no,
          mps.created_at
        from market_price_snapshots mps
        join prediction_markets pm on pm.id = mps.market_id
        where pm.trial_question_id is not null
        order by mps.market_id, mps.snapshot_date, mps.id
      `,
      sql<TrialOutcomeCandidateBundleRow[]>`
        select
          toc.id,
          toc.trial_question_id,
          toc.proposed_outcome,
          toc.proposed_outcome_date,
          toc.confidence,
          toc.summary,
          toc.verifier_model_key,
          toc.provider_response_id,
          toc.evidence_hash,
          toc.status,
          toc.reviewed_by_user_id,
          u.email as reviewed_by_user_email,
          toc.review_notes,
          toc.created_at,
          toc.updated_at,
          toc.reviewed_at
        from trial_outcome_candidates toc
        left join users u on u.id = toc.reviewed_by_user_id
        order by toc.created_at, toc.id
      `,
      sql<TrialOutcomeCandidateEvidenceBundleRow[]>`
        select
          id,
          candidate_id,
          source_type,
          title,
          url,
          published_at,
          excerpt,
          domain,
          display_order,
          created_at
        from trial_outcome_candidate_evidence
        order by candidate_id, display_order, id
      `,
      sql<TrialMonitorRunBundleRow[]>`
        select
          id,
          trigger_source,
          status,
          questions_scanned,
          candidates_created,
          error_summary,
          debug_log,
          started_at,
          completed_at,
          updated_at
        from trial_monitor_runs
        order by started_at, id
      `,
      sql<TrialQuestionOutcomeHistoryBundleRow[]>`
        select
          tqoh.id,
          tqoh.trial_question_id,
          tqoh.previous_outcome,
          tqoh.previous_outcome_date,
          tqoh.next_outcome,
          tqoh.next_outcome_date,
          tqoh.changed_at,
          tqoh.change_source,
          tqoh.changed_by_user_id,
          u.email as changed_by_user_email,
          tqoh.review_candidate_id,
          tqoh.notes
        from trial_question_outcome_history tqoh
        left join users u on u.id = tqoh.changed_by_user_id
        order by tqoh.changed_at, tqoh.id
      `,
      sql<TrialSyncRunBundleRow[]>`
        select
          id,
          trigger_source,
          mode,
          status,
          source_data_timestamp,
          studies_fetched,
          studies_matched,
          trials_upserted,
          questions_upserted,
          markets_opened,
          error_summary,
          started_at,
          completed_at,
          updated_at
        from trial_sync_runs
        order by started_at, id
      `,
      sql<TrialSyncRunItemBundleRow[]>`
        select
          id,
          run_id,
          trial_id,
          nct_number,
          short_title,
          sponsor_name,
          current_status,
          est_primary_completion_date,
          change_type,
          change_summary,
          created_at
        from trial_sync_run_items
        order by run_id, created_at, id
      `,
      sql<TrialMarketRunBundleRow[]>`
        with trial_run_ids as (
          select distinct run_id as id
          from market_actions
          where trial_question_id is not null
            and run_id is not null
          union
          select distinct run_id as id
          from model_decision_snapshots
          where trial_question_id is not null
            and run_id is not null
          union
          select distinct run_id as id
          from market_run_logs
          where trial_question_id is not null
            and run_id is not null
        )
        select
          mr.id,
          mr.run_date,
          mr.status,
          mr.open_markets,
          mr.total_actions,
          mr.processed_actions,
          mr.ok_count,
          mr.error_count,
          mr.skipped_count,
          mr.failure_reason,
          mr.created_at,
          mr.updated_at,
          mr.completed_at
        from market_runs mr
        join trial_run_ids tri on tri.id = mr.id
        order by mr.run_date, mr.id
      `,
      sql<TrialMarketRunLogBundleRow[]>`
        with trial_run_ids as (
          select distinct run_id as id
          from market_actions
          where trial_question_id is not null
            and run_id is not null
          union
          select distinct run_id as id
          from model_decision_snapshots
          where trial_question_id is not null
            and run_id is not null
          union
          select distinct run_id as id
          from market_run_logs
          where trial_question_id is not null
            and run_id is not null
        )
        select
          mrl.id,
          mrl.run_id,
          mrl.log_type,
          mrl.message,
          mrl.completed_actions,
          mrl.total_actions,
          mrl.ok_count,
          mrl.error_count,
          mrl.skipped_count,
          mrl.market_id,
          mrl.trial_question_id,
          mrl.actor_id,
          mrl.activity_phase,
          mrl.action,
          mrl.action_status,
          mrl.amount_usd,
          mrl.created_at
        from market_run_logs mrl
        join trial_run_ids tri on tri.id = mrl.run_id
        left join market_actors ma on ma.id = mrl.actor_id
        where mrl.actor_id is null or ma.actor_type = 'model'
        order by mrl.run_id, mrl.created_at, mrl.id
      `,
      sql<TrialMarketActionBundleRow[]>`
        select
          ma.id,
          ma.run_id,
          ma.market_id,
          ma.trial_question_id,
          ma.actor_id,
          ma.run_date,
          ma.action_source,
          ma.action,
          ma.usd_amount,
          ma.shares_delta,
          ma.price_before,
          ma.price_after,
          ma.explanation,
          ma.status,
          ma.error_code,
          ma.error_details,
          ma.error,
          ma.created_at
        from market_actions ma
        join market_actors actor on actor.id = ma.actor_id
        where ma.trial_question_id is not null
          and actor.actor_type = 'model'
        order by ma.created_at, ma.id
      `,
      sql<TrialModelDecisionSnapshotBundleRow[]>`
        select
          mds.id,
          mds.run_id,
          mds.run_date,
          mds.market_id,
          mds.trial_question_id,
          mds.actor_id,
          mds.run_source,
          mds.approval_probability,
          mds.yes_probability,
          mds.binary_call,
          mds.confidence,
          mds.reasoning,
          mds.proposed_action_type,
          mds.proposed_amount_usd,
          mds.proposed_explanation,
          mds.market_price_yes,
          mds.market_price_no,
          mds.cash_available,
          mds.yes_shares_held,
          mds.no_shares_held,
          mds.max_buy_usd,
          mds.max_sell_yes_usd,
          mds.max_sell_no_usd,
          mds.duration_ms,
          mds.input_tokens,
          mds.output_tokens,
          mds.total_tokens,
          mds.reasoning_tokens,
          mds.estimated_cost_usd,
          mds.cost_source,
          mds.cache_creation_input_tokens_5m,
          mds.cache_creation_input_tokens_1h,
          mds.cache_read_input_tokens,
          mds.web_search_requests,
          mds.inference_geo,
          mds.linked_market_action_id,
          mds.created_at
        from model_decision_snapshots mds
        join market_actors actor on actor.id = mds.actor_id
        where mds.trial_question_id is not null
          and actor.actor_type = 'model'
        order by mds.created_at, mds.id
      `,
      sql<TrialMarketPositionBundleRow[]>`
        select
          mp.id,
          mp.market_id,
          mp.actor_id,
          mp.yes_shares,
          mp.no_shares,
          mp.created_at,
          mp.updated_at
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        join market_actors ma on ma.id = mp.actor_id
        where pm.trial_question_id is not null
          and ma.actor_type = 'model'
        order by mp.market_id, mp.actor_id, mp.id
      `,
      sql<TrialModelActorBundleRow[]>`
        with trial_run_ids as (
          select distinct run_id as id
          from market_actions
          where trial_question_id is not null
            and run_id is not null
          union
          select distinct run_id as id
          from model_decision_snapshots
          where trial_question_id is not null
            and run_id is not null
          union
          select distinct run_id as id
          from market_run_logs
          where trial_question_id is not null
            and run_id is not null
        ),
        referenced_actor_ids as (
          select distinct mp.actor_id as actor_id
          from market_positions mp
          join prediction_markets pm on pm.id = mp.market_id
          join market_actors ma on ma.id = mp.actor_id
          where pm.trial_question_id is not null
            and ma.actor_type = 'model'
          union
          select distinct ma.actor_id as actor_id
          from market_actions ma
          join market_actors actor on actor.id = ma.actor_id
          where ma.trial_question_id is not null
            and actor.actor_type = 'model'
          union
          select distinct mds.actor_id as actor_id
          from model_decision_snapshots mds
          join market_actors actor on actor.id = mds.actor_id
          where mds.trial_question_id is not null
            and actor.actor_type = 'model'
          union
          select distinct mrl.actor_id as actor_id
          from market_run_logs mrl
          join trial_run_ids tri on tri.id = mrl.run_id
          join market_actors actor on actor.id = mrl.actor_id
          where actor.actor_type = 'model'
        )
        select
          ma.id as actor_id,
          ma.model_key,
          ma.display_name,
          ma.created_at,
          ma.updated_at
        from market_actors ma
        join referenced_actor_ids rai on rai.actor_id = ma.id
        where ma.actor_type = 'model'
          and ma.model_key is not null
        order by ma.model_key, ma.id
      `,
      sql<{ skipped_positions: number }[]>`
        select count(*)::int as skipped_positions
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        join market_actors ma on ma.id = mp.actor_id
        where pm.trial_question_id is not null
          and ma.actor_type = 'human'
      `,
    ])

    const monitorConfigRow = trialMonitorConfig[0]
    if (!monitorConfigRow) {
      throw new Error('Missing default trial_monitor_configs row')
    }

    const syncConfigRow = trialSyncConfig[0]
    if (!syncConfigRow) {
      throw new Error('Missing default trial_sync_configs row')
    }

    const bundleBase: TrialPublicStateBundle = {
      metadata: {
        schema_version: TRIAL_PUBLIC_STATE_SCHEMA_VERSION,
        exported_at: new Date().toISOString(),
        source_supported_model_ids: [...ALL_MODEL_IDS],
        source_active_model_ids: [...MODEL_IDS],
        source_disabled_model_ids: ALL_MODEL_IDS.filter((modelId) => !MODEL_IDS.includes(modelId)),
        counts: {
          trials: 0,
          trial_questions: 0,
          question_outcome_pending: 0,
          question_outcome_yes: 0,
          question_outcome_no: 0,
          trial_markets: 0,
          open_trial_markets: 0,
          resolved_trial_markets: 0,
          trial_market_price_snapshots: 0,
          trial_outcome_candidates: 0,
          pending_review_candidates: 0,
          dismissed_candidates: 0,
          accepted_candidates: 0,
          trial_outcome_candidate_evidence: 0,
          trial_monitor_runs: 0,
          trial_question_outcome_history: 0,
          trial_sync_runs: 0,
          trial_sync_run_items: 0,
          trial_market_runs: 0,
          trial_market_run_logs: 0,
          trial_market_actions: 0,
          trial_model_decision_snapshots: 0,
          trial_market_positions: 0,
        },
      },
      trialMonitorConfig: monitorConfigRow,
      trialSyncConfig: syncConfigRow,
      trials,
      trialQuestions,
      trialMarkets,
      trialMarketPriceSnapshots,
      trialOutcomeCandidates,
      trialOutcomeCandidateEvidence,
      trialMonitorRuns,
      trialQuestionOutcomeHistory,
      trialSyncRuns,
      trialSyncRunItems,
      trialMarketRuns,
      trialMarketRunLogs,
      trialMarketActions,
      trialModelDecisionSnapshots,
      trialMarketPositions,
      modelActors,
    }

    const bundle = sanitizeForJson(bundleBase)
    bundle.metadata.counts = computeTrialPublicStateCounts(bundle)

    const resolvedPath = await writeTrialPublicStateBundle(outputFile, bundle)

    console.log(JSON.stringify({
      mode: 'export',
      filePath: resolvedPath,
      schemaVersion: bundle.metadata.schema_version,
      sourceSupportedModelIds: bundle.metadata.source_supported_model_ids,
      sourceActiveModelIds: bundle.metadata.source_active_model_ids,
      sourceDisabledModelIds: bundle.metadata.source_disabled_model_ids,
      counts: bundle.metadata.counts,
      modelActorCount: bundle.modelActors.length,
      skippedHumanTrialPositions: Number(ignoredHumanTrialPositions[0]?.skipped_positions ?? 0),
    }, null, 2))
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
