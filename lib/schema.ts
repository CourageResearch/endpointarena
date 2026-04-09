import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true })
const utcDate = (name: string) => date(name, { mode: 'date' })

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').unique(),
  signupLocation: text('signup_location'),
  signupState: text('signup_state'),
  passwordHash: text('password_hash'),
  emailVerified: utcTimestamp('email_verified'),
  image: text('image'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  predictions: integer('predictions').default(0),
  correctPreds: integer('correct_preds').default(0),
  xUserId: text('x_user_id'),
  xUsername: text('x_username'),
  xConnectedAt: utcTimestamp('x_connected_at'),
  tweetChallengeTokenHash: text('tweet_challenge_token_hash'),
  tweetChallengeExpiresAt: utcTimestamp('tweet_challenge_expires_at'),
  tweetVerifiedAt: utcTimestamp('tweet_verified_at'),
  tweetVerifiedTweetId: text('tweet_verified_tweet_id'),
  tweetMustStayUntil: utcTimestamp('tweet_must_stay_until'),
  pointsBalance: integer('points_balance').notNull().default(5),
  lastPointsRefillAt: utcTimestamp('last_points_refill_at'),
}, (table) => ({
  xUserIdUniqueIdx: uniqueIndex('users_x_user_id_idx').on(table.xUserId),
  displayNameCheck: check(
    'users_display_name_check',
    sql`${table.name} ~ '^[A-Za-z0-9]{1,20}$'`
  ),
  pointsBalanceCheck: check(
    'users_points_balance_check',
    sql`${table.pointsBalance} >= 0`
  ),
}))

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionToken: text('session_token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: utcTimestamp('expires').notNull(),
})

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull().unique(),
  expires: utcTimestamp('expires').notNull(),
})

export const phase2Trials = pgTable('phase2_trials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  nctNumber: text('nct_number').notNull(),
  shortTitle: text('short_title').notNull(),
  sponsorName: text('sponsor_name').notNull(),
  sponsorTicker: text('sponsor_ticker'),
  indication: text('indication').notNull(),
  exactPhase: text('exact_phase').notNull(),
  intervention: text('intervention').notNull(),
  primaryEndpoint: text('primary_endpoint').notNull(),
  studyStartDate: utcDate('study_start_date'),
  estPrimaryCompletionDate: utcDate('est_primary_completion_date').notNull(),
  estStudyCompletionDate: utcDate('est_study_completion_date'),
  estResultsPostingDate: utcDate('est_results_posting_date'),
  currentStatus: text('current_status').notNull(),
  estEnrollment: integer('est_enrollment'),
  keyLocations: text('key_locations'),
  briefSummary: text('brief_summary').notNull(),
  standardBettingMarkets: text('standard_betting_markets'),
  lastMonitoredAt: utcTimestamp('last_monitored_at'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  nctNumberUniqueIdx: uniqueIndex('phase2_trials_nct_number_idx').on(table.nctNumber),
  primaryCompletionIdx: index('phase2_trials_primary_completion_idx').on(table.estPrimaryCompletionDate),
  sponsorTickerIdx: index('phase2_trials_sponsor_ticker_idx').on(table.sponsorTicker),
  currentStatusIdx: index('phase2_trials_current_status_idx').on(table.currentStatus),
  estEnrollmentCheck: check(
    'phase2_trials_est_enrollment_check',
    sql`${table.estEnrollment} IS NULL OR ${table.estEnrollment} >= 0`
  ),
}))

export const trialQuestions = pgTable('trial_questions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trialId: text('trial_id').notNull().references(() => phase2Trials.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('coming_soon'),
  isBettable: boolean('is_bettable').notNull().default(false),
  sortOrder: integer('sort_order').notNull(),
  outcome: text('outcome').notNull().default('Pending'),
  outcomeDate: utcTimestamp('outcome_date'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  trialSlugUniqueIdx: uniqueIndex('trial_questions_trial_slug_idx').on(table.trialId, table.slug),
  trialSortOrderUniqueIdx: uniqueIndex('trial_questions_trial_sort_order_idx').on(table.trialId, table.sortOrder),
  slugIdx: index('trial_questions_slug_idx').on(table.slug),
  statusIdx: index('trial_questions_status_idx').on(table.status),
  outcomeIdx: index('trial_questions_outcome_idx').on(table.outcome),
  statusCheck: check(
    'trial_questions_status_check',
    sql`${table.status} IN ('live', 'coming_soon')`
  ),
  outcomeCheck: check(
    'trial_questions_outcome_check',
    sql`${table.outcome} IN ('Pending', 'YES', 'NO')`
  ),
  sortOrderCheck: check(
    'trial_questions_sort_order_check',
    sql`${table.sortOrder} >= 0`
  ),
}))

export const trialMonitorConfigs = pgTable('trial_monitor_configs', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  webSearchEnabled: boolean('web_search_enabled').notNull().default(true),
  runIntervalHours: integer('run_interval_hours').notNull().default(6),
  lookaheadDays: integer('lookahead_days').notNull().default(30),
  overdueRecheckHours: integer('overdue_recheck_hours').notNull().default(24),
  maxQuestionsPerRun: integer('max_questions_per_run').notNull().default(25),
  cronProcessingConcurrency: integer('cron_processing_concurrency').notNull().default(1),
  manualProcessingConcurrency: integer('manual_processing_concurrency').notNull().default(3),
  verifierModelKey: text('verifier_model_key').notNull().default('gpt-5.4'),
  minCandidateConfidence: real('min_candidate_confidence').notNull().default(0.8),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  runIntervalHoursCheck: check(
    'trial_monitor_configs_run_interval_hours_check',
    sql`${table.runIntervalHours} >= 1 AND ${table.runIntervalHours} <= 168`
  ),
  lookaheadDaysCheck: check(
    'trial_monitor_configs_lookahead_days_check',
    sql`${table.lookaheadDays} >= 0 AND ${table.lookaheadDays} <= 365`
  ),
  overdueRecheckHoursCheck: check(
    'trial_monitor_configs_overdue_recheck_hours_check',
    sql`${table.overdueRecheckHours} >= 1 AND ${table.overdueRecheckHours} <= 720`
  ),
  maxQuestionsPerRunCheck: check(
    'trial_monitor_configs_max_questions_per_run_check',
    sql`${table.maxQuestionsPerRun} >= 1 AND ${table.maxQuestionsPerRun} <= 500`
  ),
  cronProcessingConcurrencyCheck: check(
    'trial_monitor_configs_cron_processing_concurrency_check',
    sql`${table.cronProcessingConcurrency} >= 1 AND ${table.cronProcessingConcurrency} <= 12`
  ),
  manualProcessingConcurrencyCheck: check(
    'trial_monitor_configs_manual_processing_concurrency_check',
    sql`${table.manualProcessingConcurrency} >= 1 AND ${table.manualProcessingConcurrency} <= 12`
  ),
  minCandidateConfidenceCheck: check(
    'trial_monitor_configs_min_candidate_confidence_check',
    sql`${table.minCandidateConfidence} >= 0 AND ${table.minCandidateConfidence} <= 1`
  ),
}))

export const trialSyncConfigs = pgTable('trial_sync_configs', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  syncIntervalHours: integer('sync_interval_hours').notNull().default(24),
  recentCompletionLookbackDays: integer('recent_completion_lookback_days').notNull().default(180),
  reconcileIntervalHours: integer('reconcile_interval_hours').notNull().default(168),
  lastSuccessfulUpdatePostDate: utcDate('last_successful_update_post_date'),
  lastSuccessfulDataTimestamp: text('last_successful_data_timestamp'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  syncIntervalHoursCheck: check(
    'trial_sync_configs_sync_interval_hours_check',
    sql`${table.syncIntervalHours} >= 1 AND ${table.syncIntervalHours} <= 168`
  ),
  recentCompletionLookbackDaysCheck: check(
    'trial_sync_configs_recent_completion_lookback_days_check',
    sql`${table.recentCompletionLookbackDays} >= 1 AND ${table.recentCompletionLookbackDays} <= 1095`
  ),
  reconcileIntervalHoursCheck: check(
    'trial_sync_configs_reconcile_interval_hours_check',
    sql`${table.reconcileIntervalHours} >= 1 AND ${table.reconcileIntervalHours} <= 720`
  ),
}))

export const trialSyncRuns = pgTable('trial_sync_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  triggerSource: text('trigger_source').notNull().default('manual'),
  mode: text('mode').notNull().default('incremental'),
  status: text('status').notNull().default('running'),
  sourceDataTimestamp: text('source_data_timestamp'),
  studiesFetched: integer('studies_fetched').notNull().default(0),
  studiesMatched: integer('studies_matched').notNull().default(0),
  trialsUpserted: integer('trials_upserted').notNull().default(0),
  questionsUpserted: integer('questions_upserted').notNull().default(0),
  marketsOpened: integer('markets_opened').notNull().default(0),
  errorSummary: text('error_summary'),
  startedAt: utcTimestamp('started_at').notNull().$defaultFn(() => new Date()),
  completedAt: utcTimestamp('completed_at'),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  triggerSourceCheck: check(
    'trial_sync_runs_trigger_source_check',
    sql`${table.triggerSource} IN ('cron', 'manual')`
  ),
  modeCheck: check(
    'trial_sync_runs_mode_check',
    sql`${table.mode} IN ('incremental', 'reconcile')`
  ),
  statusCheck: check(
    'trial_sync_runs_status_check',
    sql`${table.status} IN ('running', 'completed', 'failed', 'skipped')`
  ),
  studiesFetchedCheck: check(
    'trial_sync_runs_studies_fetched_check',
    sql`${table.studiesFetched} >= 0`
  ),
  studiesMatchedCheck: check(
    'trial_sync_runs_studies_matched_check',
    sql`${table.studiesMatched} >= 0`
  ),
  trialsUpsertedCheck: check(
    'trial_sync_runs_trials_upserted_check',
    sql`${table.trialsUpserted} >= 0`
  ),
  questionsUpsertedCheck: check(
    'trial_sync_runs_questions_upserted_check',
    sql`${table.questionsUpserted} >= 0`
  ),
  marketsOpenedCheck: check(
    'trial_sync_runs_markets_opened_check',
    sql`${table.marketsOpened} >= 0`
  ),
  startedAtIdx: index('trial_sync_runs_started_at_idx').on(table.startedAt),
  modeStartedAtIdx: index('trial_sync_runs_mode_started_at_idx').on(table.mode, table.startedAt),
}))

export const trialSyncRunItems = pgTable('trial_sync_run_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => trialSyncRuns.id, { onDelete: 'cascade' }),
  trialId: text('trial_id').references(() => phase2Trials.id, { onDelete: 'set null' }),
  nctNumber: text('nct_number').notNull(),
  shortTitle: text('short_title').notNull(),
  sponsorName: text('sponsor_name').notNull(),
  currentStatus: text('current_status').notNull(),
  estPrimaryCompletionDate: utcDate('est_primary_completion_date').notNull(),
  changeType: text('change_type').notNull(),
  changeSummary: text('change_summary'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  changeTypeCheck: check(
    'trial_sync_run_items_change_type_check',
    sql`${table.changeType} IN ('inserted', 'updated')`
  ),
  runCreatedAtIdx: index('trial_sync_run_items_run_created_at_idx').on(table.runId, table.createdAt),
  runChangeTypeIdx: index('trial_sync_run_items_run_change_type_idx').on(table.runId, table.changeType),
  nctNumberIdx: index('trial_sync_run_items_nct_number_idx').on(table.nctNumber),
}))

export const trialMonitorRuns = pgTable('trial_monitor_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  triggerSource: text('trigger_source').notNull().default('manual'),
  status: text('status').notNull().default('running'),
  questionsScanned: integer('questions_scanned').notNull().default(0),
  candidatesCreated: integer('candidates_created').notNull().default(0),
  errorSummary: text('error_summary'),
  debugLog: text('debug_log'),
  verifierModelKey: text('verifier_model_key'),
  scopedNctNumber: text('scoped_nct_number'),
  startedAt: utcTimestamp('started_at').notNull().$defaultFn(() => new Date()),
  completedAt: utcTimestamp('completed_at'),
  stopRequestedAt: utcTimestamp('stop_requested_at'),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  triggerSourceCheck: check(
    'trial_monitor_runs_trigger_source_check',
    sql`${table.triggerSource} IN ('cron', 'manual')`
  ),
  statusCheck: check(
    'trial_monitor_runs_status_check',
    sql`${table.status} IN ('running', 'completed', 'failed', 'paused')`
  ),
  questionsScannedCheck: check(
    'trial_monitor_runs_questions_scanned_check',
    sql`${table.questionsScanned} >= 0`
  ),
  candidatesCreatedCheck: check(
    'trial_monitor_runs_candidates_created_check',
    sql`${table.candidatesCreated} >= 0`
  ),
  startedAtIdx: index('trial_monitor_runs_started_at_idx').on(table.startedAt),
}))

export const trialOutcomeCandidates = pgTable('trial_outcome_candidates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trialQuestionId: text('trial_question_id').notNull().references(() => trialQuestions.id, { onDelete: 'cascade' }),
  proposedOutcome: text('proposed_outcome').notNull(),
  proposedOutcomeDate: utcTimestamp('proposed_outcome_date'),
  confidence: real('confidence').notNull(),
  summary: text('summary').notNull(),
  verifierModelKey: text('verifier_model_key').notNull(),
  providerResponseId: text('provider_response_id'),
  evidenceHash: text('evidence_hash').notNull(),
  status: text('status').notNull().default('pending_review'),
  reviewedByUserId: text('reviewed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reviewNotes: text('review_notes'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
  reviewedAt: utcTimestamp('reviewed_at'),
}, (table) => ({
  proposedOutcomeCheck: check(
    'trial_outcome_candidates_proposed_outcome_check',
    sql`${table.proposedOutcome} IN ('YES', 'NO', 'NO_DECISION')`
  ),
  confidenceCheck: check(
    'trial_outcome_candidates_confidence_check',
    sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
  ),
  statusCheck: check(
    'trial_outcome_candidates_status_check',
    sql`${table.status} IN ('pending_review', 'accepted', 'rejected', 'superseded', 'dismissed')`
  ),
  questionEvidenceHashUniqueIdx: uniqueIndex('trial_outcome_candidates_question_outcome_hash_idx').on(
    table.trialQuestionId,
    table.proposedOutcome,
    table.evidenceHash,
  ),
  statusCreatedAtIdx: index('trial_outcome_candidates_status_created_at_idx').on(table.status, table.createdAt),
  questionCreatedAtIdx: index('trial_outcome_candidates_question_created_at_idx').on(table.trialQuestionId, table.createdAt),
}))

export const trialOutcomeCandidateEvidence = pgTable('trial_outcome_candidate_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  candidateId: text('candidate_id').notNull().references(() => trialOutcomeCandidates.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  publishedAt: utcTimestamp('published_at'),
  excerpt: text('excerpt').notNull(),
  domain: text('domain').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  sourceTypeCheck: check(
    'trial_outcome_candidate_evidence_source_type_check',
    sql`${table.sourceType} IN ('clinicaltrials', 'sponsor', 'stored_source', 'web_search')`
  ),
  candidateDisplayOrderIdx: index('trial_outcome_candidate_evidence_candidate_display_order_idx').on(
    table.candidateId,
    table.displayOrder,
  ),
}))

export const trialQuestionOutcomeHistory = pgTable('trial_question_outcome_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trialQuestionId: text('trial_question_id').notNull().references(() => trialQuestions.id, { onDelete: 'cascade' }),
  previousOutcome: text('previous_outcome'),
  previousOutcomeDate: utcTimestamp('previous_outcome_date'),
  nextOutcome: text('next_outcome').notNull(),
  nextOutcomeDate: utcTimestamp('next_outcome_date'),
  changedAt: utcTimestamp('changed_at').notNull().$defaultFn(() => new Date()),
  changeSource: text('change_source').notNull(),
  changedByUserId: text('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reviewCandidateId: text('review_candidate_id').references(() => trialOutcomeCandidates.id, { onDelete: 'set null' }),
  notes: text('notes'),
}, (table) => ({
  previousOutcomeCheck: check(
    'trial_question_outcome_history_previous_outcome_check',
    sql`${table.previousOutcome} IS NULL OR ${table.previousOutcome} IN ('Pending', 'YES', 'NO')`
  ),
  nextOutcomeCheck: check(
    'trial_question_outcome_history_next_outcome_check',
    sql`${table.nextOutcome} IN ('Pending', 'YES', 'NO')`
  ),
  changeSourceCheck: check(
    'trial_question_outcome_history_change_source_check',
    sql`${table.changeSource} IN ('manual_admin', 'accepted_candidate')`
  ),
  questionChangedAtIdx: index('trial_question_outcome_history_question_changed_at_idx').on(
    table.trialQuestionId,
    table.changedAt,
  ),
  changedAtIdx: index('trial_question_outcome_history_changed_at_idx').on(table.changedAt),
  reviewCandidateUniqueIdx: uniqueIndex('trial_question_outcome_history_review_candidate_id_idx').on(table.reviewCandidateId),
}))

export const fdaCalendarEvents = pgTable('fda_calendar_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyName: text('company_name').notNull(),
  symbols: text('symbols').notNull(),
  drugName: text('drug_name').notNull(),
  applicationType: text('application_type').notNull(),
  decisionDate: utcDate('decision_date').notNull(),
  eventDescription: text('event_description').notNull(),
  outcome: text('outcome').notNull().default('Pending'),
  outcomeDate: utcTimestamp('outcome_date'),
  decisionDateKind: text('decision_date_kind').notNull().default('hard'),
  cnpvAwardDate: utcDate('cnpv_award_date'),
  drugStatus: text('drug_status'),
  therapeuticArea: text('therapeutic_area'),
  lastMonitoredAt: utcTimestamp('last_monitored_at'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
  scrapedAt: utcTimestamp('scraped_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  identityIdx: uniqueIndex('fda_calendar_events_identity_idx').on(
    table.companyName,
    table.drugName,
    table.applicationType,
    table.decisionDate,
  ),
  decisionDateIdx: index('fda_calendar_events_decision_date_idx').on(table.decisionDate),
  outcomeIdx: index('fda_calendar_events_outcome_idx').on(table.outcome),
  outcomeCheck: check(
    'fda_calendar_events_outcome_check',
    sql`${table.outcome} IN ('Pending', 'Approved', 'Rejected')`
  ),
  decisionDateKindCheck: check(
    'fda_calendar_events_decision_date_kind_check',
    sql`${table.decisionDateKind} IN ('hard', 'soft')`
  ),
}))

export const fdaEventExternalIds = pgTable('fda_event_external_ids', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text('event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  idType: text('id_type').notNull(),
  idValue: text('id_value').notNull(),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  eventIdTypeUniqueIdx: uniqueIndex('fda_event_external_ids_event_id_type_idx').on(table.eventId, table.idType),
  idTypeValueIdx: index('fda_event_external_ids_type_value_idx').on(table.idType, table.idValue),
  idTypeCheck: check(
    'fda_event_external_ids_type_check',
    sql`${table.idType} IN ('external_key', 'nct', 'rtt_detail')`
  ),
}))

export const fdaEventSources = pgTable('fda_event_sources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text('event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  label: text('label'),
  url: text('url').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  eventSourceUrlUniqueIdx: uniqueIndex('fda_event_sources_event_source_url_idx').on(table.eventId, table.sourceType, table.url),
  eventSourceOrderIdx: index('fda_event_sources_event_source_order_idx').on(table.eventId, table.displayOrder),
  sourceTypeCheck: check(
    'fda_event_sources_type_check',
    sql`${table.sourceType} IN ('primary', 'news_link', 'reference')`
  ),
}))

export const fdaEventContexts = pgTable('fda_event_contexts', {
  eventId: text('event_id').primaryKey().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  rivalDrugs: text('rival_drugs'),
  marketPotential: text('market_potential'),
  otherApprovals: text('other_approvals'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

export const fdaEventAnalyses = pgTable('fda_event_analyses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text('event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  analysisType: text('analysis_type').notNull(),
  content: text('content').notNull(),
  modelKey: text('model_key'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  eventAnalysisUniqueIdx: uniqueIndex('fda_event_analyses_event_type_idx').on(table.eventId, table.analysisType),
  analysisTypeCheck: check(
    'fda_event_analyses_type_check',
    sql`${table.analysisType} IN ('meta_analysis')`
  ),
}))

export const eventMonitorConfigs = pgTable('event_monitor_configs', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  runIntervalHours: integer('run_interval_hours').notNull().default(6),
  hardLookaheadDays: integer('hard_lookahead_days').notNull().default(7),
  softLookaheadDays: integer('soft_lookahead_days').notNull().default(14),
  overdueRecheckHours: integer('overdue_recheck_hours').notNull().default(24),
  maxEventsPerRun: integer('max_events_per_run').notNull().default(25),
  verifierModelKey: text('verifier_model_key').notNull().default('gpt-5.4'),
  minCandidateConfidence: real('min_candidate_confidence').notNull().default(0.8),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  runIntervalHoursCheck: check(
    'event_monitor_configs_run_interval_hours_check',
    sql`${table.runIntervalHours} >= 1 AND ${table.runIntervalHours} <= 168`
  ),
  hardLookaheadDaysCheck: check(
    'event_monitor_configs_hard_lookahead_days_check',
    sql`${table.hardLookaheadDays} >= 0 AND ${table.hardLookaheadDays} <= 365`
  ),
  softLookaheadDaysCheck: check(
    'event_monitor_configs_soft_lookahead_days_check',
    sql`${table.softLookaheadDays} >= 0 AND ${table.softLookaheadDays} <= 365`
  ),
  overdueRecheckHoursCheck: check(
    'event_monitor_configs_overdue_recheck_hours_check',
    sql`${table.overdueRecheckHours} >= 1 AND ${table.overdueRecheckHours} <= 720`
  ),
  maxEventsPerRunCheck: check(
    'event_monitor_configs_max_events_per_run_check',
    sql`${table.maxEventsPerRun} >= 1 AND ${table.maxEventsPerRun} <= 500`
  ),
  minCandidateConfidenceCheck: check(
    'event_monitor_configs_min_candidate_confidence_check',
    sql`${table.minCandidateConfidence} >= 0 AND ${table.minCandidateConfidence} <= 1`
  ),
}))

export const eventMonitorRuns = pgTable('event_monitor_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  triggerSource: text('trigger_source').notNull().default('manual'),
  status: text('status').notNull().default('running'),
  eventsScanned: integer('events_scanned').notNull().default(0),
  candidatesCreated: integer('candidates_created').notNull().default(0),
  errorSummary: text('error_summary'),
  startedAt: utcTimestamp('started_at').notNull().$defaultFn(() => new Date()),
  completedAt: utcTimestamp('completed_at'),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  triggerSourceCheck: check(
    'event_monitor_runs_trigger_source_check',
    sql`${table.triggerSource} IN ('cron', 'manual')`
  ),
  statusCheck: check(
    'event_monitor_runs_status_check',
    sql`${table.status} IN ('running', 'completed', 'failed')`
  ),
  eventsScannedCheck: check(
    'event_monitor_runs_events_scanned_check',
    sql`${table.eventsScanned} >= 0`
  ),
  candidatesCreatedCheck: check(
    'event_monitor_runs_candidates_created_check',
    sql`${table.candidatesCreated} >= 0`
  ),
  startedAtIdx: index('event_monitor_runs_started_at_idx').on(table.startedAt),
}))

export const eventOutcomeCandidates = pgTable('event_outcome_candidates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text('event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  proposedOutcome: text('proposed_outcome').notNull(),
  proposedOutcomeDate: utcTimestamp('proposed_outcome_date'),
  confidence: real('confidence').notNull(),
  summary: text('summary').notNull(),
  verifierModelKey: text('verifier_model_key').notNull(),
  providerResponseId: text('provider_response_id'),
  evidenceHash: text('evidence_hash').notNull(),
  status: text('status').notNull().default('pending_review'),
  reviewedByUserId: text('reviewed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reviewNotes: text('review_notes'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
  reviewedAt: utcTimestamp('reviewed_at'),
}, (table) => ({
  proposedOutcomeCheck: check(
    'event_outcome_candidates_proposed_outcome_check',
    sql`${table.proposedOutcome} IN ('Approved', 'Rejected')`
  ),
  confidenceCheck: check(
    'event_outcome_candidates_confidence_check',
    sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
  ),
  statusCheck: check(
    'event_outcome_candidates_status_check',
    sql`${table.status} IN ('pending_review', 'accepted', 'rejected', 'superseded')`
  ),
  eventEvidenceHashUniqueIdx: uniqueIndex('event_outcome_candidates_event_outcome_hash_idx').on(
    table.eventId,
    table.proposedOutcome,
    table.evidenceHash,
  ),
  statusCreatedAtIdx: index('event_outcome_candidates_status_created_at_idx').on(table.status, table.createdAt),
  eventCreatedAtIdx: index('event_outcome_candidates_event_created_at_idx').on(table.eventId, table.createdAt),
}))

export const eventOutcomeCandidateEvidence = pgTable('event_outcome_candidate_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  candidateId: text('candidate_id').notNull().references(() => eventOutcomeCandidates.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  publishedAt: utcTimestamp('published_at'),
  excerpt: text('excerpt').notNull(),
  domain: text('domain').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  sourceTypeCheck: check(
    'event_outcome_candidate_evidence_source_type_check',
    sql`${table.sourceType} IN ('fda', 'sponsor', 'stored_source', 'web_search')`
  ),
  candidateDisplayOrderIdx: index('event_outcome_candidate_evidence_candidate_display_order_idx').on(
    table.candidateId,
    table.displayOrder,
  ),
}))

export const marketActors = pgTable('market_actors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorType: text('actor_type').notNull(),
  modelKey: text('model_key'),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  modelKeyUniqueIdx: uniqueIndex('market_actors_model_key_idx').on(table.modelKey),
  userIdUniqueIdx: uniqueIndex('market_actors_user_id_idx').on(table.userId),
  actorTypeIdx: index('market_actors_actor_type_idx').on(table.actorType),
  actorTypeCheck: check(
    'market_actors_actor_type_check',
    sql`${table.actorType} IN ('model', 'human')`
  ),
  actorShapeCheck: check(
    'market_actors_shape_check',
    sql`(
      (${table.actorType} = 'model' AND ${table.modelKey} IS NOT NULL AND ${table.userId} IS NULL)
      OR
      (${table.actorType} = 'human' AND ${table.userId} IS NOT NULL AND ${table.modelKey} IS NULL)
    )`
  ),
}))

export const predictionMarkets = pgTable('prediction_markets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fdaEventId: text('fda_event_id').references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  trialQuestionId: text('trial_question_id').references(() => trialQuestions.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('OPEN'),
  openingProbability: real('opening_probability').notNull(),
  b: real('b').notNull().default(25000),
  qYes: real('q_yes').notNull().default(0),
  qNo: real('q_no').notNull().default(0),
  priceYes: real('price_yes').notNull().default(0.5),
  openedAt: utcTimestamp('opened_at').notNull().$defaultFn(() => new Date()),
  resolvedAt: utcTimestamp('resolved_at'),
  resolvedOutcome: text('resolved_outcome'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  fdaEventUniqueIdx: uniqueIndex('prediction_markets_fda_event_id_idx')
    .on(table.fdaEventId)
    .where(sql`${table.fdaEventId} IS NOT NULL`),
  trialQuestionUniqueIdx: uniqueIndex('prediction_markets_trial_question_id_idx')
    .on(table.trialQuestionId)
    .where(sql`${table.trialQuestionId} IS NOT NULL`),
  statusIdx: index('prediction_markets_status_idx').on(table.status),
  statusCheck: check(
    'prediction_markets_status_check',
    sql`${table.status} IN ('OPEN', 'RESOLVED')`
  ),
  openingProbabilityCheck: check(
    'prediction_markets_opening_probability_check',
    sql`${table.openingProbability} >= 0 AND ${table.openingProbability} <= 1`
  ),
  liquidityBCheck: check(
    'prediction_markets_b_check',
    sql`${table.b} > 0`
  ),
  priceYesCheck: check(
    'prediction_markets_price_yes_check',
    sql`${table.priceYes} >= 0 AND ${table.priceYes} <= 1`
  ),
  resolvedOutcomeCheck: check(
    'prediction_markets_resolved_outcome_check',
    sql`${table.resolvedOutcome} IS NULL OR ${table.resolvedOutcome} IN ('Approved', 'Rejected', 'YES', 'NO')`
  ),
  resolvedStateCheck: check(
    'prediction_markets_resolved_state_check',
    sql`(
      (${table.status} = 'OPEN' AND ${table.resolvedOutcome} IS NULL AND ${table.resolvedAt} IS NULL)
      OR
      (${table.status} = 'RESOLVED' AND ${table.resolvedOutcome} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)
    )`
  ),
  ownershipCheck: check(
    'prediction_markets_ownership_check',
    sql`(
      (${table.fdaEventId} IS NOT NULL AND ${table.trialQuestionId} IS NULL)
      OR
      (${table.fdaEventId} IS NULL AND ${table.trialQuestionId} IS NOT NULL)
    )`
  ),
}))

export const marketAccounts = pgTable('market_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorId: text('actor_id').notNull().references(() => marketActors.id, { onDelete: 'cascade' }),
  startingCash: real('starting_cash').notNull().default(100000),
  cashBalance: real('cash_balance').notNull().default(100000),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  actorUniqueIdx: uniqueIndex('market_accounts_actor_id_idx').on(table.actorId),
  startingCashCheck: check(
    'market_accounts_starting_cash_check',
    sql`${table.startingCash} >= 0`
  ),
  cashBalanceCheck: check(
    'market_accounts_cash_balance_check',
    sql`${table.cashBalance} >= 0`
  ),
}))

export const marketPositions = pgTable('market_positions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => marketActors.id, { onDelete: 'cascade' }),
  yesShares: real('yes_shares').notNull().default(0),
  noShares: real('no_shares').notNull().default(0),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  marketActorUniqueIdx: uniqueIndex('market_positions_market_actor_idx').on(table.marketId, table.actorId),
  marketIdx: index('market_positions_market_idx').on(table.marketId),
  actorIdx: index('market_positions_actor_idx').on(table.actorId),
  yesSharesCheck: check(
    'market_positions_yes_shares_check',
    sql`${table.yesShares} >= 0`
  ),
  noSharesCheck: check(
    'market_positions_no_shares_check',
    sql`${table.noShares} >= 0`
  ),
}))

export const marketRuns = pgTable('market_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runDate: utcDate('run_date').notNull(),
  status: text('status').notNull().default('running'),
  openMarkets: integer('open_markets').notNull().default(0),
  totalActions: integer('total_actions').notNull().default(0),
  processedActions: integer('processed_actions').notNull().default(0),
  okCount: integer('ok_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failureReason: text('failure_reason'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
  completedAt: utcTimestamp('completed_at'),
}, (table) => ({
  runDateIdx: index('market_runs_run_date_idx').on(table.runDate),
  statusIdx: index('market_runs_status_idx').on(table.status),
  createdAtIdx: index('market_runs_created_at_idx').on(table.createdAt),
  statusCheck: check(
    'market_runs_status_check',
    sql`${table.status} IN ('running', 'completed', 'failed')`
  ),
  openMarketsCheck: check(
    'market_runs_open_markets_check',
    sql`${table.openMarkets} >= 0`
  ),
  totalActionsCheck: check(
    'market_runs_total_actions_check',
    sql`${table.totalActions} >= 0`
  ),
  processedActionsCheck: check(
    'market_runs_processed_actions_check',
    sql`${table.processedActions} >= 0 AND ${table.processedActions} <= ${table.totalActions}`
  ),
  okCountCheck: check(
    'market_runs_ok_count_check',
    sql`${table.okCount} >= 0`
  ),
  errorCountCheck: check(
    'market_runs_error_count_check',
    sql`${table.errorCount} >= 0`
  ),
  skippedCountCheck: check(
    'market_runs_skipped_count_check',
    sql`${table.skippedCount} >= 0`
  ),
  countSumCheck: check(
    'market_runs_count_sum_check',
    sql`${table.okCount} + ${table.errorCount} + ${table.skippedCount} <= ${table.processedActions}`
  ),
}))

export const ai2Batches = pgTable('ai2_batches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dataset: text('dataset').notNull(),
  status: text('status').notNull(),
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  error: text('error'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  datasetIdx: index('ai2_batches_dataset_idx').on(table.dataset),
  statusIdx: index('ai2_batches_status_idx').on(table.status),
  datasetStatusIdx: index('ai2_batches_dataset_status_idx').on(table.dataset, table.status),
  createdAtIdx: index('ai2_batches_created_at_idx').on(table.createdAt),
  datasetCheck: check(
    'ai2_batches_dataset_check',
    sql`${table.dataset} IN ('toy', 'live')`,
  ),
  statusCheck: check(
    'ai2_batches_status_check',
    sql`${table.status} IN ('collecting', 'waiting', 'ready', 'clearing', 'cleared', 'failed', 'reset')`,
  ),
}))

export const marketRunLogs = pgTable('market_run_logs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => marketRuns.id, { onDelete: 'cascade' }),
  logType: text('log_type').notNull().default('activity'),
  message: text('message').notNull(),
  completedActions: integer('completed_actions'),
  totalActions: integer('total_actions'),
  okCount: integer('ok_count'),
  errorCount: integer('error_count'),
  skippedCount: integer('skipped_count'),
  marketId: text('market_id').references(() => predictionMarkets.id, { onDelete: 'set null' }),
  fdaEventId: text('fda_event_id').references(() => fdaCalendarEvents.id, { onDelete: 'set null' }),
  trialQuestionId: text('trial_question_id').references(() => trialQuestions.id, { onDelete: 'set null' }),
  actorId: text('actor_id').references(() => marketActors.id, { onDelete: 'set null' }),
  activityPhase: text('activity_phase'),
  action: text('action'),
  actionStatus: text('action_status'),
  amountUsd: real('amount_usd'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  runCreatedIdx: index('market_run_logs_run_created_idx').on(table.runId, table.createdAt),
  createdAtIdx: index('market_run_logs_created_at_idx').on(table.createdAt),
  actorIdx: index('market_run_logs_actor_idx').on(table.actorId),
  logTypeCheck: check(
    'market_run_logs_log_type_check',
    sql`${table.logType} IN ('system', 'activity', 'progress', 'error')`
  ),
  activityPhaseCheck: check(
    'market_run_logs_activity_phase_check',
    sql`${table.activityPhase} IS NULL OR ${table.activityPhase} IN ('running', 'waiting')`
  ),
  actionStatusCheck: check(
    'market_run_logs_action_status_check',
    sql`${table.actionStatus} IS NULL OR ${table.actionStatus} IN ('ok', 'error', 'skipped')`
  ),
  completedActionsCheck: check(
    'market_run_logs_completed_actions_check',
    sql`${table.completedActions} IS NULL OR ${table.completedActions} >= 0`
  ),
  totalActionsCheck: check(
    'market_run_logs_total_actions_check',
    sql`${table.totalActions} IS NULL OR ${table.totalActions} >= 0`
  ),
  okCountCheck: check(
    'market_run_logs_ok_count_check',
    sql`${table.okCount} IS NULL OR ${table.okCount} >= 0`
  ),
  errorCountCheck: check(
    'market_run_logs_error_count_check',
    sql`${table.errorCount} IS NULL OR ${table.errorCount} >= 0`
  ),
  skippedCountCheck: check(
    'market_run_logs_skipped_count_check',
    sql`${table.skippedCount} IS NULL OR ${table.skippedCount} >= 0`
  ),
}))

export const marketActions = pgTable('market_actions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').references(() => marketRuns.id, { onDelete: 'cascade' }),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  fdaEventId: text('fda_event_id').references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  trialQuestionId: text('trial_question_id').references(() => trialQuestions.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => marketActors.id, { onDelete: 'cascade' }),
  runDate: utcDate('run_date').notNull(),
  actionSource: text('action_source').notNull().default('cycle'),
  action: text('action').notNull(),
  usdAmount: real('usd_amount').notNull().default(0),
  sharesDelta: real('shares_delta').notNull().default(0),
  priceBefore: real('price_before').notNull(),
  priceAfter: real('price_after').notNull(),
  explanation: text('explanation').notNull(),
  status: text('status').notNull().default('ok'),
  errorCode: text('error_code'),
  errorDetails: text('error_details'),
  error: text('error'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  marketActorRunUniqueIdx: uniqueIndex('market_actions_market_actor_run_idx')
    .on(table.marketId, table.actorId, table.runDate)
    .where(sql`${table.actionSource} = 'cycle'`),
  runIdIdx: index('market_actions_run_id_idx').on(table.runId),
  marketCreatedIdx: index('market_actions_market_created_idx').on(table.marketId, table.createdAt),
  actorIdx: index('market_actions_actor_idx').on(table.actorId),
  actorCreatedIdx: index('market_actions_actor_created_idx').on(table.actorId, table.createdAt),
  actionSourceIdx: index('market_actions_action_source_idx').on(table.actionSource),
  statusIdx: index('market_actions_status_idx').on(table.status),
  actionSourceCheck: check(
    'market_actions_action_source_check',
    sql`${table.actionSource} IN ('cycle', 'human')`
  ),
  actionSourceShapeCheck: check(
    'market_actions_action_source_shape_check',
    sql`(
      (${table.actionSource} = 'cycle' AND ${table.runId} IS NOT NULL)
      OR
      (${table.actionSource} = 'human' AND ${table.runId} IS NULL)
    )`
  ),
  ownershipCheck: check(
    'market_actions_ownership_check',
    sql`(
      (${table.fdaEventId} IS NOT NULL AND ${table.trialQuestionId} IS NULL)
      OR
      (${table.fdaEventId} IS NULL AND ${table.trialQuestionId} IS NOT NULL)
    )`
  ),
  actionCheck: check(
    'market_actions_action_check',
    sql`${table.action} IN ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD')`
  ),
  statusCheck: check(
    'market_actions_status_check',
    sql`${table.status} IN ('ok', 'error', 'skipped')`
  ),
  usdAmountCheck: check(
    'market_actions_usd_amount_check',
    sql`${table.usdAmount} >= 0`
  ),
  priceBeforeCheck: check(
    'market_actions_price_before_check',
    sql`${table.priceBefore} >= 0 AND ${table.priceBefore} <= 1`
  ),
  priceAfterCheck: check(
    'market_actions_price_after_check',
    sql`${table.priceAfter} >= 0 AND ${table.priceAfter} <= 1`
  ),
  actionDirectionCheck: check(
    'market_actions_direction_check',
    sql`(
      (${table.action} IN ('BUY_YES', 'BUY_NO') AND ${table.sharesDelta} >= 0 AND ${table.usdAmount} >= 0)
      OR
      (${table.action} IN ('SELL_YES', 'SELL_NO') AND ${table.sharesDelta} <= 0 AND ${table.usdAmount} >= 0)
      OR
      (${table.action} = 'HOLD' AND ${table.sharesDelta} = 0 AND ${table.usdAmount} = 0)
    )`
  ),
}))

export const modelDecisionSnapshots = pgTable('model_decision_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').references(() => marketRuns.id, { onDelete: 'set null' }),
  runDate: utcDate('run_date').notNull(),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  fdaEventId: text('fda_event_id').references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  trialQuestionId: text('trial_question_id').references(() => trialQuestions.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => marketActors.id, { onDelete: 'cascade' }),
  runSource: text('run_source').notNull(),
  approvalProbability: real('approval_probability').notNull(),
  yesProbability: real('yes_probability'),
  binaryCall: text('binary_call').notNull(),
  confidence: integer('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  proposedActionType: text('proposed_action_type').notNull(),
  proposedAmountUsd: real('proposed_amount_usd').notNull().default(0),
  proposedExplanation: text('proposed_explanation').notNull(),
  marketPriceYes: real('market_price_yes'),
  marketPriceNo: real('market_price_no'),
  cashAvailable: real('cash_available'),
  yesSharesHeld: real('yes_shares_held'),
  noSharesHeld: real('no_shares_held'),
  maxBuyUsd: real('max_buy_usd'),
  maxSellYesUsd: real('max_sell_yes_usd'),
  maxSellNoUsd: real('max_sell_no_usd'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  estimatedCostUsd: real('estimated_cost_usd'),
  costSource: text('cost_source'),
  cacheCreationInputTokens5m: integer('cache_creation_input_tokens_5m'),
  cacheCreationInputTokens1h: integer('cache_creation_input_tokens_1h'),
  cacheReadInputTokens: integer('cache_read_input_tokens'),
  webSearchRequests: integer('web_search_requests'),
  inferenceGeo: text('inference_geo'),
  linkedMarketActionId: text('linked_market_action_id').references(() => marketActions.id, { onDelete: 'set null' }),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  runIdIdx: index('model_decision_snapshots_run_id_idx').on(table.runId),
  runDateRunSourceIdx: index('model_decision_snapshots_run_date_run_source_idx').on(table.runDate, table.runSource),
  eventActorCreatedIdx: index('model_decision_snapshots_event_actor_created_idx').on(
    table.fdaEventId,
    table.actorId,
    table.createdAt,
  ),
  questionActorCreatedIdx: index('model_decision_snapshots_question_actor_created_idx').on(
    table.trialQuestionId,
    table.actorId,
    table.createdAt,
  ),
  marketActorCreatedIdx: index('model_decision_snapshots_market_actor_created_idx').on(
    table.marketId,
    table.actorId,
    table.createdAt,
  ),
  marketActorRunDateCreatedIdx: index('model_decision_snapshots_market_actor_run_date_created_idx').on(
    table.marketId,
    table.actorId,
    table.runDate,
    table.createdAt,
  ),
  runSourceIdx: index('model_decision_snapshots_run_source_idx').on(table.runSource),
  runSourceCheck: check(
    'model_decision_snapshots_run_source_check',
    sql`${table.runSource} IN ('manual', 'cycle')`,
  ),
  runShapeCheck: check(
    'model_decision_snapshots_run_shape_check',
    sql`(
      (${table.runSource} = 'cycle' AND ${table.runId} IS NOT NULL)
      OR
      (${table.runSource} = 'manual' AND ${table.runId} IS NULL)
    )`,
  ),
  binaryCallCheck: check(
    'model_decision_snapshots_binary_call_check',
    sql`${table.binaryCall} IN ('approved', 'rejected', 'yes', 'no')`,
  ),
  confidenceCheck: check(
    'model_decision_snapshots_confidence_check',
    sql`${table.confidence} >= 50 AND ${table.confidence} <= 100`,
  ),
  approvalProbabilityCheck: check(
    'model_decision_snapshots_approval_probability_check',
    sql`${table.approvalProbability} >= 0 AND ${table.approvalProbability} <= 1`,
  ),
  yesProbabilityCheck: check(
    'model_decision_snapshots_yes_probability_check',
    sql`${table.yesProbability} IS NULL OR (${table.yesProbability} >= 0 AND ${table.yesProbability} <= 1)`,
  ),
  ownershipCheck: check(
    'model_decision_snapshots_ownership_check',
    sql`(
      (${table.fdaEventId} IS NOT NULL AND ${table.trialQuestionId} IS NULL)
      OR
      (${table.fdaEventId} IS NULL AND ${table.trialQuestionId} IS NOT NULL)
    )`
  ),
  proposedActionCheck: check(
    'model_decision_snapshots_proposed_action_check',
    sql`${table.proposedActionType} IN ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD')`,
  ),
  proposedAmountCheck: check(
    'model_decision_snapshots_proposed_amount_check',
    sql`${table.proposedAmountUsd} >= 0`,
  ),
  marketPriceYesCheck: check(
    'model_decision_snapshots_market_price_yes_check',
    sql`${table.marketPriceYes} IS NULL OR (${table.marketPriceYes} >= 0 AND ${table.marketPriceYes} <= 1)`,
  ),
  marketPriceNoCheck: check(
    'model_decision_snapshots_market_price_no_check',
    sql`${table.marketPriceNo} IS NULL OR (${table.marketPriceNo} >= 0 AND ${table.marketPriceNo} <= 1)`,
  ),
  nonNegativeCashCheck: check(
    'model_decision_snapshots_cash_available_check',
    sql`${table.cashAvailable} IS NULL OR ${table.cashAvailable} >= 0`,
  ),
  nonNegativeYesSharesCheck: check(
    'model_decision_snapshots_yes_shares_held_check',
    sql`${table.yesSharesHeld} IS NULL OR ${table.yesSharesHeld} >= 0`,
  ),
  nonNegativeNoSharesCheck: check(
    'model_decision_snapshots_no_shares_held_check',
    sql`${table.noSharesHeld} IS NULL OR ${table.noSharesHeld} >= 0`,
  ),
  nonNegativeMaxBuyCheck: check(
    'model_decision_snapshots_max_buy_usd_check',
    sql`${table.maxBuyUsd} IS NULL OR ${table.maxBuyUsd} >= 0`,
  ),
  nonNegativeMaxSellYesCheck: check(
    'model_decision_snapshots_max_sell_yes_usd_check',
    sql`${table.maxSellYesUsd} IS NULL OR ${table.maxSellYesUsd} >= 0`,
  ),
  nonNegativeMaxSellNoCheck: check(
    'model_decision_snapshots_max_sell_no_usd_check',
    sql`${table.maxSellNoUsd} IS NULL OR ${table.maxSellNoUsd} >= 0`,
  ),
  costSourceCheck: check(
    'model_decision_snapshots_cost_source_check',
    sql`${table.costSource} IS NULL OR ${table.costSource} IN ('provider', 'estimated', 'subscription')`,
  ),
}))

export const marketPriceSnapshots = pgTable('market_price_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  snapshotDate: utcDate('snapshot_date').notNull(),
  priceYes: real('price_yes').notNull(),
  qYes: real('q_yes').notNull(),
  qNo: real('q_no').notNull(),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  marketDateUniqueIdx: uniqueIndex('market_price_snapshots_market_date_idx').on(table.marketId, table.snapshotDate),
  marketIdx: index('market_price_snapshots_market_idx').on(table.marketId),
  priceYesCheck: check(
    'market_price_snapshots_price_yes_check',
    sql`${table.priceYes} >= 0 AND ${table.priceYes} <= 1`
  ),
}))

export const marketDailySnapshots = pgTable('market_daily_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  snapshotDate: utcDate('snapshot_date').notNull(),
  actorId: text('actor_id').notNull().references(() => marketActors.id, { onDelete: 'cascade' }),
  cashBalance: real('cash_balance').notNull(),
  positionsValue: real('positions_value').notNull(),
  totalEquity: real('total_equity').notNull(),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  actorDateUniqueIdx: uniqueIndex('market_daily_snapshots_actor_date_idx').on(table.actorId, table.snapshotDate),
  actorIdx: index('market_daily_snapshots_actor_idx').on(table.actorId),
  cashBalanceCheck: check(
    'market_daily_snapshots_cash_balance_check',
    sql`${table.cashBalance} >= 0`
  ),
  positionsValueCheck: check(
    'market_daily_snapshots_positions_value_check',
    sql`${table.positionsValue} >= 0`
  ),
  totalEquityCheck: check(
    'market_daily_snapshots_total_equity_check',
    sql`${table.totalEquity} >= 0`
  ),
}))

export const marketRuntimeConfigs = pgTable('market_runtime_configs', {
  id: text('id').primaryKey(),
  warmupRunCount: integer('warmup_run_count').notNull().default(3),
  warmupMaxTradeUsd: real('warmup_max_trade_usd').notNull().default(1000),
  warmupBuyCashFraction: real('warmup_buy_cash_fraction').notNull().default(0.02),
  steadyMaxTradeUsd: real('steady_max_trade_usd').notNull().default(1000),
  steadyBuyCashFraction: real('steady_buy_cash_fraction').notNull().default(0.02),
  maxPositionPerSideShares: real('max_position_per_side_shares').notNull().default(10000),
  openingLmsrB: real('opening_lmsr_b').notNull().default(100000),
  toyTrialCount: integer('toy_trial_count').notNull().default(2),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: utcTimestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  warmupRunCountCheck: check(
    'market_runtime_configs_warmup_run_count_check',
    sql`${table.warmupRunCount} >= 0 AND ${table.warmupRunCount} <= 365`
  ),
  warmupMaxTradeUsdCheck: check(
    'market_runtime_configs_warmup_max_trade_usd_check',
    sql`${table.warmupMaxTradeUsd} >= 0 AND ${table.warmupMaxTradeUsd} <= 10000000`
  ),
  warmupBuyCashFractionCheck: check(
    'market_runtime_configs_warmup_buy_cash_fraction_check',
    sql`${table.warmupBuyCashFraction} >= 0 AND ${table.warmupBuyCashFraction} <= 1`
  ),
  steadyMaxTradeUsdCheck: check(
    'market_runtime_configs_steady_max_trade_usd_check',
    sql`${table.steadyMaxTradeUsd} >= 0 AND ${table.steadyMaxTradeUsd} <= 10000000`
  ),
  steadyBuyCashFractionCheck: check(
    'market_runtime_configs_steady_buy_cash_fraction_check',
    sql`${table.steadyBuyCashFraction} >= 0 AND ${table.steadyBuyCashFraction} <= 1`
  ),
  maxPositionPerSideSharesCheck: check(
    'market_runtime_configs_max_position_per_side_shares_check',
    sql`${table.maxPositionPerSideShares} >= 0 AND ${table.maxPositionPerSideShares} <= 10000000`
  ),
  openingLmsrBCheck: check(
    'market_runtime_configs_opening_lmsr_b_check',
    sql`${table.openingLmsrB} > 0 AND ${table.openingLmsrB} <= 10000000`
  ),
  toyTrialCountCheck: check(
    'market_runtime_configs_toy_trial_count_check',
    sql`${table.toyTrialCount} >= 1`
  ),
}))

export const analyticsEvents = pgTable('analytics_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(),
  url: text('url').notNull(),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  sessionHash: text('session_hash'),
  elementId: text('element_id'),
  ipAddress: text('ip_address'),
  country: text('country'),
  city: text('city'),
  searchQuery: text('search_query'),
  resultCount: integer('result_count'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
})

export const crashEvents = pgTable('crash_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fingerprint: text('fingerprint').notNull(),
  digest: text('digest'),
  errorName: text('error_name'),
  message: text('message').notNull(),
  stack: text('stack'),
  componentStack: text('component_stack'),
  url: text('url'),
  path: text('path'),
  source: text('source').notNull().default('app-error'),
  requestId: text('request_id'),
  errorCode: text('error_code'),
  statusCode: integer('status_code'),
  details: text('details'),
  userId: text('user_id'),
  userEmail: text('user_email'),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  country: text('country'),
  city: text('city'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  fingerprintIdx: index('crash_events_fingerprint_idx').on(table.fingerprint),
  createdAtIdx: index('crash_events_created_at_idx').on(table.createdAt),
  digestIdx: index('crash_events_digest_idx').on(table.digest),
  pathIdx: index('crash_events_path_idx').on(table.path),
  sourceIdx: index('crash_events_source_idx').on(table.source),
}))

export const waitlistEntries = pgTable('waitlist_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  emailUniqueIdx: uniqueIndex('waitlist_entries_email_unique_idx').on(table.email),
}))

export const contactMessages = pgTable('contact_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull(),
  message: text('message').notNull(),
  createdAt: utcTimestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  createdAtIdx: index('contact_messages_created_at_idx').on(table.createdAt),
}))

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  marketActors: many(marketActors),
  trialOutcomeHistoryChanges: many(trialQuestionOutcomeHistory),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))

export const phase2TrialsRelations = relations(phase2Trials, ({ many }) => ({
  questions: many(trialQuestions),
}))

export const trialQuestionsRelations = relations(trialQuestions, ({ one, many }) => ({
  trial: one(phase2Trials, {
    fields: [trialQuestions.trialId],
    references: [phase2Trials.id],
  }),
  markets: many(predictionMarkets),
  outcomeCandidates: many(trialOutcomeCandidates),
  outcomeHistory: many(trialQuestionOutcomeHistory),
  actions: many(marketActions),
  decisionSnapshots: many(modelDecisionSnapshots),
}))

export const trialOutcomeCandidatesRelations = relations(trialOutcomeCandidates, ({ many, one }) => ({
  question: one(trialQuestions, {
    fields: [trialOutcomeCandidates.trialQuestionId],
    references: [trialQuestions.id],
  }),
  evidence: many(trialOutcomeCandidateEvidence),
  reviewedByUser: one(users, {
    fields: [trialOutcomeCandidates.reviewedByUserId],
    references: [users.id],
  }),
  historyEntries: many(trialQuestionOutcomeHistory),
}))

export const trialOutcomeCandidateEvidenceRelations = relations(trialOutcomeCandidateEvidence, ({ one }) => ({
  candidate: one(trialOutcomeCandidates, {
    fields: [trialOutcomeCandidateEvidence.candidateId],
    references: [trialOutcomeCandidates.id],
  }),
}))

export const trialQuestionOutcomeHistoryRelations = relations(trialQuestionOutcomeHistory, ({ one }) => ({
  question: one(trialQuestions, {
    fields: [trialQuestionOutcomeHistory.trialQuestionId],
    references: [trialQuestions.id],
  }),
  changedByUser: one(users, {
    fields: [trialQuestionOutcomeHistory.changedByUserId],
    references: [users.id],
  }),
  reviewCandidate: one(trialOutcomeCandidates, {
    fields: [trialQuestionOutcomeHistory.reviewCandidateId],
    references: [trialOutcomeCandidates.id],
  }),
}))

export const fdaCalendarEventsRelations = relations(fdaCalendarEvents, ({ many, one }) => ({
  predictionMarkets: many(predictionMarkets),
  externalIds: many(fdaEventExternalIds),
  sources: many(fdaEventSources),
  analyses: many(fdaEventAnalyses),
  outcomeCandidates: many(eventOutcomeCandidates),
  context: one(fdaEventContexts, {
    fields: [fdaCalendarEvents.id],
    references: [fdaEventContexts.eventId],
  }),
}))

export const fdaEventExternalIdsRelations = relations(fdaEventExternalIds, ({ one }) => ({
  event: one(fdaCalendarEvents, {
    fields: [fdaEventExternalIds.eventId],
    references: [fdaCalendarEvents.id],
  }),
}))

export const fdaEventSourcesRelations = relations(fdaEventSources, ({ one }) => ({
  event: one(fdaCalendarEvents, {
    fields: [fdaEventSources.eventId],
    references: [fdaCalendarEvents.id],
  }),
}))

export const fdaEventContextsRelations = relations(fdaEventContexts, ({ one }) => ({
  event: one(fdaCalendarEvents, {
    fields: [fdaEventContexts.eventId],
    references: [fdaCalendarEvents.id],
  }),
}))

export const fdaEventAnalysesRelations = relations(fdaEventAnalyses, ({ one }) => ({
  event: one(fdaCalendarEvents, {
    fields: [fdaEventAnalyses.eventId],
    references: [fdaCalendarEvents.id],
  }),
}))

export const eventOutcomeCandidatesRelations = relations(eventOutcomeCandidates, ({ many, one }) => ({
  event: one(fdaCalendarEvents, {
    fields: [eventOutcomeCandidates.eventId],
    references: [fdaCalendarEvents.id],
  }),
  evidence: many(eventOutcomeCandidateEvidence),
  reviewedByUser: one(users, {
    fields: [eventOutcomeCandidates.reviewedByUserId],
    references: [users.id],
  }),
}))

export const eventOutcomeCandidateEvidenceRelations = relations(eventOutcomeCandidateEvidence, ({ one }) => ({
  candidate: one(eventOutcomeCandidates, {
    fields: [eventOutcomeCandidateEvidence.candidateId],
    references: [eventOutcomeCandidates.id],
  }),
}))

export const marketActorsRelations = relations(marketActors, ({ one, many }) => ({
  user: one(users, {
    fields: [marketActors.userId],
    references: [users.id],
  }),
  account: one(marketAccounts, {
    fields: [marketActors.id],
    references: [marketAccounts.actorId],
  }),
  positions: many(marketPositions),
  actions: many(marketActions),
  decisionSnapshots: many(modelDecisionSnapshots),
  dailySnapshots: many(marketDailySnapshots),
  runLogs: many(marketRunLogs),
}))

export const predictionMarketsRelations = relations(predictionMarkets, ({ one, many }) => ({
  fdaEvent: one(fdaCalendarEvents, {
    fields: [predictionMarkets.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
  trialQuestion: one(trialQuestions, {
    fields: [predictionMarkets.trialQuestionId],
    references: [trialQuestions.id],
  }),
  positions: many(marketPositions),
  actions: many(marketActions),
  decisionSnapshots: many(modelDecisionSnapshots),
  priceSnapshots: many(marketPriceSnapshots),
}))

export const marketAccountsRelations = relations(marketAccounts, ({ one }) => ({
  actor: one(marketActors, {
    fields: [marketAccounts.actorId],
    references: [marketActors.id],
  }),
}))

export const marketPositionsRelations = relations(marketPositions, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [marketPositions.marketId],
    references: [predictionMarkets.id],
  }),
  actor: one(marketActors, {
    fields: [marketPositions.actorId],
    references: [marketActors.id],
  }),
}))

export const marketRunsRelations = relations(marketRuns, ({ many }) => ({
  actions: many(marketActions),
  logs: many(marketRunLogs),
  decisionSnapshots: many(modelDecisionSnapshots),
}))

export const marketRunLogsRelations = relations(marketRunLogs, ({ one }) => ({
  run: one(marketRuns, {
    fields: [marketRunLogs.runId],
    references: [marketRuns.id],
  }),
  trialQuestion: one(trialQuestions, {
    fields: [marketRunLogs.trialQuestionId],
    references: [trialQuestions.id],
  }),
  actor: one(marketActors, {
    fields: [marketRunLogs.actorId],
    references: [marketActors.id],
  }),
}))

export const ai2BatchesRelations = relations(ai2Batches, () => ({}))

export const marketActionsRelations = relations(marketActions, ({ one }) => ({
  run: one(marketRuns, {
    fields: [marketActions.runId],
    references: [marketRuns.id],
  }),
  market: one(predictionMarkets, {
    fields: [marketActions.marketId],
    references: [predictionMarkets.id],
  }),
  fdaEvent: one(fdaCalendarEvents, {
    fields: [marketActions.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
  trialQuestion: one(trialQuestions, {
    fields: [marketActions.trialQuestionId],
    references: [trialQuestions.id],
  }),
  actor: one(marketActors, {
    fields: [marketActions.actorId],
    references: [marketActors.id],
  }),
}))

export const modelDecisionSnapshotsRelations = relations(modelDecisionSnapshots, ({ one }) => ({
  run: one(marketRuns, {
    fields: [modelDecisionSnapshots.runId],
    references: [marketRuns.id],
  }),
  market: one(predictionMarkets, {
    fields: [modelDecisionSnapshots.marketId],
    references: [predictionMarkets.id],
  }),
  fdaEvent: one(fdaCalendarEvents, {
    fields: [modelDecisionSnapshots.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
  trialQuestion: one(trialQuestions, {
    fields: [modelDecisionSnapshots.trialQuestionId],
    references: [trialQuestions.id],
  }),
  actor: one(marketActors, {
    fields: [modelDecisionSnapshots.actorId],
    references: [marketActors.id],
  }),
  linkedMarketAction: one(marketActions, {
    fields: [modelDecisionSnapshots.linkedMarketActionId],
    references: [marketActions.id],
  }),
}))

export const marketPriceSnapshotsRelations = relations(marketPriceSnapshots, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [marketPriceSnapshots.marketId],
    references: [predictionMarkets.id],
  }),
}))

export const marketDailySnapshotsRelations = relations(marketDailySnapshots, ({ one }) => ({
  actor: one(marketActors, {
    fields: [marketDailySnapshots.actorId],
    references: [marketActors.id],
  }),
}))

export type User = typeof users.$inferSelect
export type Phase2Trial = typeof phase2Trials.$inferSelect
export type NewPhase2Trial = typeof phase2Trials.$inferInsert
export type TrialQuestion = typeof trialQuestions.$inferSelect
export type NewTrialQuestion = typeof trialQuestions.$inferInsert
export type TrialMonitorConfig = typeof trialMonitorConfigs.$inferSelect
export type NewTrialMonitorConfig = typeof trialMonitorConfigs.$inferInsert
export type TrialSyncConfig = typeof trialSyncConfigs.$inferSelect
export type NewTrialSyncConfig = typeof trialSyncConfigs.$inferInsert
export type TrialSyncRun = typeof trialSyncRuns.$inferSelect
export type NewTrialSyncRun = typeof trialSyncRuns.$inferInsert
export type TrialSyncRunItem = typeof trialSyncRunItems.$inferSelect
export type NewTrialSyncRunItem = typeof trialSyncRunItems.$inferInsert
export type TrialMonitorRun = typeof trialMonitorRuns.$inferSelect
export type NewTrialMonitorRun = typeof trialMonitorRuns.$inferInsert
export type TrialOutcomeCandidate = typeof trialOutcomeCandidates.$inferSelect
export type NewTrialOutcomeCandidate = typeof trialOutcomeCandidates.$inferInsert
export type TrialOutcomeCandidateEvidence = typeof trialOutcomeCandidateEvidence.$inferSelect
export type NewTrialOutcomeCandidateEvidence = typeof trialOutcomeCandidateEvidence.$inferInsert
export type TrialQuestionOutcomeHistory = typeof trialQuestionOutcomeHistory.$inferSelect
export type NewTrialQuestionOutcomeHistory = typeof trialQuestionOutcomeHistory.$inferInsert
export type FDAEventExternalId = typeof fdaEventExternalIds.$inferSelect
export type NewFDAEventExternalId = typeof fdaEventExternalIds.$inferInsert
export type FDAEventSource = typeof fdaEventSources.$inferSelect
export type NewFDAEventSource = typeof fdaEventSources.$inferInsert
export type FDAEventContext = typeof fdaEventContexts.$inferSelect
export type NewFDAEventContext = typeof fdaEventContexts.$inferInsert
export type FDAEventAnalysis = typeof fdaEventAnalyses.$inferSelect
export type NewFDAEventAnalysis = typeof fdaEventAnalyses.$inferInsert
export type FDACalendarEvent = typeof fdaCalendarEvents.$inferSelect
export type NewFDACalendarEvent = typeof fdaCalendarEvents.$inferInsert
export type MarketActor = typeof marketActors.$inferSelect
export type NewMarketActor = typeof marketActors.$inferInsert
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert
export type CrashEvent = typeof crashEvents.$inferSelect
export type NewCrashEvent = typeof crashEvents.$inferInsert
export type WaitlistEntry = typeof waitlistEntries.$inferSelect
export type NewWaitlistEntry = typeof waitlistEntries.$inferInsert
export type ContactMessage = typeof contactMessages.$inferSelect
export type NewContactMessage = typeof contactMessages.$inferInsert
export type PredictionMarket = typeof predictionMarkets.$inferSelect
export type NewPredictionMarket = typeof predictionMarkets.$inferInsert
export type MarketAccount = typeof marketAccounts.$inferSelect
export type NewMarketAccount = typeof marketAccounts.$inferInsert
export type MarketPosition = typeof marketPositions.$inferSelect
export type NewMarketPosition = typeof marketPositions.$inferInsert
export type MarketAction = typeof marketActions.$inferSelect
export type NewMarketAction = typeof marketActions.$inferInsert
export type ModelDecisionSnapshot = typeof modelDecisionSnapshots.$inferSelect
export type NewModelDecisionSnapshot = typeof modelDecisionSnapshots.$inferInsert
export type MarketRun = typeof marketRuns.$inferSelect
export type NewMarketRun = typeof marketRuns.$inferInsert
export type AiBatch = typeof ai2Batches.$inferSelect
export type NewAiBatch = typeof ai2Batches.$inferInsert
export type MarketRunLog = typeof marketRunLogs.$inferSelect
export type NewMarketRunLog = typeof marketRunLogs.$inferInsert
export type MarketPriceSnapshot = typeof marketPriceSnapshots.$inferSelect
export type NewMarketPriceSnapshot = typeof marketPriceSnapshots.$inferInsert
export type MarketDailySnapshot = typeof marketDailySnapshots.$inferSelect
export type NewMarketDailySnapshot = typeof marketDailySnapshots.$inferInsert
export type MarketRuntimeConfig = typeof marketRuntimeConfigs.$inferSelect
export type NewMarketRuntimeConfig = typeof marketRuntimeConfigs.$inferInsert
