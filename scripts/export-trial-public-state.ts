import dotenv from 'dotenv'
import postgres from 'postgres'
import { ALL_MODEL_IDS, MODEL_IDS } from '../lib/constants'
import {
  computeTrialPublicStateCounts,
  getDefaultTrialPublicStateOutputPath,
  sanitizeForJson,
  type Phase2TrialBundleRow,
  type TrialMarketBundleRow,
  type TrialMarketPriceSnapshotBundleRow,
  type TrialMonitorConfigBundleRow,
  type TrialMonitorRunBundleRow,
  type TrialOutcomeCandidateBundleRow,
  type TrialOutcomeCandidateEvidenceBundleRow,
  type TrialPublicStateBundle,
  TRIAL_PUBLIC_STATE_SCHEMA_VERSION,
  type TrialQuestionBundleRow,
  type TrialSyncConfigBundleRow,
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
      phase2Trials,
      trialQuestions,
      trialMarkets,
      trialMarketPriceSnapshots,
      trialOutcomeCandidates,
      trialOutcomeCandidateEvidence,
      trialMonitorRuns,
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
      sql<Phase2TrialBundleRow[]>`
        select
          id,
          nct_number,
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
        from phase2_trials
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
          id,
          trial_question_id,
          status,
          opening_probability,
          b,
          q_yes,
          q_no,
          price_yes,
          opened_at,
          resolved_at,
          resolved_outcome,
          created_at,
          updated_at
        from prediction_markets
        where trial_question_id is not null
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
          phase2_trials: 0,
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
        },
      },
      trialMonitorConfig: monitorConfigRow,
      trialSyncConfig: syncConfigRow,
      phase2Trials,
      trialQuestions,
      trialMarkets,
      trialMarketPriceSnapshots,
      trialOutcomeCandidates,
      trialOutcomeCandidateEvidence,
      trialMonitorRuns,
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
    }, null, 2))
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
