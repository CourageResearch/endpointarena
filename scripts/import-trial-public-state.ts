import dotenv from 'dotenv'
import postgres from 'postgres'
import { ALL_MODEL_IDS } from '../lib/constants'
import { MARKET_STARTING_CASH } from '../lib/markets/constants'
import {
  computeTrialPublicStateCounts,
  loadTrialPublicStateBundle,
  type TrialMonitorConfigBundleRow,
  type TrialPublicStateBundle,
  type TrialSyncConfigBundleRow,
  TRIAL_PUBLIC_STATE_SCHEMA_VERSION,
} from './trial-public-state-utils'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  inputFile: string | null
  apply: boolean
}

type TargetTrialNamespaceCounts = {
  phase2_trials: number
  trial_questions: number
  trial_markets: number
  trial_market_price_snapshots: number
  trial_outcome_candidates: number
  trial_monitor_runs: number
  trial_sync_runs: number
  trial_sync_run_items: number
  trial_market_actions: number
  trial_market_positions: number
  trial_model_decision_snapshots: number
  trial_market_run_logs: number
}

function parseArgs(argv: string[]): ParsedArgs {
  let inputFile: string | null = null
  let apply = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input-file') {
      inputFile = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--apply') {
      apply = true
    }
  }

  return { inputFile, apply }
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0)
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

async function loadTargetTrialNamespaceCounts(sql: postgres.Sql): Promise<TargetTrialNamespaceCounts> {
  const [row] = await sql<{
    phase2_trials: string | number
    trial_questions: string | number
    trial_markets: string | number
    trial_market_price_snapshots: string | number
    trial_outcome_candidates: string | number
    trial_monitor_runs: string | number
    trial_sync_runs: string | number
    trial_sync_run_items: string | number
    trial_market_actions: string | number
    trial_market_positions: string | number
    trial_model_decision_snapshots: string | number
    trial_market_run_logs: string | number
  }[]>`
    select
      (select count(*)::bigint from phase2_trials) as phase2_trials,
      (select count(*)::bigint from trial_questions) as trial_questions,
      (select count(*)::bigint from prediction_markets where trial_question_id is not null) as trial_markets,
      (
        select count(*)::bigint
        from market_price_snapshots mps
        join prediction_markets pm on pm.id = mps.market_id
        where pm.trial_question_id is not null
      ) as trial_market_price_snapshots,
      (select count(*)::bigint from trial_outcome_candidates) as trial_outcome_candidates,
      (select count(*)::bigint from trial_monitor_runs) as trial_monitor_runs,
      (select count(*)::bigint from trial_sync_runs) as trial_sync_runs,
      (select count(*)::bigint from trial_sync_run_items) as trial_sync_run_items,
      (select count(*)::bigint from market_actions where trial_question_id is not null) as trial_market_actions,
      (
        select count(*)::bigint
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        where pm.trial_question_id is not null
      ) as trial_market_positions,
      (select count(*)::bigint from model_decision_snapshots where trial_question_id is not null) as trial_model_decision_snapshots,
      (select count(*)::bigint from market_run_logs where trial_question_id is not null) as trial_market_run_logs
  `

  return {
    phase2_trials: toNumber(row?.phase2_trials),
    trial_questions: toNumber(row?.trial_questions),
    trial_markets: toNumber(row?.trial_markets),
    trial_market_price_snapshots: toNumber(row?.trial_market_price_snapshots),
    trial_outcome_candidates: toNumber(row?.trial_outcome_candidates),
    trial_monitor_runs: toNumber(row?.trial_monitor_runs),
    trial_sync_runs: toNumber(row?.trial_sync_runs),
    trial_sync_run_items: toNumber(row?.trial_sync_run_items),
    trial_market_actions: toNumber(row?.trial_market_actions),
    trial_market_positions: toNumber(row?.trial_market_positions),
    trial_model_decision_snapshots: toNumber(row?.trial_model_decision_snapshots),
    trial_market_run_logs: toNumber(row?.trial_market_run_logs),
  }
}

function getPreconditionViolations(counts: TargetTrialNamespaceCounts) {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
}

async function loadUserMaps(sql: postgres.Sql) {
  const rows = await sql<{ id: string; email: string | null }[]>`
    select id, email
    from users
  `

  return {
    userIds: new Set(rows.map((row) => row.id)),
    userIdByEmail: new Map(
      rows
        .filter((row): row is { id: string; email: string } => typeof row.email === 'string' && row.email.trim().length > 0)
        .map((row) => [row.email, row.id]),
    ),
  }
}

async function upsertTrialMonitorConfig(
  tx: postgres.Sql,
  row: TrialMonitorConfigBundleRow,
  targetHasWebSearchEnabled: boolean,
) {
  if (targetHasWebSearchEnabled) {
    await tx`
      insert into trial_monitor_configs (
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
      )
      values (
        ${row.id},
        ${row.enabled},
        ${row.web_search_enabled ?? true},
        ${row.run_interval_hours},
        ${row.lookahead_days},
        ${row.overdue_recheck_hours},
        ${row.max_questions_per_run},
        ${row.verifier_model_key},
        ${row.min_candidate_confidence},
        ${row.created_at},
        ${row.updated_at}
      )
      on conflict (id) do update
      set
        enabled = ${row.enabled},
        web_search_enabled = ${row.web_search_enabled ?? true},
        run_interval_hours = ${row.run_interval_hours},
        lookahead_days = ${row.lookahead_days},
        overdue_recheck_hours = ${row.overdue_recheck_hours},
        max_questions_per_run = ${row.max_questions_per_run},
        verifier_model_key = ${row.verifier_model_key},
        min_candidate_confidence = ${row.min_candidate_confidence},
        updated_at = ${row.updated_at}
    `
    return
  }

  await tx`
    insert into trial_monitor_configs (
      id,
      enabled,
      run_interval_hours,
      lookahead_days,
      overdue_recheck_hours,
      max_questions_per_run,
      verifier_model_key,
      min_candidate_confidence,
      created_at,
      updated_at
    )
    values (
      ${row.id},
      ${row.enabled},
      ${row.run_interval_hours},
      ${row.lookahead_days},
      ${row.overdue_recheck_hours},
      ${row.max_questions_per_run},
      ${row.verifier_model_key},
      ${row.min_candidate_confidence},
      ${row.created_at},
      ${row.updated_at}
    )
    on conflict (id) do update
    set
      enabled = ${row.enabled},
      run_interval_hours = ${row.run_interval_hours},
      lookahead_days = ${row.lookahead_days},
      overdue_recheck_hours = ${row.overdue_recheck_hours},
      max_questions_per_run = ${row.max_questions_per_run},
      verifier_model_key = ${row.verifier_model_key},
      min_candidate_confidence = ${row.min_candidate_confidence},
      updated_at = ${row.updated_at}
  `
}

async function upsertTrialSyncConfig(tx: postgres.Sql, row: TrialSyncConfigBundleRow) {
  await tx`
    insert into trial_sync_configs (
      id,
      enabled,
      sync_interval_hours,
      recent_completion_lookback_days,
      reconcile_interval_hours,
      last_successful_update_post_date,
      last_successful_data_timestamp,
      created_at,
      updated_at
    )
    values (
      ${row.id},
      ${row.enabled},
      ${row.sync_interval_hours},
      ${row.recent_completion_lookback_days},
      ${row.reconcile_interval_hours},
      ${row.last_successful_update_post_date},
      ${row.last_successful_data_timestamp},
      ${row.created_at},
      ${row.updated_at}
    )
    on conflict (id) do update
    set
      enabled = ${row.enabled},
      sync_interval_hours = ${row.sync_interval_hours},
      recent_completion_lookback_days = ${row.recent_completion_lookback_days},
      reconcile_interval_hours = ${row.reconcile_interval_hours},
      last_successful_update_post_date = ${row.last_successful_update_post_date},
      last_successful_data_timestamp = ${row.last_successful_data_timestamp},
      updated_at = ${row.updated_at}
  `
}

async function ensureModelActorsAccountsAndPositions(
  tx: postgres.Sql,
  marketIds: string[],
) {
  const createdAt = new Date().toISOString()

  for (const modelId of ALL_MODEL_IDS) {
    await tx`
      insert into market_actors (
        id,
        actor_type,
        model_key,
        display_name,
        created_at,
        updated_at
      )
      values (
        ${crypto.randomUUID()},
        'model',
        ${modelId},
        ${modelId},
        ${createdAt},
        ${createdAt}
      )
      on conflict (model_key) do nothing
    `
  }

  const modelActorRows = await tx<{ id: string; model_key: string | null }[]>`
    select id, model_key
    from market_actors
    where actor_type = 'model'
      and model_key is not null
    order by model_key
  `

  const actorIdByModelKey = new Map(
    modelActorRows
      .filter((row): row is { id: string; model_key: string } => typeof row.model_key === 'string')
      .map((row) => [row.model_key, row.id]),
  )

  for (const modelId of ALL_MODEL_IDS) {
    const actorId = actorIdByModelKey.get(modelId)
    if (!actorId) {
      throw new Error(`Missing model actor after upsert for ${modelId}`)
    }

    await tx`
      insert into market_accounts (
        id,
        actor_id,
        starting_cash,
        cash_balance,
        created_at,
        updated_at
      )
      values (
        ${crypto.randomUUID()},
        ${actorId},
        ${MARKET_STARTING_CASH},
        ${MARKET_STARTING_CASH},
        ${createdAt},
        ${createdAt}
      )
      on conflict (actor_id) do nothing
    `
  }

  let positionsEnsured = 0
  for (const marketId of marketIds) {
    for (const modelId of ALL_MODEL_IDS) {
      const actorId = actorIdByModelKey.get(modelId)
      if (!actorId) continue

      await tx`
        insert into market_positions (
          id,
          market_id,
          actor_id,
          created_at,
          updated_at
        )
        values (
          ${crypto.randomUUID()},
          ${marketId},
          ${actorId},
          ${createdAt},
          ${createdAt}
        )
        on conflict (market_id, actor_id) do nothing
      `
      positionsEnsured += 1
    }
  }

  return {
    activeModelIds: [...ALL_MODEL_IDS],
    marketPositionsEnsured: positionsEnsured,
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const args = parseArgs(process.argv.slice(2))
  if (!args.inputFile) {
    throw new Error('Usage: npx tsx scripts/import-trial-public-state.ts --input-file /absolute/path/to/trial-public-state.json [--apply]')
  }

  const bundle = await loadTrialPublicStateBundle(args.inputFile)
  if (bundle.metadata.schema_version !== TRIAL_PUBLIC_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported bundle schema version ${bundle.metadata.schema_version}`)
  }

  const bundleCounts = computeTrialPublicStateCounts(bundle)
  const countMismatch = JSON.stringify(bundle.metadata.counts) !== JSON.stringify(bundleCounts)
  if (countMismatch) {
    throw new Error('Bundle metadata counts do not match the bundle contents')
  }

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    const [targetHasWebSearchEnabled, targetCounts, userMaps] = await Promise.all([
      hasColumn(sql, 'trial_monitor_configs', 'web_search_enabled'),
      loadTargetTrialNamespaceCounts(sql),
      loadUserMaps(sql),
    ])

    const preconditionViolations = getPreconditionViolations(targetCounts)
    const referencedReviewedUserEmails = Array.from(
      new Set(
        bundle.trialOutcomeCandidates
          .map((candidate) => candidate.reviewed_by_user_email?.trim() || null)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort()
    const unresolvedReviewedUserEmails = referencedReviewedUserEmails.filter((email) => !userMaps.userIdByEmail.has(email))
    const expectedTrialMarketPositions = bundle.trialMarkets.length * ALL_MODEL_IDS.length

    if (!args.apply) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        inputFile: args.inputFile,
        bundleCounts,
        targetCounts,
        targetHasWebSearchEnabled,
        currentCodeModelIds: [...ALL_MODEL_IDS],
        expectedTrialMarketPositions,
        reviewedUserEmails: {
          referenced: referencedReviewedUserEmails,
          unresolved: unresolvedReviewedUserEmails,
        },
        readyToApply: preconditionViolations.length === 0,
        preconditionViolations,
      }, null, 2))
      return
    }

    if (preconditionViolations.length > 0) {
      throw new Error(`Target trial namespace is not empty: ${preconditionViolations.join(', ')}`)
    }

    const reviewUserIdByCandidateId = new Map<string, string | null>()
    for (const candidate of bundle.trialOutcomeCandidates) {
      const reviewedByEmail = candidate.reviewed_by_user_email?.trim() || null
      if (reviewedByEmail) {
        reviewUserIdByCandidateId.set(candidate.id, userMaps.userIdByEmail.get(reviewedByEmail) ?? null)
        continue
      }

      if (candidate.reviewed_by_user_id && userMaps.userIds.has(candidate.reviewed_by_user_id)) {
        reviewUserIdByCandidateId.set(candidate.id, candidate.reviewed_by_user_id)
        continue
      }

      reviewUserIdByCandidateId.set(candidate.id, null)
    }

    const backfillSummary = await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql
      await upsertTrialMonitorConfig(tx, bundle.trialMonitorConfig, targetHasWebSearchEnabled)
      await upsertTrialSyncConfig(tx, bundle.trialSyncConfig)

      for (const row of bundle.phase2Trials) {
        await tx`
          insert into phase2_trials (
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
          )
          values (
            ${row.id},
            ${row.nct_number},
            ${row.short_title},
            ${row.sponsor_name},
            ${row.sponsor_ticker},
            ${row.indication},
            ${row.exact_phase},
            ${row.intervention},
            ${row.primary_endpoint},
            ${row.study_start_date},
            ${row.est_primary_completion_date},
            ${row.est_study_completion_date},
            ${row.est_results_posting_date},
            ${row.current_status},
            ${row.est_enrollment},
            ${row.key_locations},
            ${row.brief_summary},
            ${row.standard_betting_markets},
            ${row.last_monitored_at},
            ${row.created_at},
            ${row.updated_at}
          )
        `
      }

      for (const row of bundle.trialQuestions) {
        await tx`
          insert into trial_questions (
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
          )
          values (
            ${row.id},
            ${row.trial_id},
            ${row.slug},
            ${row.prompt},
            ${row.status},
            ${row.is_bettable},
            ${row.sort_order},
            ${row.outcome},
            ${row.outcome_date},
            ${row.created_at},
            ${row.updated_at}
          )
        `
      }

      for (const row of bundle.trialMarkets) {
        await tx`
          insert into prediction_markets (
            id,
            fda_event_id,
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
          )
          values (
            ${row.id},
            ${null},
            ${row.trial_question_id},
            ${row.status},
            ${row.opening_probability},
            ${row.b},
            ${row.q_yes},
            ${row.q_no},
            ${row.price_yes},
            ${row.opened_at},
            ${row.resolved_at},
            ${row.resolved_outcome},
            ${row.created_at},
            ${row.updated_at}
          )
        `
      }

      for (const row of bundle.trialMarketPriceSnapshots) {
        await tx`
          insert into market_price_snapshots (
            id,
            market_id,
            snapshot_date,
            price_yes,
            q_yes,
            q_no,
            created_at
          )
          values (
            ${row.id},
            ${row.market_id},
            ${row.snapshot_date},
            ${row.price_yes},
            ${row.q_yes},
            ${row.q_no},
            ${row.created_at}
          )
        `
      }

      for (const row of bundle.trialMonitorRuns) {
        await tx`
          insert into trial_monitor_runs (
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
          )
          values (
            ${row.id},
            ${row.trigger_source},
            ${row.status},
            ${row.questions_scanned},
            ${row.candidates_created},
            ${row.error_summary},
            ${row.debug_log},
            ${row.started_at},
            ${row.completed_at},
            ${row.updated_at}
          )
        `
      }

      for (const row of bundle.trialOutcomeCandidates) {
        await tx`
          insert into trial_outcome_candidates (
            id,
            trial_question_id,
            proposed_outcome,
            proposed_outcome_date,
            confidence,
            summary,
            verifier_model_key,
            provider_response_id,
            evidence_hash,
            status,
            reviewed_by_user_id,
            review_notes,
            created_at,
            updated_at,
            reviewed_at
          )
          values (
            ${row.id},
            ${row.trial_question_id},
            ${row.proposed_outcome},
            ${row.proposed_outcome_date},
            ${row.confidence},
            ${row.summary},
            ${row.verifier_model_key},
            ${row.provider_response_id},
            ${row.evidence_hash},
            ${row.status},
            ${reviewUserIdByCandidateId.get(row.id) ?? null},
            ${row.review_notes},
            ${row.created_at},
            ${row.updated_at},
            ${row.reviewed_at}
          )
        `
      }

      for (const row of bundle.trialOutcomeCandidateEvidence) {
        await tx`
          insert into trial_outcome_candidate_evidence (
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
          )
          values (
            ${row.id},
            ${row.candidate_id},
            ${row.source_type},
            ${row.title},
            ${row.url},
            ${row.published_at},
            ${row.excerpt},
            ${row.domain},
            ${row.display_order},
            ${row.created_at}
          )
        `
      }

      return ensureModelActorsAccountsAndPositions(
        tx,
        bundle.trialMarkets.map((row) => row.id),
      )
    })

    const finalCounts = await loadTargetTrialNamespaceCounts(sql)
    console.log(JSON.stringify({
      mode: 'apply',
      inputFile: args.inputFile,
      importedCounts: bundleCounts,
      finalCounts,
      currentCodeModelIds: backfillSummary.activeModelIds,
      expectedTrialMarketPositions,
      reviewedUserEmails: {
        referenced: referencedReviewedUserEmails,
        unresolved: unresolvedReviewedUserEmails,
      },
      marketPositionsEnsured: backfillSummary.marketPositionsEnsured,
    }, null, 2))
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
