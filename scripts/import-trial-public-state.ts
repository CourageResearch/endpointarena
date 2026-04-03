import dotenv from 'dotenv'
import postgres from 'postgres'
import { AI_COST_SOURCES } from '../lib/ai-costs'
import { ALL_MODEL_IDS } from '../lib/constants'
import { MARKET_STARTING_CASH } from '../lib/markets/constants'
import {
  computeTrialPublicStateCounts,
  loadTrialPublicStateBundle,
  sanitizeForJson,
  type Phase2TrialBundleRow,
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
  type TrialPublicStateCounts,
  TRIAL_PUBLIC_STATE_SCHEMA_VERSION,
  type TrialQuestionBundleRow,
  type TrialQuestionOutcomeHistoryBundleRow,
  type TrialSyncConfigBundleRow,
  type TrialSyncRunBundleRow,
  type TrialSyncRunItemBundleRow,
} from './trial-public-state-utils'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  inputFile: string | null
  apply: boolean
  databaseUrl: string | null
}

type UserMaps = {
  userIds: Set<string>
  userIdByEmail: Map<string, string>
}

type QuestionStateRow = {
  nct_number: string
  slug: string
  outcome: string
  outcome_date: string | null
}

type TrialRunInfo = {
  trialRunIds: string[]
  sharedTrialRunIds: string[]
}

type HumanTrialState = {
  actionCount: number
  positionCount: number
  nonzeroPositionCount: number
}

type ModelCashDeltaRow = {
  modelKey: string
  sourceTrialCashEffect: number
  targetTrialCashEffect: number
  delta: number
}

type ModelAccountRow = {
  actor_id: string
  model_key: string
  cash_balance: number
  starting_cash: number
}

type EnsureTargetModelActorsResult = {
  sourceActorIdToTargetActorId: Map<string, string>
  targetActorIdByModelKey: Map<string, string>
}

const CASH_DELTA_EPSILON = 0.01
const BULK_INSERT_CHUNK_SIZE = 200
const BULK_SNAPSHOT_INSERT_CHUNK_SIZE = 50

function parseArgs(argv: string[]): ParsedArgs {
  let inputFile: string | null = null
  let apply = false
  let databaseUrl: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input-file') {
      inputFile = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--database-url') {
      databaseUrl = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--apply') {
      apply = true
    }
  }

  return { inputFile, apply, databaseUrl }
}

function resolveConnectionString(args: ParsedArgs): string {
  const connectionString =
    args.databaseUrl?.trim() ||
    process.env.TARGET_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim()

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Pass --database-url or set TARGET_DATABASE_URL/DATABASE_URL.')
  }

  return connectionString
}

function toNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0)
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toIsoTimestamp(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim().length > 0) return value
  return null
}

function roundCash(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) {
    return []
  }

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function isYesResolvingOutcome(outcome: string | null | undefined): boolean {
  return outcome === 'Approved' || outcome === 'YES'
}

function getActionCashDelta(row: { action: string; status: string; usd_amount: number }): number {
  if (row.status !== 'ok') return 0
  if (row.action === 'BUY_YES' || row.action === 'BUY_NO') return -row.usd_amount
  if (row.action === 'SELL_YES' || row.action === 'SELL_NO') return row.usd_amount
  return 0
}

function mergeModelCashEffects(input: {
  source: Map<string, number>
  target: Map<string, number>
}): ModelCashDeltaRow[] {
  const keys = new Set<string>([
    ...ALL_MODEL_IDS,
    ...input.source.keys(),
    ...input.target.keys(),
  ])

  return Array.from(keys)
    .sort((left, right) => left.localeCompare(right))
    .map((modelKey) => {
      const sourceTrialCashEffect = roundCash(input.source.get(modelKey) ?? 0)
      const targetTrialCashEffect = roundCash(input.target.get(modelKey) ?? 0)
      return {
        modelKey,
        sourceTrialCashEffect,
        targetTrialCashEffect,
        delta: (() => {
          const rawDelta = roundCash(sourceTrialCashEffect - targetTrialCashEffect)
          return Math.abs(rawDelta) < CASH_DELTA_EPSILON ? 0 : rawDelta
        })(),
      }
    })
}

function resolveTargetUserId(input: {
  sourceUserId: string | null | undefined
  sourceUserEmail: string | null | undefined
  userMaps: UserMaps
}): string | null {
  const normalizedEmail = normalizeEmail(input.sourceUserEmail)
  if (normalizedEmail) {
    return input.userMaps.userIdByEmail.get(normalizedEmail) ?? null
  }

  if (input.sourceUserId && input.userMaps.userIds.has(input.sourceUserId)) {
    return input.sourceUserId
  }

  return null
}

async function hasColumn(sql: postgres.Sql, tableName: string, columnName: string): Promise<boolean> {
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

async function loadSupportedModelDecisionSnapshotCostSources(sql: postgres.Sql): Promise<Set<string>> {
  const [row] = await sql<{ definition: string | null }[]>`
    select pg_get_constraintdef(constraint_oid, true) as definition
    from (
      select c.oid as constraint_oid
      from pg_constraint c
      inner join pg_class t on t.oid = c.conrelid
      inner join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'model_decision_snapshots'
        and c.conname = 'model_decision_snapshots_cost_source_check'
    ) constraints
  `

  if (!row?.definition) {
    return new Set(AI_COST_SOURCES)
  }

  const supported = new Set<string>()
  for (const costSource of AI_COST_SOURCES) {
    if (row.definition.includes(`'${costSource}'`)) {
      supported.add(costSource)
    }
  }

  return supported.size > 0 ? supported : new Set(AI_COST_SOURCES)
}

function normalizeModelDecisionSnapshotCostSource(
  costSource: string | null | undefined,
  supportedCostSources: Set<string>,
): string | null {
  const normalized = typeof costSource === 'string' && costSource.trim().length > 0
    ? costSource.trim()
    : null

  if (normalized === null || supportedCostSources.has(normalized)) {
    return normalized
  }

  if (normalized === 'subscription' && supportedCostSources.has('estimated')) {
    return 'estimated'
  }

  throw new Error(`Target does not support model_decision_snapshots.cost_source='${normalized}'`)
}

function summarizeNormalizedModelDecisionSnapshotCostSources(
  rows: TrialModelDecisionSnapshotBundleRow[],
  supportedCostSources: Set<string>,
): Array<{ from: string; to: string; count: number }> {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const normalized = typeof row.cost_source === 'string' && row.cost_source.trim().length > 0
      ? row.cost_source.trim()
      : null
    if (normalized === null || supportedCostSources.has(normalized)) {
      continue
    }

    const mappedTo = normalizeModelDecisionSnapshotCostSource(normalized, supportedCostSources)
    if (mappedTo === normalized || mappedTo === null) {
      continue
    }

    const key = `${normalized}->${mappedTo}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [from, to] = key.split('->')
      return { from, to, count }
    })
}

async function loadUserMaps(sql: postgres.Sql): Promise<UserMaps> {
  const rows = await sql<{ id: string; email: string | null }[]>`
    select id, email
    from users
  `

  return {
    userIds: new Set(rows.map((row) => row.id)),
    userIdByEmail: new Map(
      rows
        .map((row) => {
          const email = normalizeEmail(row.email)
          return email ? [email, row.id] as const : null
        })
        .filter((row): row is readonly [string, string] => row !== null),
    ),
  }
}

async function loadTargetTrialNamespaceCounts(sql: postgres.Sql): Promise<TrialPublicStateCounts> {
  const [row] = await sql<{
    phase2_trials: string | number
    trial_questions: string | number
    question_outcome_pending: string | number
    question_outcome_yes: string | number
    question_outcome_no: string | number
    trial_markets: string | number
    open_trial_markets: string | number
    resolved_trial_markets: string | number
    trial_market_price_snapshots: string | number
    trial_outcome_candidates: string | number
    pending_review_candidates: string | number
    dismissed_candidates: string | number
    accepted_candidates: string | number
    trial_outcome_candidate_evidence: string | number
    trial_monitor_runs: string | number
    trial_question_outcome_history: string | number
    trial_sync_runs: string | number
    trial_sync_run_items: string | number
    trial_market_runs: string | number
    trial_market_run_logs: string | number
    trial_market_actions: string | number
    trial_model_decision_snapshots: string | number
    trial_market_positions: string | number
  }[]>`
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
    trial_market_run_logs_filtered as (
      select mrl.id
      from market_run_logs mrl
      join trial_run_ids tri on tri.id = mrl.run_id
      left join market_actors actor on actor.id = mrl.actor_id
      where mrl.actor_id is null or actor.actor_type = 'model'
    )
    select
      (select count(*)::bigint from phase2_trials) as phase2_trials,
      (select count(*)::bigint from trial_questions) as trial_questions,
      (select count(*)::bigint from trial_questions where outcome = 'Pending') as question_outcome_pending,
      (select count(*)::bigint from trial_questions where outcome = 'YES') as question_outcome_yes,
      (select count(*)::bigint from trial_questions where outcome = 'NO') as question_outcome_no,
      (select count(*)::bigint from prediction_markets where trial_question_id is not null) as trial_markets,
      (
        select count(*)::bigint
        from prediction_markets
        where trial_question_id is not null
          and status = 'OPEN'
      ) as open_trial_markets,
      (
        select count(*)::bigint
        from prediction_markets
        where trial_question_id is not null
          and status = 'RESOLVED'
      ) as resolved_trial_markets,
      (
        select count(*)::bigint
        from market_price_snapshots mps
        join prediction_markets pm on pm.id = mps.market_id
        where pm.trial_question_id is not null
      ) as trial_market_price_snapshots,
      (select count(*)::bigint from trial_outcome_candidates) as trial_outcome_candidates,
      (
        select count(*)::bigint
        from trial_outcome_candidates
        where status = 'pending_review'
      ) as pending_review_candidates,
      (
        select count(*)::bigint
        from trial_outcome_candidates
        where status = 'dismissed'
      ) as dismissed_candidates,
      (
        select count(*)::bigint
        from trial_outcome_candidates
        where status = 'accepted'
      ) as accepted_candidates,
      (select count(*)::bigint from trial_outcome_candidate_evidence) as trial_outcome_candidate_evidence,
      (select count(*)::bigint from trial_monitor_runs) as trial_monitor_runs,
      (select count(*)::bigint from trial_question_outcome_history) as trial_question_outcome_history,
      (select count(*)::bigint from trial_sync_runs) as trial_sync_runs,
      (select count(*)::bigint from trial_sync_run_items) as trial_sync_run_items,
      (
        select count(*)::bigint
        from market_runs mr
        join trial_run_ids tri on tri.id = mr.id
      ) as trial_market_runs,
      (select count(*)::bigint from trial_market_run_logs_filtered) as trial_market_run_logs,
      (
        select count(*)::bigint
        from market_actions ma
        join market_actors actor on actor.id = ma.actor_id
        where ma.trial_question_id is not null
          and actor.actor_type = 'model'
      ) as trial_market_actions,
      (
        select count(*)::bigint
        from model_decision_snapshots mds
        join market_actors actor on actor.id = mds.actor_id
        where mds.trial_question_id is not null
          and actor.actor_type = 'model'
      ) as trial_model_decision_snapshots,
      (
        select count(*)::bigint
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        join market_actors actor on actor.id = mp.actor_id
        where pm.trial_question_id is not null
          and actor.actor_type = 'model'
      ) as trial_market_positions
  `

  return {
    phase2_trials: toNumber(row?.phase2_trials),
    trial_questions: toNumber(row?.trial_questions),
    question_outcome_pending: toNumber(row?.question_outcome_pending),
    question_outcome_yes: toNumber(row?.question_outcome_yes),
    question_outcome_no: toNumber(row?.question_outcome_no),
    trial_markets: toNumber(row?.trial_markets),
    open_trial_markets: toNumber(row?.open_trial_markets),
    resolved_trial_markets: toNumber(row?.resolved_trial_markets),
    trial_market_price_snapshots: toNumber(row?.trial_market_price_snapshots),
    trial_outcome_candidates: toNumber(row?.trial_outcome_candidates),
    pending_review_candidates: toNumber(row?.pending_review_candidates),
    dismissed_candidates: toNumber(row?.dismissed_candidates),
    accepted_candidates: toNumber(row?.accepted_candidates),
    trial_outcome_candidate_evidence: toNumber(row?.trial_outcome_candidate_evidence),
    trial_monitor_runs: toNumber(row?.trial_monitor_runs),
    trial_question_outcome_history: toNumber(row?.trial_question_outcome_history),
    trial_sync_runs: toNumber(row?.trial_sync_runs),
    trial_sync_run_items: toNumber(row?.trial_sync_run_items),
    trial_market_runs: toNumber(row?.trial_market_runs),
    trial_market_run_logs: toNumber(row?.trial_market_run_logs),
    trial_market_actions: toNumber(row?.trial_market_actions),
    trial_model_decision_snapshots: toNumber(row?.trial_model_decision_snapshots),
    trial_market_positions: toNumber(row?.trial_market_positions),
  }
}

async function loadTargetNctNumbers(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ nct_number: string }[]>`
    select nct_number
    from phase2_trials
    order by nct_number
  `

  return rows.map((row) => row.nct_number)
}

function buildSourceQuestionStateRows(bundle: TrialPublicStateBundle): QuestionStateRow[] {
  const nctByTrialId = new Map(bundle.phase2Trials.map((trial) => [trial.id, trial.nct_number]))

  return bundle.trialQuestions
    .map((question) => ({
      nct_number: nctByTrialId.get(question.trial_id) ?? 'UNKNOWN_TRIAL',
      slug: question.slug,
      outcome: question.outcome,
      outcome_date: toIsoTimestamp(question.outcome_date),
    }))
    .sort((left, right) => {
      const nctCompare = left.nct_number.localeCompare(right.nct_number)
      if (nctCompare !== 0) return nctCompare
      return left.slug.localeCompare(right.slug)
    })
}

async function loadTargetQuestionStateRows(sql: postgres.Sql): Promise<QuestionStateRow[]> {
  const rows = await sql<{
    nct_number: string
    slug: string
    outcome: string
    outcome_date: Date | string | null
  }[]>`
    select
      pt.nct_number,
      tq.slug,
      tq.outcome,
      tq.outcome_date
    from trial_questions tq
    join phase2_trials pt on pt.id = tq.trial_id
    order by pt.nct_number, tq.slug
  `

  return rows.map((row) => ({
    nct_number: row.nct_number,
    slug: row.slug,
    outcome: row.outcome,
    outcome_date: toIsoTimestamp(row.outcome_date),
  }))
}

function diffQuestionStates(sourceRows: QuestionStateRow[], targetRows: QuestionStateRow[]) {
  const sourceByKey = new Map(sourceRows.map((row) => [`${row.nct_number}::${row.slug}`, row]))
  const targetByKey = new Map(targetRows.map((row) => [`${row.nct_number}::${row.slug}`, row]))
  const keys = new Set<string>([...sourceByKey.keys(), ...targetByKey.keys()])

  return Array.from(keys)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const source = sourceByKey.get(key) ?? null
      const target = targetByKey.get(key) ?? null
      const sourceOutcome = source?.outcome ?? null
      const sourceOutcomeDate = source?.outcome_date ?? null
      const targetOutcome = target?.outcome ?? null
      const targetOutcomeDate = target?.outcome_date ?? null

      if (sourceOutcome === targetOutcome && sourceOutcomeDate === targetOutcomeDate) {
        return null
      }

      const [nctNumber, slug] = key.split('::')
      return {
        nctNumber,
        slug,
        sourceOutcome,
        sourceOutcomeDate,
        targetOutcome,
        targetOutcomeDate,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
}

async function loadTargetTrialRunInfo(sql: postgres.Sql): Promise<TrialRunInfo> {
  const [trialRunRows, sharedRunRows] = await Promise.all([
    sql<{ id: string }[]>`
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
      select id
      from trial_run_ids
      order by id
    `,
    sql<{ id: string }[]>`
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
      select tri.id
      from trial_run_ids tri
      where exists (
        select 1
        from market_actions ma
        where ma.run_id = tri.id
          and ma.trial_question_id is null
          and ma.fda_event_id is not null
      )
      or exists (
        select 1
        from model_decision_snapshots mds
        where mds.run_id = tri.id
          and mds.trial_question_id is null
          and mds.fda_event_id is not null
      )
      or exists (
        select 1
        from market_run_logs mrl
        left join prediction_markets pm on pm.id = mrl.market_id
        where mrl.run_id = tri.id
          and (
            mrl.fda_event_id is not null
            or pm.fda_event_id is not null
          )
      )
      order by tri.id
    `,
  ])

  return {
    trialRunIds: trialRunRows.map((row) => row.id),
    sharedTrialRunIds: sharedRunRows.map((row) => row.id),
  }
}

async function loadTargetHumanTrialState(sql: postgres.Sql): Promise<HumanTrialState> {
  const [row] = await sql<{
    action_count: string | number
    position_count: string | number
    nonzero_position_count: string | number
  }[]>`
    select
      (
        select count(*)::bigint
        from market_actions ma
        join market_actors actor on actor.id = ma.actor_id
        where ma.trial_question_id is not null
          and actor.actor_type = 'human'
      ) as action_count,
      (
        select count(*)::bigint
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        join market_actors actor on actor.id = mp.actor_id
        where pm.trial_question_id is not null
          and actor.actor_type = 'human'
      ) as position_count,
      (
        select count(*)::bigint
        from market_positions mp
        join prediction_markets pm on pm.id = mp.market_id
        join market_actors actor on actor.id = mp.actor_id
        where pm.trial_question_id is not null
          and actor.actor_type = 'human'
          and (abs(mp.yes_shares) > 1e-9 or abs(mp.no_shares) > 1e-9)
      ) as nonzero_position_count
  `

  return {
    actionCount: toNumber(row?.action_count),
    positionCount: toNumber(row?.position_count),
    nonzeroPositionCount: toNumber(row?.nonzero_position_count),
  }
}

async function loadTargetModelCashEffects(sql: postgres.Sql): Promise<Map<string, number>> {
  const rows = await sql<{ model_key: string; trial_cash_effect: number | string | null }[]>`
    with action_cash as (
      select
        actor.model_key,
        sum(
          case
            when ma.status = 'ok' and ma.action in ('BUY_YES', 'BUY_NO') then -ma.usd_amount
            when ma.status = 'ok' and ma.action in ('SELL_YES', 'SELL_NO') then ma.usd_amount
            else 0
          end
        ) as trial_cash_effect
      from market_actions ma
      join market_actors actor on actor.id = ma.actor_id
      where ma.trial_question_id is not null
        and actor.actor_type = 'model'
        and actor.model_key is not null
      group by actor.model_key
    ),
    payout_cash as (
      select
        actor.model_key,
        sum(
          case
            when pm.status = 'RESOLVED' and pm.resolved_outcome in ('Approved', 'YES') then mp.yes_shares
            when pm.status = 'RESOLVED' and pm.resolved_outcome in ('Rejected', 'NO') then mp.no_shares
            else 0
          end
        ) as trial_cash_effect
      from market_positions mp
      join prediction_markets pm on pm.id = mp.market_id
      join market_actors actor on actor.id = mp.actor_id
      where pm.trial_question_id is not null
        and actor.actor_type = 'model'
        and actor.model_key is not null
      group by actor.model_key
    ),
    model_keys as (
      select model_key from action_cash
      union
      select model_key from payout_cash
      union
      select model_key
      from market_actors
      where actor_type = 'model'
        and model_key is not null
    )
    select
      mk.model_key,
      coalesce(ac.trial_cash_effect, 0) + coalesce(pc.trial_cash_effect, 0) as trial_cash_effect
    from model_keys mk
    left join action_cash ac on ac.model_key = mk.model_key
    left join payout_cash pc on pc.model_key = mk.model_key
    order by mk.model_key
  `

  return new Map(
    rows.map((row) => [row.model_key, roundCash(toNumber(row.trial_cash_effect))]),
  )
}

async function loadTargetModelAccountRows(sql: postgres.Sql): Promise<ModelAccountRow[]> {
  const rows = await sql<{
    actor_id: string
    model_key: string
    cash_balance: string | number
    starting_cash: string | number
  }[]>`
    select
      actor.id as actor_id,
      actor.model_key,
      account.cash_balance,
      account.starting_cash
    from market_accounts account
    join market_actors actor on actor.id = account.actor_id
    where actor.actor_type = 'model'
      and actor.model_key is not null
    order by actor.model_key
  `

  return rows.map((row) => ({
    actor_id: row.actor_id,
    model_key: row.model_key,
    cash_balance: toNumber(row.cash_balance),
    starting_cash: toNumber(row.starting_cash),
  }))
}

function validateBundleIntegrity(bundle: TrialPublicStateBundle): string[] {
  const errors: string[] = []

  const trialIds = new Set(bundle.phase2Trials.map((row) => row.id))
  const questionIds = new Set(bundle.trialQuestions.map((row) => row.id))
  const marketIds = new Set(bundle.trialMarkets.map((row) => row.id))
  const candidateIds = new Set(bundle.trialOutcomeCandidates.map((row) => row.id))
  const syncRunIds = new Set(bundle.trialSyncRuns.map((row) => row.id))
  const trialRunIds = new Set(bundle.trialMarketRuns.map((row) => row.id))
  const actionIds = new Set(bundle.trialMarketActions.map((row) => row.id))

  const actorIdSet = new Set<string>()
  const modelKeySet = new Set<string>()
  for (const actor of bundle.modelActors) {
    if (!actor.actor_id) {
      errors.push('Bundle modelActors contains an empty actor_id')
    }
    if (!actor.model_key) {
      errors.push(`Bundle model actor ${actor.actor_id} is missing model_key`)
    }
    if (actorIdSet.has(actor.actor_id)) {
      errors.push(`Bundle modelActors contains duplicate actor_id ${actor.actor_id}`)
    }
    if (modelKeySet.has(actor.model_key)) {
      errors.push(`Bundle modelActors contains duplicate model_key ${actor.model_key}`)
    }
    actorIdSet.add(actor.actor_id)
    modelKeySet.add(actor.model_key)
  }

  for (const row of bundle.trialQuestions) {
    if (!trialIds.has(row.trial_id)) {
      errors.push(`trial_questions.${row.id} references missing trial_id ${row.trial_id}`)
    }
  }

  for (const row of bundle.trialMarkets) {
    if (!questionIds.has(row.trial_question_id)) {
      errors.push(`trial_markets.${row.id} references missing trial_question_id ${row.trial_question_id}`)
    }
  }

  for (const row of bundle.trialMarketPriceSnapshots) {
    if (!marketIds.has(row.market_id)) {
      errors.push(`trial_market_price_snapshots.${row.id} references missing market_id ${row.market_id}`)
    }
  }

  for (const row of bundle.trialOutcomeCandidates) {
    if (!questionIds.has(row.trial_question_id)) {
      errors.push(`trial_outcome_candidates.${row.id} references missing trial_question_id ${row.trial_question_id}`)
    }
  }

  for (const row of bundle.trialOutcomeCandidateEvidence) {
    if (!candidateIds.has(row.candidate_id)) {
      errors.push(`trial_outcome_candidate_evidence.${row.id} references missing candidate_id ${row.candidate_id}`)
    }
  }

  for (const row of bundle.trialQuestionOutcomeHistory) {
    if (!questionIds.has(row.trial_question_id)) {
      errors.push(`trial_question_outcome_history.${row.id} references missing trial_question_id ${row.trial_question_id}`)
    }
    if (row.review_candidate_id && !candidateIds.has(row.review_candidate_id)) {
      errors.push(`trial_question_outcome_history.${row.id} references missing review_candidate_id ${row.review_candidate_id}`)
    }
  }

  for (const row of bundle.trialSyncRunItems) {
    if (!syncRunIds.has(row.run_id)) {
      errors.push(`trial_sync_run_items.${row.id} references missing run_id ${row.run_id}`)
    }
    if (row.trial_id && !trialIds.has(row.trial_id)) {
      errors.push(`trial_sync_run_items.${row.id} references missing trial_id ${row.trial_id}`)
    }
  }

  for (const row of bundle.trialMarketActions) {
    if (row.run_id && !trialRunIds.has(row.run_id)) {
      errors.push(`trial_market_actions.${row.id} references missing run_id ${row.run_id}`)
    }
    if (!marketIds.has(row.market_id)) {
      errors.push(`trial_market_actions.${row.id} references missing market_id ${row.market_id}`)
    }
    if (row.trial_question_id && !questionIds.has(row.trial_question_id)) {
      errors.push(`trial_market_actions.${row.id} references missing trial_question_id ${row.trial_question_id}`)
    }
    if (!actorIdSet.has(row.actor_id)) {
      errors.push(`trial_market_actions.${row.id} references missing actor_id ${row.actor_id}`)
    }
  }

  for (const row of bundle.trialModelDecisionSnapshots) {
    if (row.run_id && !trialRunIds.has(row.run_id)) {
      errors.push(`trial_model_decision_snapshots.${row.id} references missing run_id ${row.run_id}`)
    }
    if (!marketIds.has(row.market_id)) {
      errors.push(`trial_model_decision_snapshots.${row.id} references missing market_id ${row.market_id}`)
    }
    if (row.trial_question_id && !questionIds.has(row.trial_question_id)) {
      errors.push(`trial_model_decision_snapshots.${row.id} references missing trial_question_id ${row.trial_question_id}`)
    }
    if (!actorIdSet.has(row.actor_id)) {
      errors.push(`trial_model_decision_snapshots.${row.id} references missing actor_id ${row.actor_id}`)
    }
    if (row.linked_market_action_id && !actionIds.has(row.linked_market_action_id)) {
      errors.push(
        `trial_model_decision_snapshots.${row.id} references missing linked_market_action_id ${row.linked_market_action_id}`,
      )
    }
  }

  for (const row of bundle.trialMarketRunLogs) {
    if (!trialRunIds.has(row.run_id)) {
      errors.push(`trial_market_run_logs.${row.id} references missing run_id ${row.run_id}`)
    }
    if (row.market_id && !marketIds.has(row.market_id)) {
      errors.push(`trial_market_run_logs.${row.id} references missing market_id ${row.market_id}`)
    }
    if (row.trial_question_id && !questionIds.has(row.trial_question_id)) {
      errors.push(`trial_market_run_logs.${row.id} references missing trial_question_id ${row.trial_question_id}`)
    }
    if (row.actor_id && !actorIdSet.has(row.actor_id)) {
      errors.push(`trial_market_run_logs.${row.id} references missing actor_id ${row.actor_id}`)
    }
  }

  for (const row of bundle.trialMarketPositions) {
    if (!marketIds.has(row.market_id)) {
      errors.push(`trial_market_positions.${row.id} references missing market_id ${row.market_id}`)
    }
    if (!actorIdSet.has(row.actor_id)) {
      errors.push(`trial_market_positions.${row.id} references missing actor_id ${row.actor_id}`)
    }
  }

  return Array.from(new Set(errors)).sort()
}

function computeBundleModelCashEffects(bundle: TrialPublicStateBundle): Map<string, number> {
  const actorModelKeyById = new Map(bundle.modelActors.map((row) => [row.actor_id, row.model_key]))
  const trialMarketById = new Map(bundle.trialMarkets.map((row) => [row.id, row]))
  const positionsByMarketId = new Map<string, TrialMarketPositionBundleRow[]>()
  const effectByModelKey = new Map<string, number>()

  for (const modelKey of ALL_MODEL_IDS) {
    effectByModelKey.set(modelKey, 0)
  }

  for (const actor of bundle.modelActors) {
    effectByModelKey.set(actor.model_key, effectByModelKey.get(actor.model_key) ?? 0)
  }

  for (const position of bundle.trialMarketPositions) {
    const current = positionsByMarketId.get(position.market_id) ?? []
    current.push(position)
    positionsByMarketId.set(position.market_id, current)
  }

  for (const action of bundle.trialMarketActions) {
    const modelKey = actorModelKeyById.get(action.actor_id)
    if (!modelKey) {
      throw new Error(`Bundle action ${action.id} references actor ${action.actor_id} without a model key`)
    }
    const current = effectByModelKey.get(modelKey) ?? 0
    effectByModelKey.set(modelKey, roundCash(current + getActionCashDelta(action)))
  }

  for (const market of bundle.trialMarkets) {
    if (market.status !== 'RESOLVED' || !market.resolved_outcome) continue

    const resolvesYes = isYesResolvingOutcome(market.resolved_outcome)
    const positions = positionsByMarketId.get(market.id) ?? []
    for (const position of positions) {
      const modelKey = actorModelKeyById.get(position.actor_id)
      if (!modelKey) {
        throw new Error(`Bundle position ${position.id} references actor ${position.actor_id} without a model key`)
      }
      const payout = resolvesYes ? position.yes_shares : position.no_shares
      const current = effectByModelKey.get(modelKey) ?? 0
      effectByModelKey.set(modelKey, roundCash(current + payout))
    }
  }

  for (const [marketId] of positionsByMarketId.entries()) {
    if (!trialMarketById.has(marketId)) {
      throw new Error(`Bundle contains positions for unknown market ${marketId}`)
    }
  }

  return effectByModelKey
}

async function upsertTrialMonitorConfig(
  tx: postgres.Sql,
  row: TrialMonitorConfigBundleRow,
  targetHasWebSearchEnabled: boolean,
): Promise<void> {
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
        enabled = excluded.enabled,
        web_search_enabled = excluded.web_search_enabled,
        run_interval_hours = excluded.run_interval_hours,
        lookahead_days = excluded.lookahead_days,
        overdue_recheck_hours = excluded.overdue_recheck_hours,
        max_questions_per_run = excluded.max_questions_per_run,
        verifier_model_key = excluded.verifier_model_key,
        min_candidate_confidence = excluded.min_candidate_confidence,
        updated_at = excluded.updated_at
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
      enabled = excluded.enabled,
      run_interval_hours = excluded.run_interval_hours,
      lookahead_days = excluded.lookahead_days,
      overdue_recheck_hours = excluded.overdue_recheck_hours,
      max_questions_per_run = excluded.max_questions_per_run,
      verifier_model_key = excluded.verifier_model_key,
      min_candidate_confidence = excluded.min_candidate_confidence,
      updated_at = excluded.updated_at
  `
}

async function upsertTrialSyncConfig(tx: postgres.Sql, row: TrialSyncConfigBundleRow): Promise<void> {
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
      enabled = excluded.enabled,
      sync_interval_hours = excluded.sync_interval_hours,
      recent_completion_lookback_days = excluded.recent_completion_lookback_days,
      reconcile_interval_hours = excluded.reconcile_interval_hours,
      last_successful_update_post_date = excluded.last_successful_update_post_date,
      last_successful_data_timestamp = excluded.last_successful_data_timestamp,
      updated_at = excluded.updated_at
  `
}

async function ensureTargetModelActorsAndAccounts(
  tx: postgres.Sql,
  bundleActors: TrialModelActorBundleRow[],
): Promise<EnsureTargetModelActorsResult> {
  const actorInputByModelKey = new Map<string, { displayName: string | null }>()

  for (const actor of bundleActors) {
    actorInputByModelKey.set(actor.model_key, {
      displayName: actor.display_name ?? actor.model_key,
    })
  }

  for (const modelKey of ALL_MODEL_IDS) {
    if (!actorInputByModelKey.has(modelKey)) {
      actorInputByModelKey.set(modelKey, { displayName: modelKey })
    }
  }

  const nowIso = new Date().toISOString()
  for (const [modelKey, input] of Array.from(actorInputByModelKey.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    await tx`
      insert into market_actors (
        id,
        actor_type,
        model_key,
        user_id,
        display_name,
        created_at,
        updated_at
      )
      values (
        ${crypto.randomUUID()},
        'model',
        ${modelKey},
        ${null},
        ${input.displayName},
        ${nowIso},
        ${nowIso}
      )
      on conflict (model_key) do update
      set
        display_name = coalesce(excluded.display_name, market_actors.display_name),
        updated_at = excluded.updated_at
    `
  }

  const actorRows = await tx<{ id: string; model_key: string | null }[]>`
    select id, model_key
    from market_actors
    where actor_type = 'model'
      and model_key is not null
    order by model_key
  `

  const targetActorIdByModelKey = new Map(
    actorRows
      .filter((row): row is { id: string; model_key: string } => typeof row.model_key === 'string')
      .map((row) => [row.model_key, row.id]),
  )

  for (const modelKey of actorInputByModelKey.keys()) {
    const actorId = targetActorIdByModelKey.get(modelKey)
    if (!actorId) {
      throw new Error(`Missing model actor after upsert for model_key ${modelKey}`)
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
        ${nowIso},
        ${nowIso}
      )
      on conflict (actor_id) do nothing
    `
  }

  const sourceActorIdToTargetActorId = new Map<string, string>()
  for (const actor of bundleActors) {
    const targetActorId = targetActorIdByModelKey.get(actor.model_key)
    if (!targetActorId) {
      throw new Error(`Missing target actor mapping for bundle model ${actor.model_key}`)
    }
    sourceActorIdToTargetActorId.set(actor.actor_id, targetActorId)
  }

  return {
    sourceActorIdToTargetActorId,
    targetActorIdByModelKey,
  }
}

async function deleteCurrentTrialNamespace(tx: postgres.Sql, trialRunIds: string[]): Promise<void> {
  await tx`delete from trial_question_outcome_history`
  await tx`delete from trial_outcome_candidate_evidence`
  await tx`delete from trial_outcome_candidates`
  await tx`delete from trial_sync_run_items`
  await tx`delete from trial_sync_runs`
  await tx`delete from trial_monitor_runs`

  for (const runId of trialRunIds) {
    await tx`delete from market_run_logs where run_id = ${runId}`
  }

  await tx`delete from model_decision_snapshots where trial_question_id is not null`
  await tx`delete from market_actions where trial_question_id is not null`
  await tx`delete from prediction_markets where trial_question_id is not null`
  await tx`delete from trial_questions`
  await tx`delete from phase2_trials`

  for (const runId of trialRunIds) {
    await tx`delete from market_runs where id = ${runId}`
  }
}

async function insertPhase2Trials(tx: postgres.Sql, rows: Phase2TrialBundleRow[]): Promise<void> {
  for (const row of rows) {
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
}

async function insertTrialQuestions(tx: postgres.Sql, rows: TrialQuestionBundleRow[]): Promise<void> {
  for (const row of rows) {
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
}

async function insertTrialMarkets(tx: postgres.Sql, rows: TrialMarketBundleRow[]): Promise<void> {
  for (const row of rows) {
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
}

async function insertTrialMarketPriceSnapshots(
  tx: postgres.Sql,
  rows: TrialMarketPriceSnapshotBundleRow[],
): Promise<void> {
  const formattedRows = rows.map((row) => ({
    id: row.id,
    market_id: row.market_id,
    snapshot_date: row.snapshot_date,
    price_yes: row.price_yes,
    q_yes: row.q_yes,
    q_no: row.q_no,
    created_at: row.created_at,
  }))

  for (const chunk of chunkArray(formattedRows, BULK_INSERT_CHUNK_SIZE)) {
    await tx`
      insert into market_price_snapshots ${tx(
        chunk,
        'id',
        'market_id',
        'snapshot_date',
        'price_yes',
        'q_yes',
        'q_no',
        'created_at',
      )}
    `
  }
}

async function insertTrialMonitorRuns(tx: postgres.Sql, rows: TrialMonitorRunBundleRow[]): Promise<void> {
  for (const row of rows) {
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
}

async function insertTrialSyncRuns(tx: postgres.Sql, rows: TrialSyncRunBundleRow[]): Promise<void> {
  for (const row of rows) {
    await tx`
      insert into trial_sync_runs (
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
      )
      values (
        ${row.id},
        ${row.trigger_source},
        ${row.mode},
        ${row.status},
        ${row.source_data_timestamp},
        ${row.studies_fetched},
        ${row.studies_matched},
        ${row.trials_upserted},
        ${row.questions_upserted},
        ${row.markets_opened},
        ${row.error_summary},
        ${row.started_at},
        ${row.completed_at},
        ${row.updated_at}
      )
    `
  }
}

async function insertTrialSyncRunItems(tx: postgres.Sql, rows: TrialSyncRunItemBundleRow[]): Promise<void> {
  for (const row of rows) {
    await tx`
      insert into trial_sync_run_items (
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
      )
      values (
        ${row.id},
        ${row.run_id},
        ${row.trial_id},
        ${row.nct_number},
        ${row.short_title},
        ${row.sponsor_name},
        ${row.current_status},
        ${row.est_primary_completion_date},
        ${row.change_type},
        ${row.change_summary},
        ${row.created_at}
      )
    `
  }
}

async function insertTrialOutcomeCandidates(
  tx: postgres.Sql,
  rows: TrialOutcomeCandidateBundleRow[],
  reviewedUserIdByCandidateId: Map<string, string | null>,
): Promise<void> {
  for (const row of rows) {
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
        ${reviewedUserIdByCandidateId.get(row.id) ?? null},
        ${row.review_notes},
        ${row.created_at},
        ${row.updated_at},
        ${row.reviewed_at}
      )
    `
  }
}

async function insertTrialOutcomeCandidateEvidence(
  tx: postgres.Sql,
  rows: TrialOutcomeCandidateEvidenceBundleRow[],
): Promise<void> {
  const formattedRows = rows.map((row) => ({
    id: row.id,
    candidate_id: row.candidate_id,
    source_type: row.source_type,
    title: row.title,
    url: row.url,
    published_at: row.published_at,
    excerpt: row.excerpt,
    domain: row.domain,
    display_order: row.display_order,
    created_at: row.created_at,
  }))

  for (const chunk of chunkArray(formattedRows, BULK_INSERT_CHUNK_SIZE)) {
    await tx`
      insert into trial_outcome_candidate_evidence ${tx(
        chunk,
        'id',
        'candidate_id',
        'source_type',
        'title',
        'url',
        'published_at',
        'excerpt',
        'domain',
        'display_order',
        'created_at',
      )}
    `
  }
}

async function insertTrialQuestionOutcomeHistory(
  tx: postgres.Sql,
  rows: TrialQuestionOutcomeHistoryBundleRow[],
  changedByUserIdByHistoryId: Map<string, string | null>,
): Promise<void> {
  for (const row of rows) {
    await tx`
      insert into trial_question_outcome_history (
        id,
        trial_question_id,
        previous_outcome,
        previous_outcome_date,
        next_outcome,
        next_outcome_date,
        changed_at,
        change_source,
        changed_by_user_id,
        review_candidate_id,
        notes
      )
      values (
        ${row.id},
        ${row.trial_question_id},
        ${row.previous_outcome},
        ${row.previous_outcome_date},
        ${row.next_outcome},
        ${row.next_outcome_date},
        ${row.changed_at},
        ${row.change_source},
        ${changedByUserIdByHistoryId.get(row.id) ?? null},
        ${row.review_candidate_id},
        ${row.notes}
      )
    `
  }
}

async function insertTrialMarketRuns(tx: postgres.Sql, rows: TrialMarketRunBundleRow[]): Promise<void> {
  for (const row of rows) {
    await tx`
      insert into market_runs (
        id,
        run_date,
        status,
        open_markets,
        total_actions,
        processed_actions,
        ok_count,
        error_count,
        skipped_count,
        failure_reason,
        created_at,
        updated_at,
        completed_at
      )
      values (
        ${row.id},
        ${row.run_date},
        ${row.status},
        ${row.open_markets},
        ${row.total_actions},
        ${row.processed_actions},
        ${row.ok_count},
        ${row.error_count},
        ${row.skipped_count},
        ${row.failure_reason},
        ${row.created_at},
        ${row.updated_at},
        ${row.completed_at}
      )
    `
  }
}

async function insertTrialMarketActions(
  tx: postgres.Sql,
  rows: TrialMarketActionBundleRow[],
  sourceActorIdToTargetActorId: Map<string, string>,
): Promise<void> {
  const formattedRows = rows.map((row) => {
    const targetActorId = sourceActorIdToTargetActorId.get(row.actor_id)
    if (!targetActorId) {
      throw new Error(`Missing target actor mapping for action ${row.id}`)
    }

    return {
      id: row.id,
      run_id: row.run_id,
      market_id: row.market_id,
      fda_event_id: null,
      trial_question_id: row.trial_question_id,
      actor_id: targetActorId,
      run_date: row.run_date,
      action_source: row.action_source,
      action: row.action,
      usd_amount: row.usd_amount,
      shares_delta: row.shares_delta,
      price_before: row.price_before,
      price_after: row.price_after,
      explanation: row.explanation,
      status: row.status,
      error_code: row.error_code,
      error_details: row.error_details,
      error: row.error,
      created_at: row.created_at,
    }
  })

  for (const chunk of chunkArray(formattedRows, BULK_INSERT_CHUNK_SIZE)) {
    await tx`
      insert into market_actions ${tx(
        chunk,
        'id',
        'run_id',
        'market_id',
        'fda_event_id',
        'trial_question_id',
        'actor_id',
        'run_date',
        'action_source',
        'action',
        'usd_amount',
        'shares_delta',
        'price_before',
        'price_after',
        'explanation',
        'status',
        'error_code',
        'error_details',
        'error',
        'created_at',
      )}
    `
  }
}

async function insertTrialModelDecisionSnapshots(
  tx: postgres.Sql,
  rows: TrialModelDecisionSnapshotBundleRow[],
  sourceActorIdToTargetActorId: Map<string, string>,
  supportedCostSources: Set<string>,
): Promise<void> {
  const formattedRows = rows.map((row) => {
    const targetActorId = sourceActorIdToTargetActorId.get(row.actor_id)
    if (!targetActorId) {
      throw new Error(`Missing target actor mapping for model snapshot ${row.id}`)
    }

    const normalizedCostSource = normalizeModelDecisionSnapshotCostSource(row.cost_source, supportedCostSources)

    return {
      id: row.id,
      run_id: row.run_id,
      run_date: row.run_date,
      market_id: row.market_id,
      fda_event_id: null,
      trial_question_id: row.trial_question_id,
      actor_id: targetActorId,
      run_source: row.run_source,
      approval_probability: row.approval_probability,
      yes_probability: row.yes_probability,
      binary_call: row.binary_call,
      confidence: row.confidence,
      reasoning: row.reasoning,
      proposed_action_type: row.proposed_action_type,
      proposed_amount_usd: row.proposed_amount_usd,
      proposed_explanation: row.proposed_explanation,
      market_price_yes: row.market_price_yes,
      market_price_no: row.market_price_no,
      cash_available: row.cash_available,
      yes_shares_held: row.yes_shares_held,
      no_shares_held: row.no_shares_held,
      max_buy_usd: row.max_buy_usd,
      max_sell_yes_usd: row.max_sell_yes_usd,
      max_sell_no_usd: row.max_sell_no_usd,
      duration_ms: row.duration_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      total_tokens: row.total_tokens,
      reasoning_tokens: row.reasoning_tokens,
      estimated_cost_usd: row.estimated_cost_usd,
      cost_source: normalizedCostSource,
      cache_creation_input_tokens_5m: row.cache_creation_input_tokens_5m,
      cache_creation_input_tokens_1h: row.cache_creation_input_tokens_1h,
      cache_read_input_tokens: row.cache_read_input_tokens,
      web_search_requests: row.web_search_requests,
      inference_geo: row.inference_geo,
      linked_market_action_id: row.linked_market_action_id,
      created_at: row.created_at,
    }
  })

  for (const chunk of chunkArray(formattedRows, BULK_SNAPSHOT_INSERT_CHUNK_SIZE)) {
    await tx`
      insert into model_decision_snapshots ${tx(
        chunk,
        'id',
        'run_id',
        'run_date',
        'market_id',
        'fda_event_id',
        'trial_question_id',
        'actor_id',
        'run_source',
        'approval_probability',
        'yes_probability',
        'binary_call',
        'confidence',
        'reasoning',
        'proposed_action_type',
        'proposed_amount_usd',
        'proposed_explanation',
        'market_price_yes',
        'market_price_no',
        'cash_available',
        'yes_shares_held',
        'no_shares_held',
        'max_buy_usd',
        'max_sell_yes_usd',
        'max_sell_no_usd',
        'duration_ms',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'reasoning_tokens',
        'estimated_cost_usd',
        'cost_source',
        'cache_creation_input_tokens_5m',
        'cache_creation_input_tokens_1h',
        'cache_read_input_tokens',
        'web_search_requests',
        'inference_geo',
        'linked_market_action_id',
        'created_at',
      )}
    `
  }
}

async function insertTrialMarketRunLogs(
  tx: postgres.Sql,
  rows: TrialMarketRunLogBundleRow[],
  sourceActorIdToTargetActorId: Map<string, string>,
): Promise<void> {
  const formattedRows = rows.map((row) => ({
    id: row.id,
    run_id: row.run_id,
    log_type: row.log_type,
    message: row.message,
    completed_actions: row.completed_actions,
    total_actions: row.total_actions,
    ok_count: row.ok_count,
    error_count: row.error_count,
    skipped_count: row.skipped_count,
    market_id: row.market_id,
    fda_event_id: null,
    trial_question_id: row.trial_question_id,
    actor_id: row.actor_id ? sourceActorIdToTargetActorId.get(row.actor_id) ?? null : null,
    activity_phase: row.activity_phase,
    action: row.action,
    action_status: row.action_status,
    amount_usd: row.amount_usd,
    created_at: row.created_at,
  }))

  for (const chunk of chunkArray(formattedRows, BULK_INSERT_CHUNK_SIZE)) {
    await tx`
      insert into market_run_logs ${tx(
        chunk,
        'id',
        'run_id',
        'log_type',
        'message',
        'completed_actions',
        'total_actions',
        'ok_count',
        'error_count',
        'skipped_count',
        'market_id',
        'fda_event_id',
        'trial_question_id',
        'actor_id',
        'activity_phase',
        'action',
        'action_status',
        'amount_usd',
        'created_at',
      )}
    `
  }
}

async function insertTrialMarketPositions(
  tx: postgres.Sql,
  rows: TrialMarketPositionBundleRow[],
  sourceActorIdToTargetActorId: Map<string, string>,
): Promise<void> {
  const formattedRows = rows.map((row) => {
    const targetActorId = sourceActorIdToTargetActorId.get(row.actor_id)
    if (!targetActorId) {
      throw new Error(`Missing target actor mapping for market position ${row.id}`)
    }

    return {
      id: row.id,
      market_id: row.market_id,
      actor_id: targetActorId,
      yes_shares: row.yes_shares,
      no_shares: row.no_shares,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  })

  for (const chunk of chunkArray(formattedRows, BULK_INSERT_CHUNK_SIZE)) {
    await tx`
      insert into market_positions ${tx(
        chunk,
        'id',
        'market_id',
        'actor_id',
        'yes_shares',
        'no_shares',
        'created_at',
        'updated_at',
      )}
    `
  }
}

async function refreshCurrentDaySnapshots(tx: postgres.Sql): Promise<string> {
  const snapshotDate = new Date().toISOString().slice(0, 10)

  const openTrialMarkets = await tx<{
    id: string
    price_yes: number | string
    q_yes: number | string
    q_no: number | string
  }[]>`
    select id, price_yes, q_yes, q_no
    from prediction_markets
    where status = 'OPEN'
      and trial_question_id is not null
    order by id
  `

  for (const market of openTrialMarkets) {
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
        ${crypto.randomUUID()},
        ${market.id},
        ${snapshotDate},
        ${toNumber(market.price_yes)},
        ${toNumber(market.q_yes)},
        ${toNumber(market.q_no)},
        ${new Date().toISOString()}
      )
      on conflict (market_id, snapshot_date) do update
      set
        price_yes = excluded.price_yes,
        q_yes = excluded.q_yes,
        q_no = excluded.q_no
    `
  }

  const accountRows = await tx<ModelAccountRow[]>`
    select
      actor.id as actor_id,
      actor.model_key,
      account.cash_balance,
      account.starting_cash
    from market_accounts account
    join market_actors actor on actor.id = account.actor_id
    where actor.actor_type = 'model'
      and actor.model_key is not null
    order by actor.model_key
  `

  const openPositionRows = await tx<{
    actor_id: string
    market_id: string
    yes_shares: number | string
    no_shares: number | string
    price_yes: number | string
  }[]>`
    select
      mp.actor_id,
      mp.market_id,
      mp.yes_shares,
      mp.no_shares,
      pm.price_yes
    from market_positions mp
    join prediction_markets pm on pm.id = mp.market_id
    join market_actors actor on actor.id = mp.actor_id
    where pm.status = 'OPEN'
      and actor.actor_type = 'model'
  `

  const positionValueByActorId = new Map<string, number>()
  for (const row of openPositionRows) {
    const yesShares = toNumber(row.yes_shares)
    const noShares = toNumber(row.no_shares)
    const priceYes = toNumber(row.price_yes)
    const current = positionValueByActorId.get(row.actor_id) ?? 0
    const next = current + (yesShares * priceYes) + (noShares * (1 - priceYes))
    positionValueByActorId.set(row.actor_id, roundCash(next))
  }

  for (const account of accountRows) {
    const positionsValue = roundCash(positionValueByActorId.get(account.actor_id) ?? 0)
    const totalEquity = roundCash(account.cash_balance + positionsValue)
    await tx`
      insert into market_daily_snapshots (
        id,
        snapshot_date,
        actor_id,
        cash_balance,
        positions_value,
        total_equity,
        created_at
      )
      values (
        ${crypto.randomUUID()},
        ${snapshotDate},
        ${account.actor_id},
        ${account.cash_balance},
        ${positionsValue},
        ${totalEquity},
        ${new Date().toISOString()}
      )
      on conflict (actor_id, snapshot_date) do update
      set
        cash_balance = excluded.cash_balance,
        positions_value = excluded.positions_value,
        total_equity = excluded.total_equity
    `
  }

  return snapshotDate
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.inputFile) {
    throw new Error(
      'Usage: npx tsx scripts/import-trial-public-state.ts --input-file /absolute/path/to/trial-public-state.json [--database-url postgres://...] [--apply]',
    )
  }

  const bundle = await loadTrialPublicStateBundle(args.inputFile)
  if (bundle.metadata.schema_version !== TRIAL_PUBLIC_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported bundle schema version ${bundle.metadata.schema_version}`)
  }

  const bundleCounts = computeTrialPublicStateCounts(bundle)
  if (JSON.stringify(bundle.metadata.counts) !== JSON.stringify(bundleCounts)) {
    throw new Error('Bundle metadata counts do not match the bundle contents')
  }

  const bundleValidationErrors = validateBundleIntegrity(bundle)
  if (bundleValidationErrors.length > 0) {
    throw new Error(`Bundle validation failed:\n${bundleValidationErrors.join('\n')}`)
  }

  const connectionString = resolveConnectionString(args)
  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    const [
      targetHasWebSearchEnabled,
      targetCounts,
      userMaps,
      targetNctNumbers,
      targetQuestionStates,
      targetTrialRunInfo,
      targetHumanTrialState,
      targetModelCashEffects,
      targetSupportedSnapshotCostSources,
    ] = await Promise.all([
      hasColumn(sql, 'trial_monitor_configs', 'web_search_enabled'),
      loadTargetTrialNamespaceCounts(sql),
      loadUserMaps(sql),
      loadTargetNctNumbers(sql),
      loadTargetQuestionStateRows(sql),
      loadTargetTrialRunInfo(sql),
      loadTargetHumanTrialState(sql),
      loadTargetModelCashEffects(sql),
      loadSupportedModelDecisionSnapshotCostSources(sql),
    ])

    const sourceNctNumbers = bundle.phase2Trials.map((row) => row.nct_number).sort()
    const sourceNctSet = new Set(sourceNctNumbers)
    const targetNctSet = new Set(targetNctNumbers)
    const prodOnlyNctNumbers = targetNctNumbers.filter((nctNumber) => !sourceNctSet.has(nctNumber))
    const localOnlyNctNumbers = sourceNctNumbers.filter((nctNumber) => !targetNctSet.has(nctNumber))
    const questionOutcomeDiffs = diffQuestionStates(buildSourceQuestionStateRows(bundle), targetQuestionStates)

    const referencedReviewedUserEmails = Array.from(new Set(
      bundle.trialOutcomeCandidates
        .map((row) => normalizeEmail(row.reviewed_by_user_email))
        .filter((value): value is string => value !== null),
    )).sort()
    const unresolvedReviewedUserEmails = referencedReviewedUserEmails
      .filter((email) => !userMaps.userIdByEmail.has(email))

    const referencedChangedByEmails = Array.from(new Set(
      bundle.trialQuestionOutcomeHistory
        .map((row) => normalizeEmail(row.changed_by_user_email))
        .filter((value): value is string => value !== null),
    )).sort()
    const unresolvedChangedByEmails = referencedChangedByEmails
      .filter((email) => !userMaps.userIdByEmail.has(email))

    const sourceModelCashEffects = computeBundleModelCashEffects(bundle)
    const modelCashDeltas = mergeModelCashEffects({
      source: sourceModelCashEffects,
      target: targetModelCashEffects,
    })
    const normalizedSnapshotCostSources = summarizeNormalizedModelDecisionSnapshotCostSources(
      bundle.trialModelDecisionSnapshots,
      targetSupportedSnapshotCostSources,
    )

    const warnings: string[] = []
    if (unresolvedReviewedUserEmails.length > 0) {
      warnings.push(`Some reviewed_by_user_email values are missing on target and will import as null: ${unresolvedReviewedUserEmails.join(', ')}`)
    }
    if (unresolvedChangedByEmails.length > 0) {
      warnings.push(`Some changed_by_user_email values are missing on target and will import as null: ${unresolvedChangedByEmails.join(', ')}`)
    }
    if (targetHumanTrialState.positionCount > 0 && targetHumanTrialState.nonzeroPositionCount === 0) {
      warnings.push('Target contains zero-share human trial positions that will be deleted/rebuilt with the trial markets.')
    }
    if (normalizedSnapshotCostSources.length > 0) {
      warnings.push(
        `Target snapshot cost_source constraint is older than local data; importer will normalize ${normalizedSnapshotCostSources.map((row) => `${row.count} ${row.from}->${row.to}`).join(', ')}.`,
      )
    }

    const blockingIssues: string[] = []
    if (targetTrialRunInfo.sharedTrialRunIds.length > 0) {
      blockingIssues.push(`Shared trial run ids detected: ${targetTrialRunInfo.sharedTrialRunIds.join(', ')}`)
    }
    if (targetHumanTrialState.actionCount > 0) {
      blockingIssues.push(`Target has ${targetHumanTrialState.actionCount} human trial market action(s); first-pass mirror refuses to delete human action history.`)
    }
    if (targetHumanTrialState.nonzeroPositionCount > 0) {
      blockingIssues.push(
        `Target has ${targetHumanTrialState.nonzeroPositionCount} non-zero human trial position(s); first-pass mirror refuses to delete them silently.`,
      )
    }

    if (!args.apply) {
      console.log(JSON.stringify(sanitizeForJson({
        mode: 'dry-run',
        inputFile: args.inputFile,
        schemaVersion: bundle.metadata.schema_version,
        bundleCounts,
        targetCounts,
        rowsToDelete: targetCounts,
        prodOnlyNctNumbers,
        localOnlyNctNumbers,
        questionOutcomeDiffs,
        trialRunIdsToReplace: targetTrialRunInfo.trialRunIds,
        sharedTrialRunIds: targetTrialRunInfo.sharedTrialRunIds,
        reviewedUserEmails: {
          referenced: referencedReviewedUserEmails,
          unresolved: unresolvedReviewedUserEmails,
        },
        changedByUserEmails: {
          referenced: referencedChangedByEmails,
          unresolved: unresolvedChangedByEmails,
        },
        humanTrialState: targetHumanTrialState,
        modelCashDeltas,
        normalizedSnapshotCostSources,
        warnings,
        readyToApply: blockingIssues.length === 0,
        blockingIssues,
      }), null, 2))
      return
    }

    if (blockingIssues.length > 0) {
      throw new Error(`Refusing apply because of blocking issues:\n${blockingIssues.join('\n')}`)
    }

    const reviewedUserIdByCandidateId = new Map<string, string | null>()
    for (const row of bundle.trialOutcomeCandidates) {
      reviewedUserIdByCandidateId.set(row.id, resolveTargetUserId({
        sourceUserId: row.reviewed_by_user_id,
        sourceUserEmail: row.reviewed_by_user_email,
        userMaps,
      }))
    }

    const changedByUserIdByHistoryId = new Map<string, string | null>()
    for (const row of bundle.trialQuestionOutcomeHistory) {
      changedByUserIdByHistoryId.set(row.id, resolveTargetUserId({
        sourceUserId: row.changed_by_user_id,
        sourceUserEmail: row.changed_by_user_email,
        userMaps,
      }))
    }

    const applySummary = await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql

      const targetTrialRunInfoBeforeDelete = await loadTargetTrialRunInfo(tx)
      if (targetTrialRunInfoBeforeDelete.sharedTrialRunIds.length > 0) {
        throw new Error(`Shared trial run ids detected during apply: ${targetTrialRunInfoBeforeDelete.sharedTrialRunIds.join(', ')}`)
      }

      await upsertTrialMonitorConfig(tx, bundle.trialMonitorConfig, targetHasWebSearchEnabled)
      await upsertTrialSyncConfig(tx, bundle.trialSyncConfig)

      const actorMappings = await ensureTargetModelActorsAndAccounts(tx, bundle.modelActors)
      const targetModelAccountRows = await loadTargetModelAccountRows(tx)
      const targetModelAccountByKey = new Map(targetModelAccountRows.map((row) => [row.model_key, row]))
      const targetModelCashEffectsBeforeDelete = await loadTargetModelCashEffects(tx)
      const cashDeltas = mergeModelCashEffects({
        source: sourceModelCashEffects,
        target: targetModelCashEffectsBeforeDelete,
      })

      await deleteCurrentTrialNamespace(tx, targetTrialRunInfoBeforeDelete.trialRunIds)

      await insertPhase2Trials(tx, bundle.phase2Trials)
      await insertTrialQuestions(tx, bundle.trialQuestions)
      await insertTrialMarkets(tx, bundle.trialMarkets)
      await insertTrialMarketPriceSnapshots(tx, bundle.trialMarketPriceSnapshots)
      await insertTrialMonitorRuns(tx, bundle.trialMonitorRuns)
      await insertTrialSyncRuns(tx, bundle.trialSyncRuns)
      await insertTrialSyncRunItems(tx, bundle.trialSyncRunItems)
      await insertTrialOutcomeCandidates(tx, bundle.trialOutcomeCandidates, reviewedUserIdByCandidateId)
      await insertTrialOutcomeCandidateEvidence(tx, bundle.trialOutcomeCandidateEvidence)
      await insertTrialQuestionOutcomeHistory(tx, bundle.trialQuestionOutcomeHistory, changedByUserIdByHistoryId)
      await insertTrialMarketRuns(tx, bundle.trialMarketRuns)
      await insertTrialMarketActions(tx, bundle.trialMarketActions, actorMappings.sourceActorIdToTargetActorId)
      await insertTrialModelDecisionSnapshots(
        tx,
        bundle.trialModelDecisionSnapshots,
        actorMappings.sourceActorIdToTargetActorId,
        targetSupportedSnapshotCostSources,
      )
      await insertTrialMarketRunLogs(tx, bundle.trialMarketRunLogs, actorMappings.sourceActorIdToTargetActorId)
      await insertTrialMarketPositions(tx, bundle.trialMarketPositions, actorMappings.sourceActorIdToTargetActorId)

      const nowIso = new Date().toISOString()
      for (const row of cashDeltas) {
        if (Math.abs(row.delta) < CASH_DELTA_EPSILON) continue

        const targetActorId = actorMappings.targetActorIdByModelKey.get(row.modelKey)
        if (!targetActorId) {
          throw new Error(`Missing target actor id for model ${row.modelKey}`)
        }

        const account = targetModelAccountByKey.get(row.modelKey)
        if (!account) {
          throw new Error(`Missing market account for model ${row.modelKey}`)
        }

        const nextCashBalance = roundCash(account.cash_balance + row.delta)
        if (nextCashBalance < -1e-6) {
          throw new Error(
            `Applying trial cash delta would drive ${row.modelKey} below zero cash (${account.cash_balance} + ${row.delta} = ${nextCashBalance})`,
          )
        }

        await tx`
          update market_accounts
          set
            cash_balance = ${Math.max(0, nextCashBalance)},
            updated_at = ${nowIso}
          where actor_id = ${targetActorId}
        `
      }

      const refreshedSnapshotDate = await refreshCurrentDaySnapshots(tx)

      return {
        deletedTrialRunIds: targetTrialRunInfoBeforeDelete.trialRunIds,
        sharedTrialRunIds: targetTrialRunInfoBeforeDelete.sharedTrialRunIds,
        modelCashDeltas: cashDeltas,
        normalizedSnapshotCostSources,
        refreshedSnapshotDate,
      }
    })

    const finalCounts = await loadTargetTrialNamespaceCounts(sql)
    console.log(JSON.stringify(sanitizeForJson({
      mode: 'apply',
      inputFile: args.inputFile,
      schemaVersion: bundle.metadata.schema_version,
      bundleCounts,
      deletedCountsBefore: targetCounts,
      finalCounts,
      prodOnlyNctNumbersDeleted: prodOnlyNctNumbers,
      localOnlyNctNumbersInserted: localOnlyNctNumbers,
      questionOutcomeDiffsBeforeApply: questionOutcomeDiffs,
      deletedTrialRunIds: applySummary.deletedTrialRunIds,
      sharedTrialRunIds: applySummary.sharedTrialRunIds,
      reviewedUserEmails: {
        referenced: referencedReviewedUserEmails,
        unresolved: unresolvedReviewedUserEmails,
      },
      changedByUserEmails: {
        referenced: referencedChangedByEmails,
        unresolved: unresolvedChangedByEmails,
      },
      humanTrialStateBeforeApply: targetHumanTrialState,
      modelCashDeltas: applySummary.modelCashDeltas,
      normalizedSnapshotCostSources: applySummary.normalizedSnapshotCostSources,
      refreshedSnapshotDate: applySummary.refreshedSnapshotDate,
      warnings,
    }), null, 2))
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
