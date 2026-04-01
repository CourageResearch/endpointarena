import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config()

const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
})

async function exec(statement: string) {
  await sql.unsafe(statement)
}

async function main() {
  await exec(`
    CREATE TABLE IF NOT EXISTS phase2_trials (
      id text PRIMARY KEY,
      nct_number text NOT NULL,
      short_title text NOT NULL,
      sponsor_name text NOT NULL,
      sponsor_ticker text,
      indication text NOT NULL,
      exact_phase text NOT NULL,
      intervention text NOT NULL,
      primary_endpoint text NOT NULL,
      study_start_date date,
      est_primary_completion_date date NOT NULL,
      est_study_completion_date date,
      est_results_posting_date date,
      current_status text NOT NULL,
      est_enrollment integer,
      key_locations text,
      brief_summary text NOT NULL,
      standard_betting_markets text,
      last_monitored_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT phase2_trials_est_enrollment_check CHECK (est_enrollment IS NULL OR est_enrollment >= 0)
    )
  `)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS phase2_trials_nct_number_idx ON phase2_trials (nct_number)`)
  await exec(`CREATE INDEX IF NOT EXISTS phase2_trials_primary_completion_idx ON phase2_trials (est_primary_completion_date)`)
  await exec(`CREATE INDEX IF NOT EXISTS phase2_trials_sponsor_ticker_idx ON phase2_trials (sponsor_ticker)`)
  await exec(`CREATE INDEX IF NOT EXISTS phase2_trials_current_status_idx ON phase2_trials (current_status)`)

  await exec(`
    CREATE TABLE IF NOT EXISTS trial_questions (
      id text PRIMARY KEY,
      trial_id text NOT NULL REFERENCES phase2_trials(id) ON DELETE CASCADE,
      slug text NOT NULL,
      prompt text NOT NULL,
      status text NOT NULL DEFAULT 'coming_soon',
      is_bettable boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL,
      outcome text NOT NULL DEFAULT 'Pending',
      outcome_date timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT trial_questions_status_check CHECK (status IN ('live', 'coming_soon')),
      CONSTRAINT trial_questions_outcome_check CHECK (outcome IN ('Pending', 'YES', 'NO')),
      CONSTRAINT trial_questions_sort_order_check CHECK (sort_order >= 0)
    )
  `)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS trial_questions_trial_slug_idx ON trial_questions (trial_id, slug)`)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS trial_questions_trial_sort_order_idx ON trial_questions (trial_id, sort_order)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_questions_slug_idx ON trial_questions (slug)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_questions_status_idx ON trial_questions (status)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_questions_outcome_idx ON trial_questions (outcome)`)

  await exec(`
    CREATE TABLE IF NOT EXISTS trial_monitor_configs (
      id text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      web_search_enabled boolean NOT NULL DEFAULT true,
      run_interval_hours integer NOT NULL DEFAULT 6,
      lookahead_days integer NOT NULL DEFAULT 30,
      overdue_recheck_hours integer NOT NULL DEFAULT 24,
      max_questions_per_run integer NOT NULL DEFAULT 25,
      verifier_model_key text NOT NULL DEFAULT 'gpt-5.4',
      min_candidate_confidence real NOT NULL DEFAULT 0.8,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT trial_monitor_configs_run_interval_hours_check CHECK (run_interval_hours >= 1 AND run_interval_hours <= 168),
      CONSTRAINT trial_monitor_configs_lookahead_days_check CHECK (lookahead_days >= 0 AND lookahead_days <= 365),
      CONSTRAINT trial_monitor_configs_overdue_recheck_hours_check CHECK (overdue_recheck_hours >= 1 AND overdue_recheck_hours <= 720),
      CONSTRAINT trial_monitor_configs_max_questions_per_run_check CHECK (max_questions_per_run >= 1 AND max_questions_per_run <= 500),
      CONSTRAINT trial_monitor_configs_min_candidate_confidence_check CHECK (min_candidate_confidence >= 0 AND min_candidate_confidence <= 1)
    )
  `)
  await exec(`ALTER TABLE trial_monitor_configs ADD COLUMN IF NOT EXISTS web_search_enabled boolean NOT NULL DEFAULT true`)
  await exec(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'trial_monitor_configs'
          AND column_name = 'web_search_enabled'
      ) THEN
        UPDATE trial_monitor_configs
        SET web_search_enabled = true
        WHERE web_search_enabled IS DISTINCT FROM true;
      END IF;
    END
    $$;
  `)

  await exec(`
    CREATE TABLE IF NOT EXISTS trial_monitor_runs (
      id text PRIMARY KEY,
      trigger_source text NOT NULL DEFAULT 'manual',
      status text NOT NULL DEFAULT 'running',
      questions_scanned integer NOT NULL DEFAULT 0,
      candidates_created integer NOT NULL DEFAULT 0,
      error_summary text,
      debug_log text,
      started_at timestamp with time zone NOT NULL DEFAULT now(),
      completed_at timestamp with time zone,
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT trial_monitor_runs_trigger_source_check CHECK (trigger_source IN ('cron', 'manual')),
      CONSTRAINT trial_monitor_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
      CONSTRAINT trial_monitor_runs_questions_scanned_check CHECK (questions_scanned >= 0),
      CONSTRAINT trial_monitor_runs_candidates_created_check CHECK (candidates_created >= 0)
    )
  `)
  await exec(`ALTER TABLE trial_monitor_runs ADD COLUMN IF NOT EXISTS debug_log text`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_monitor_runs_started_at_idx ON trial_monitor_runs (started_at)`)
  await exec(`
    CREATE TABLE IF NOT EXISTS trial_sync_configs (
      id text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      sync_interval_hours integer NOT NULL DEFAULT 24,
      recent_completion_lookback_days integer NOT NULL DEFAULT 180,
      reconcile_interval_hours integer NOT NULL DEFAULT 168,
      last_successful_update_post_date date,
      last_successful_data_timestamp text,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT trial_sync_configs_sync_interval_hours_check CHECK (sync_interval_hours >= 1 AND sync_interval_hours <= 168),
      CONSTRAINT trial_sync_configs_recent_completion_lookback_days_check CHECK (recent_completion_lookback_days >= 1 AND recent_completion_lookback_days <= 1095),
      CONSTRAINT trial_sync_configs_reconcile_interval_hours_check CHECK (reconcile_interval_hours >= 1 AND reconcile_interval_hours <= 720)
    )
  `)
  await exec(`
    CREATE TABLE IF NOT EXISTS trial_sync_runs (
      id text PRIMARY KEY,
      trigger_source text NOT NULL DEFAULT 'manual',
      mode text NOT NULL DEFAULT 'incremental',
      status text NOT NULL DEFAULT 'running',
      source_data_timestamp text,
      studies_fetched integer NOT NULL DEFAULT 0,
      studies_matched integer NOT NULL DEFAULT 0,
      trials_upserted integer NOT NULL DEFAULT 0,
      questions_upserted integer NOT NULL DEFAULT 0,
      markets_opened integer NOT NULL DEFAULT 0,
      error_summary text,
      started_at timestamp with time zone NOT NULL DEFAULT now(),
      completed_at timestamp with time zone,
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT trial_sync_runs_trigger_source_check CHECK (trigger_source IN ('cron', 'manual')),
      CONSTRAINT trial_sync_runs_mode_check CHECK (mode IN ('incremental', 'reconcile')),
      CONSTRAINT trial_sync_runs_status_check CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
      CONSTRAINT trial_sync_runs_studies_fetched_check CHECK (studies_fetched >= 0),
      CONSTRAINT trial_sync_runs_studies_matched_check CHECK (studies_matched >= 0),
      CONSTRAINT trial_sync_runs_trials_upserted_check CHECK (trials_upserted >= 0),
      CONSTRAINT trial_sync_runs_questions_upserted_check CHECK (questions_upserted >= 0),
      CONSTRAINT trial_sync_runs_markets_opened_check CHECK (markets_opened >= 0)
    )
  `)
  await exec(`CREATE INDEX IF NOT EXISTS trial_sync_runs_started_at_idx ON trial_sync_runs (started_at)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_sync_runs_mode_started_at_idx ON trial_sync_runs (mode, started_at)`)
  await exec(`
    CREATE TABLE IF NOT EXISTS trial_sync_run_items (
      id text PRIMARY KEY,
      run_id text NOT NULL REFERENCES trial_sync_runs(id) ON DELETE CASCADE,
      trial_id text REFERENCES phase2_trials(id) ON DELETE SET NULL,
      nct_number text NOT NULL,
      short_title text NOT NULL,
      sponsor_name text NOT NULL,
      current_status text NOT NULL,
      est_primary_completion_date date NOT NULL,
      change_type text NOT NULL,
      change_summary text,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT trial_sync_run_items_change_type_check CHECK (change_type IN ('inserted', 'updated'))
    )
  `)
  await exec(`CREATE INDEX IF NOT EXISTS trial_sync_run_items_run_created_at_idx ON trial_sync_run_items (run_id, created_at)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_sync_run_items_run_change_type_idx ON trial_sync_run_items (run_id, change_type)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_sync_run_items_nct_number_idx ON trial_sync_run_items (nct_number)`)
  await exec(`
    UPDATE trial_questions
    SET prompt = 'Will the results be positive?'
    WHERE lower(trim(prompt)) = 'will the primary endpoint be met?'
  `)

  await exec(`
    CREATE TABLE IF NOT EXISTS trial_outcome_candidates (
      id text PRIMARY KEY,
      trial_question_id text NOT NULL REFERENCES trial_questions(id) ON DELETE CASCADE,
      proposed_outcome text NOT NULL,
      proposed_outcome_date timestamp with time zone,
      confidence real NOT NULL,
      summary text NOT NULL,
      verifier_model_key text NOT NULL,
      provider_response_id text,
      evidence_hash text NOT NULL,
      status text NOT NULL DEFAULT 'pending_review',
      reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      review_notes text,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      reviewed_at timestamp with time zone,
      CONSTRAINT trial_outcome_candidates_proposed_outcome_check CHECK (proposed_outcome IN ('YES', 'NO', 'NO_DECISION')),
      CONSTRAINT trial_outcome_candidates_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
      CONSTRAINT trial_outcome_candidates_status_check CHECK (status IN ('pending_review', 'accepted', 'rejected', 'superseded', 'dismissed'))
    )
  `)
  await exec(`ALTER TABLE trial_outcome_candidates DROP CONSTRAINT IF EXISTS trial_outcome_candidates_proposed_outcome_check`)
  await exec(`
    ALTER TABLE trial_outcome_candidates
    ADD CONSTRAINT trial_outcome_candidates_proposed_outcome_check
    CHECK (proposed_outcome IN ('YES', 'NO', 'NO_DECISION'))
  `)
  await exec(`ALTER TABLE trial_outcome_candidates DROP CONSTRAINT IF EXISTS trial_outcome_candidates_status_check`)
  await exec(`
    ALTER TABLE trial_outcome_candidates
    ADD CONSTRAINT trial_outcome_candidates_status_check
    CHECK (status IN ('pending_review', 'accepted', 'rejected', 'superseded', 'dismissed'))
  `)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS trial_outcome_candidates_question_outcome_hash_idx ON trial_outcome_candidates (trial_question_id, proposed_outcome, evidence_hash)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_outcome_candidates_status_created_at_idx ON trial_outcome_candidates (status, created_at)`)
  await exec(`CREATE INDEX IF NOT EXISTS trial_outcome_candidates_question_created_at_idx ON trial_outcome_candidates (trial_question_id, created_at)`)

  await exec(`
    CREATE TABLE IF NOT EXISTS trial_outcome_candidate_evidence (
      id text PRIMARY KEY,
      candidate_id text NOT NULL REFERENCES trial_outcome_candidates(id) ON DELETE CASCADE,
      source_type text NOT NULL,
      title text NOT NULL,
      url text NOT NULL,
      published_at timestamp with time zone,
      excerpt text NOT NULL,
      domain text NOT NULL,
      display_order integer NOT NULL DEFAULT 0,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `)
  await exec(`ALTER TABLE trial_outcome_candidate_evidence DROP CONSTRAINT IF EXISTS trial_outcome_candidate_evidence_source_type_check`)
  await exec(`
    ALTER TABLE trial_outcome_candidate_evidence
    ADD CONSTRAINT trial_outcome_candidate_evidence_source_type_check
    CHECK (source_type IN ('clinicaltrials', 'sponsor', 'stored_source', 'web_search'))
  `)
  await exec(`CREATE INDEX IF NOT EXISTS trial_outcome_candidate_evidence_candidate_display_order_idx ON trial_outcome_candidate_evidence (candidate_id, display_order)`)

  await exec(`ALTER TABLE prediction_markets ADD COLUMN IF NOT EXISTS trial_question_id text`)
  await exec(`ALTER TABLE prediction_markets ALTER COLUMN fda_event_id DROP NOT NULL`)
  await exec(`ALTER TABLE prediction_markets DROP CONSTRAINT IF EXISTS prediction_markets_resolved_outcome_check`)
  await exec(`ALTER TABLE prediction_markets ADD CONSTRAINT prediction_markets_resolved_outcome_check CHECK (resolved_outcome IS NULL OR resolved_outcome IN ('Approved', 'Rejected', 'YES', 'NO'))`)
  await exec(`ALTER TABLE prediction_markets DROP CONSTRAINT IF EXISTS prediction_markets_ownership_check`)
  await exec(`
    ALTER TABLE prediction_markets
    ADD CONSTRAINT prediction_markets_ownership_check
    CHECK (
      (fda_event_id IS NOT NULL AND trial_question_id IS NULL)
      OR
      (fda_event_id IS NULL AND trial_question_id IS NOT NULL)
    )
  `)
  await exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'prediction_markets_trial_question_id_trial_questions_id_fk'
          AND conrelid = 'prediction_markets'::regclass
      ) THEN
        ALTER TABLE prediction_markets
          ADD CONSTRAINT prediction_markets_trial_question_id_trial_questions_id_fk
          FOREIGN KEY (trial_question_id) REFERENCES trial_questions(id) ON DELETE CASCADE;
      END IF;
    END
    $$;
  `)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS prediction_markets_trial_question_id_idx ON prediction_markets (trial_question_id) WHERE trial_question_id IS NOT NULL`)

  await exec(`ALTER TABLE market_run_logs ADD COLUMN IF NOT EXISTS trial_question_id text`)
  await exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'market_run_logs_trial_question_id_trial_questions_id_fk'
          AND conrelid = 'market_run_logs'::regclass
      ) THEN
        ALTER TABLE market_run_logs
          ADD CONSTRAINT market_run_logs_trial_question_id_trial_questions_id_fk
          FOREIGN KEY (trial_question_id) REFERENCES trial_questions(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `)
  await exec(`CREATE INDEX IF NOT EXISTS market_run_logs_actor_idx ON market_run_logs (actor_id)`)

  await exec(`ALTER TABLE market_actions ADD COLUMN IF NOT EXISTS trial_question_id text`)
  await exec(`ALTER TABLE market_actions ALTER COLUMN fda_event_id DROP NOT NULL`)
  await exec(`ALTER TABLE market_actions DROP CONSTRAINT IF EXISTS market_actions_ownership_check`)
  await exec(`
    ALTER TABLE market_actions
    ADD CONSTRAINT market_actions_ownership_check
    CHECK (
      (fda_event_id IS NOT NULL AND trial_question_id IS NULL)
      OR
      (fda_event_id IS NULL AND trial_question_id IS NOT NULL)
    )
  `)
  await exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'market_actions_trial_question_id_trial_questions_id_fk'
          AND conrelid = 'market_actions'::regclass
      ) THEN
        ALTER TABLE market_actions
          ADD CONSTRAINT market_actions_trial_question_id_trial_questions_id_fk
          FOREIGN KEY (trial_question_id) REFERENCES trial_questions(id) ON DELETE CASCADE;
      END IF;
    END
    $$;
  `)

  await exec(`ALTER TABLE model_decision_snapshots ADD COLUMN IF NOT EXISTS trial_question_id text`)
  await exec(`ALTER TABLE model_decision_snapshots ADD COLUMN IF NOT EXISTS yes_probability real`)
  await exec(`ALTER TABLE model_decision_snapshots ALTER COLUMN fda_event_id DROP NOT NULL`)
  await exec(`ALTER TABLE model_decision_snapshots DROP CONSTRAINT IF EXISTS model_decision_snapshots_binary_call_check`)
  await exec(`ALTER TABLE model_decision_snapshots ADD CONSTRAINT model_decision_snapshots_binary_call_check CHECK (binary_call IN ('approved', 'rejected', 'yes', 'no'))`)
  await exec(`ALTER TABLE model_decision_snapshots DROP CONSTRAINT IF EXISTS model_decision_snapshots_yes_probability_check`)
  await exec(`ALTER TABLE model_decision_snapshots ADD CONSTRAINT model_decision_snapshots_yes_probability_check CHECK (yes_probability IS NULL OR (yes_probability >= 0 AND yes_probability <= 1))`)
  await exec(`ALTER TABLE model_decision_snapshots DROP CONSTRAINT IF EXISTS model_decision_snapshots_ownership_check`)
  await exec(`
    ALTER TABLE model_decision_snapshots
    ADD CONSTRAINT model_decision_snapshots_ownership_check
    CHECK (
      (fda_event_id IS NOT NULL AND trial_question_id IS NULL)
      OR
      (fda_event_id IS NULL AND trial_question_id IS NOT NULL)
    )
  `)
  await exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'model_decision_snapshots_trial_question_id_trial_questions_id_f'
          AND conrelid = 'model_decision_snapshots'::regclass
      ) THEN
        ALTER TABLE model_decision_snapshots
          ADD CONSTRAINT model_decision_snapshots_trial_question_id_trial_questions_id_f
          FOREIGN KEY (trial_question_id) REFERENCES trial_questions(id) ON DELETE CASCADE;
      END IF;
    END
    $$;
  `)
  await exec(`CREATE INDEX IF NOT EXISTS model_decision_snapshots_question_actor_created_idx ON model_decision_snapshots (trial_question_id, actor_id, created_at)`)

  console.log('Phase 2 schema bridge applied successfully.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end({ timeout: 1 })
  })
