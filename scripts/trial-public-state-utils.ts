import fs from 'node:fs/promises'
import path from 'node:path'

export const TRIAL_PUBLIC_STATE_SCHEMA_VERSION = 3

export type TrialPublicStateCounts = {
  trials: number
  trial_questions: number
  question_outcome_pending: number
  question_outcome_yes: number
  question_outcome_no: number
  trial_markets: number
  open_trial_markets: number
  resolved_trial_markets: number
  trial_market_price_snapshots: number
  trial_outcome_candidates: number
  pending_review_candidates: number
  dismissed_candidates: number
  accepted_candidates: number
  trial_outcome_candidate_evidence: number
  trial_monitor_runs: number
  trial_question_outcome_history: number
  trial_sync_runs: number
  trial_sync_run_items: number
  trial_market_runs: number
  trial_market_run_logs: number
  trial_market_actions: number
  trial_model_decision_snapshots: number
  trial_market_positions: number
}

export type TrialMonitorConfigBundleRow = {
  id: string
  enabled: boolean
  web_search_enabled: boolean | null
  run_interval_hours: number
  lookahead_days: number
  overdue_recheck_hours: number
  max_questions_per_run: number
  verifier_model_key: string
  min_candidate_confidence: number
  created_at: string
  updated_at: string
}

export type TrialSyncConfigBundleRow = {
  id: string
  enabled: boolean
  sync_interval_hours: number
  recent_completion_lookback_days: number
  reconcile_interval_hours: number
  last_successful_update_post_date: string | null
  last_successful_data_timestamp: string | null
  created_at: string
  updated_at: string
}

export type TrialBundleRow = {
  id: string
  nct_number: string
  source: 'sync_import' | 'manual_admin'
  short_title: string
  sponsor_name: string
  sponsor_ticker: string | null
  indication: string
  exact_phase: string
  intervention: string
  primary_endpoint: string
  study_start_date: string | null
  est_primary_completion_date: string
  est_study_completion_date: string | null
  est_results_posting_date: string | null
  current_status: string
  est_enrollment: number | null
  key_locations: string | null
  brief_summary: string
  standard_betting_markets: string | null
  last_monitored_at: string | null
  created_at: string
  updated_at: string
}

export type TrialQuestionBundleRow = {
  id: string
  trial_id: string
  slug: string
  prompt: string
  status: string
  is_bettable: boolean
  sort_order: number
  outcome: string
  outcome_date: string | null
  created_at: string
  updated_at: string
}

export type TrialMarketBundleRow = {
  id: string
  trial_question_id: string
  status: string
  opening_probability: number
  house_opening_probability: number
  opening_line_source: 'house_model' | 'admin_override'
  b: number
  q_yes: number
  q_no: number
  price_yes: number
  opened_by_user_id: string | null
  opened_by_user_email: string | null
  opened_at: string
  resolved_at: string | null
  resolved_outcome: 'YES' | 'NO' | null
  created_at: string
  updated_at: string
}

export type TrialMarketPriceSnapshotBundleRow = {
  id: string
  market_id: string
  snapshot_date: string
  price_yes: number
  q_yes: number
  q_no: number
  created_at: string
}

export type TrialOutcomeCandidateBundleRow = {
  id: string
  trial_question_id: string
  proposed_outcome: string
  proposed_outcome_date: string | null
  confidence: number
  summary: string
  verifier_model_key: string
  provider_response_id: string | null
  evidence_hash: string
  status: string
  reviewed_by_user_id: string | null
  reviewed_by_user_email: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
}

export type TrialOutcomeCandidateEvidenceBundleRow = {
  id: string
  candidate_id: string
  source_type: string
  title: string
  url: string
  published_at: string | null
  excerpt: string
  domain: string
  display_order: number
  created_at: string
}

export type TrialMonitorRunBundleRow = {
  id: string
  trigger_source: string
  status: string
  questions_scanned: number
  candidates_created: number
  error_summary: string | null
  debug_log: string | null
  started_at: string
  completed_at: string | null
  updated_at: string
}

export type TrialQuestionOutcomeHistoryBundleRow = {
  id: string
  trial_question_id: string
  previous_outcome: string | null
  previous_outcome_date: string | null
  next_outcome: string
  next_outcome_date: string | null
  changed_at: string
  change_source: string
  changed_by_user_id: string | null
  changed_by_user_email: string | null
  review_candidate_id: string | null
  notes: string | null
}

export type TrialSyncRunBundleRow = {
  id: string
  trigger_source: string
  mode: string
  status: string
  source_data_timestamp: string | null
  studies_fetched: number
  studies_matched: number
  trials_upserted: number
  questions_upserted: number
  markets_opened: number
  error_summary: string | null
  started_at: string
  completed_at: string | null
  updated_at: string
}

export type TrialSyncRunItemBundleRow = {
  id: string
  run_id: string
  trial_id: string | null
  nct_number: string
  short_title: string
  sponsor_name: string
  current_status: string
  est_primary_completion_date: string
  change_type: string
  change_summary: string | null
  created_at: string
}

export type TrialMarketRunBundleRow = {
  id: string
  run_date: string
  status: string
  open_markets: number
  total_actions: number
  processed_actions: number
  ok_count: number
  error_count: number
  skipped_count: number
  failure_reason: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type TrialMarketRunLogBundleRow = {
  id: string
  run_id: string
  log_type: string
  message: string
  completed_actions: number | null
  total_actions: number | null
  ok_count: number | null
  error_count: number | null
  skipped_count: number | null
  market_id: string | null
  trial_question_id: string | null
  actor_id: string | null
  activity_phase: string | null
  action: string | null
  action_status: string | null
  amount_usd: number | null
  created_at: string
}

export type TrialMarketActionBundleRow = {
  id: string
  run_id: string | null
  market_id: string
  trial_question_id: string
  actor_id: string
  run_date: string
  action_source: string
  action: string
  usd_amount: number
  shares_delta: number
  price_before: number
  price_after: number
  explanation: string
  status: string
  error_code: string | null
  error_details: string | null
  error: string | null
  created_at: string
}

export type TrialModelDecisionSnapshotBundleRow = {
  id: string
  run_id: string | null
  run_date: string
  market_id: string | null
  trial_question_id: string
  actor_id: string | null
  model_key: string | null
  run_source: string
  approval_probability: number
  yes_probability: number | null
  binary_call: 'yes' | 'no'
  confidence: number
  reasoning: string
  proposed_action_type: string
  proposed_amount_usd: number
  proposed_explanation: string
  market_price_yes: number | null
  market_price_no: number | null
  cash_available: number | null
  yes_shares_held: number | null
  no_shares_held: number | null
  max_buy_usd: number | null
  max_sell_yes_usd: number | null
  max_sell_no_usd: number | null
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  reasoning_tokens: number | null
  estimated_cost_usd: number | null
  cost_source: string | null
  cache_creation_input_tokens_5m: number | null
  cache_creation_input_tokens_1h: number | null
  cache_read_input_tokens: number | null
  web_search_requests: number | null
  inference_geo: string | null
  linked_market_action_id: string | null
  created_at: string
}

export type TrialMarketPositionBundleRow = {
  id: string
  market_id: string
  actor_id: string
  yes_shares: number
  no_shares: number
  created_at: string
  updated_at: string
}

export type TrialModelActorBundleRow = {
  actor_id: string
  model_key: string
  display_name: string | null
  created_at: string
  updated_at: string
}

export type TrialPublicStateBundle = {
  metadata: {
    schema_version: number
    exported_at: string
    source_supported_model_ids: string[]
    source_active_model_ids: string[]
    source_disabled_model_ids: string[]
    counts: TrialPublicStateCounts
  }
  trialMonitorConfig: TrialMonitorConfigBundleRow
  trialSyncConfig: TrialSyncConfigBundleRow
  trials: TrialBundleRow[]
  trialQuestions: TrialQuestionBundleRow[]
  trialMarkets: TrialMarketBundleRow[]
  trialMarketPriceSnapshots: TrialMarketPriceSnapshotBundleRow[]
  trialOutcomeCandidates: TrialOutcomeCandidateBundleRow[]
  trialOutcomeCandidateEvidence: TrialOutcomeCandidateEvidenceBundleRow[]
  trialMonitorRuns: TrialMonitorRunBundleRow[]
  trialQuestionOutcomeHistory: TrialQuestionOutcomeHistoryBundleRow[]
  trialSyncRuns: TrialSyncRunBundleRow[]
  trialSyncRunItems: TrialSyncRunItemBundleRow[]
  trialMarketRuns: TrialMarketRunBundleRow[]
  trialMarketRunLogs: TrialMarketRunLogBundleRow[]
  trialMarketActions: TrialMarketActionBundleRow[]
  trialModelDecisionSnapshots: TrialModelDecisionSnapshotBundleRow[]
  trialMarketPositions: TrialMarketPositionBundleRow[]
  modelActors: TrialModelActorBundleRow[]
}

function normalizeJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeJsonValue(nestedValue)]),
    )
  }

  return value
}

export function sanitizeForJson<T>(value: T): T {
  return normalizeJsonValue(value) as T
}

export function computeTrialPublicStateCounts(bundle: Pick<
  TrialPublicStateBundle,
  | 'trials'
  | 'trialQuestions'
  | 'trialMarkets'
  | 'trialMarketPriceSnapshots'
  | 'trialOutcomeCandidates'
  | 'trialOutcomeCandidateEvidence'
  | 'trialMonitorRuns'
  | 'trialQuestionOutcomeHistory'
  | 'trialSyncRuns'
  | 'trialSyncRunItems'
  | 'trialMarketRuns'
  | 'trialMarketRunLogs'
  | 'trialMarketActions'
  | 'trialModelDecisionSnapshots'
  | 'trialMarketPositions'
>): TrialPublicStateCounts {
  const counts: TrialPublicStateCounts = {
    trials: bundle.trials.length,
    trial_questions: bundle.trialQuestions.length,
    question_outcome_pending: 0,
    question_outcome_yes: 0,
    question_outcome_no: 0,
    trial_markets: bundle.trialMarkets.length,
    open_trial_markets: 0,
    resolved_trial_markets: 0,
    trial_market_price_snapshots: bundle.trialMarketPriceSnapshots.length,
    trial_outcome_candidates: bundle.trialOutcomeCandidates.length,
    pending_review_candidates: 0,
    dismissed_candidates: 0,
    accepted_candidates: 0,
    trial_outcome_candidate_evidence: bundle.trialOutcomeCandidateEvidence.length,
    trial_monitor_runs: bundle.trialMonitorRuns.length,
    trial_question_outcome_history: bundle.trialQuestionOutcomeHistory.length,
    trial_sync_runs: bundle.trialSyncRuns.length,
    trial_sync_run_items: bundle.trialSyncRunItems.length,
    trial_market_runs: bundle.trialMarketRuns.length,
    trial_market_run_logs: bundle.trialMarketRunLogs.length,
    trial_market_actions: bundle.trialMarketActions.length,
    trial_model_decision_snapshots: bundle.trialModelDecisionSnapshots.length,
    trial_market_positions: bundle.trialMarketPositions.length,
  }

  for (const question of bundle.trialQuestions) {
    if (question.outcome === 'YES') {
      counts.question_outcome_yes += 1
    } else if (question.outcome === 'NO') {
      counts.question_outcome_no += 1
    } else {
      counts.question_outcome_pending += 1
    }
  }

  for (const market of bundle.trialMarkets) {
    if (market.status === 'RESOLVED') {
      counts.resolved_trial_markets += 1
    } else {
      counts.open_trial_markets += 1
    }
  }

  for (const candidate of bundle.trialOutcomeCandidates) {
    if (candidate.status === 'accepted') {
      counts.accepted_candidates += 1
    } else if (candidate.status === 'dismissed') {
      counts.dismissed_candidates += 1
    } else if (candidate.status === 'pending_review') {
      counts.pending_review_candidates += 1
    }
  }

  return counts
}

export function getDefaultTrialPublicStateOutputPath(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[:.]/g, '-')
  return path.resolve(process.cwd(), 'tmp', 'trial-state', `trial-public-state-${compact}.json`)
}

export async function writeTrialPublicStateBundle(
  filePath: string,
  bundle: TrialPublicStateBundle,
): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  return resolvedPath
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function assertTrialPublicStateBundle(value: unknown): asserts value is TrialPublicStateBundle {
  if (!isRecord(value)) {
    throw new Error('Trial public-state bundle must be a JSON object')
  }

  const requiredArrayKeys = [
    'trials',
    'trialQuestions',
    'trialMarkets',
    'trialMarketPriceSnapshots',
    'trialOutcomeCandidates',
    'trialOutcomeCandidateEvidence',
    'trialMonitorRuns',
    'trialQuestionOutcomeHistory',
    'trialSyncRuns',
    'trialSyncRunItems',
    'trialMarketRuns',
    'trialMarketRunLogs',
    'trialMarketActions',
    'trialModelDecisionSnapshots',
    'trialMarketPositions',
    'modelActors',
  ] as const

  for (const key of requiredArrayKeys) {
    if (!Array.isArray(value[key])) {
      throw new Error(`Trial public-state bundle is missing array key "${key}"`)
    }
  }

  if (!isRecord(value.metadata)) {
    throw new Error('Trial public-state bundle is missing metadata')
  }

  if (!isRecord(value.trialMonitorConfig)) {
    throw new Error('Trial public-state bundle is missing trialMonitorConfig')
  }

  if (!isRecord(value.trialSyncConfig)) {
    throw new Error('Trial public-state bundle is missing trialSyncConfig')
  }
}

export async function loadTrialPublicStateBundle(filePath: string): Promise<TrialPublicStateBundle> {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  const text = await fs.readFile(resolvedPath, 'utf8')
  const parsed = JSON.parse(text) as unknown
  assertTrialPublicStateBundle(parsed)
  return parsed
}
