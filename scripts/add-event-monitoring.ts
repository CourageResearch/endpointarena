import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(connectionString, { prepare: false })

async function migrate() {
  console.log('Preparing FDA event monitoring schema...')

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fda_calendar_events'
          AND column_name = 'decision_date'
      ) THEN
        ALTER TABLE fda_calendar_events ADD COLUMN decision_date DATE;
      END IF;
    END $$;
  `

  await sql`
    UPDATE fda_calendar_events
    SET decision_date = COALESCE(decision_date, pdufa_date)
    WHERE decision_date IS NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fda_calendar_events'
          AND column_name = 'pdufa_date'
      )
  `
  await sql`ALTER TABLE fda_calendar_events ALTER COLUMN decision_date SET NOT NULL`

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fda_calendar_events'
          AND column_name = 'decision_date_kind'
      ) THEN
        ALTER TABLE fda_calendar_events ADD COLUMN decision_date_kind TEXT;
      END IF;
    END $$;
  `
  await sql`ALTER TABLE fda_calendar_events ALTER COLUMN decision_date_kind SET DEFAULT 'hard'`
  await sql`
    UPDATE fda_calendar_events
    SET decision_date_kind = CASE
      WHEN decision_date_kind IN ('hard', 'soft') THEN decision_date_kind
      WHEN decision_date_kind = 'public' THEN 'hard'
      WHEN decision_date_kind = 'synthetic' THEN 'soft'
      WHEN date_kind = 'public' THEN 'hard'
      WHEN date_kind = 'synthetic' THEN 'soft'
      WHEN decision_date_kind IS NULL OR decision_date_kind = '' THEN 'hard'
      ELSE decision_date_kind
    END
  `
  await sql`UPDATE fda_calendar_events SET decision_date_kind = 'hard' WHERE decision_date_kind IS NULL`
  await sql`ALTER TABLE fda_calendar_events ALTER COLUMN decision_date_kind SET NOT NULL`
  await sql`ALTER TABLE fda_calendar_events ADD COLUMN IF NOT EXISTS last_monitored_at TIMESTAMPTZ`
  await sql`CREATE INDEX IF NOT EXISTS fda_calendar_events_decision_date_idx ON fda_calendar_events (decision_date)`

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fda_calendar_events_decision_date_kind_check'
      ) THEN
        ALTER TABLE fda_calendar_events
        ADD CONSTRAINT fda_calendar_events_decision_date_kind_check
        CHECK (decision_date_kind IN ('hard', 'soft'));
      END IF;
    END $$;
  `

  await sql`
    CREATE TABLE IF NOT EXISTS event_monitor_configs (
      id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      run_interval_hours INTEGER NOT NULL DEFAULT 6,
      hard_lookahead_days INTEGER NOT NULL DEFAULT 7,
      soft_lookahead_days INTEGER NOT NULL DEFAULT 14,
      overdue_recheck_hours INTEGER NOT NULL DEFAULT 24,
      max_events_per_run INTEGER NOT NULL DEFAULT 25,
      verifier_model_key TEXT NOT NULL DEFAULT 'gpt-5.2',
      min_candidate_confidence REAL NOT NULL DEFAULT 0.8,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT event_monitor_configs_run_interval_hours_check CHECK (run_interval_hours >= 1 AND run_interval_hours <= 168),
      CONSTRAINT event_monitor_configs_hard_lookahead_days_check CHECK (hard_lookahead_days >= 0 AND hard_lookahead_days <= 365),
      CONSTRAINT event_monitor_configs_soft_lookahead_days_check CHECK (soft_lookahead_days >= 0 AND soft_lookahead_days <= 365),
      CONSTRAINT event_monitor_configs_overdue_recheck_hours_check CHECK (overdue_recheck_hours >= 1 AND overdue_recheck_hours <= 720),
      CONSTRAINT event_monitor_configs_max_events_per_run_check CHECK (max_events_per_run >= 1 AND max_events_per_run <= 500),
      CONSTRAINT event_monitor_configs_min_candidate_confidence_check CHECK (min_candidate_confidence >= 0 AND min_candidate_confidence <= 1)
    )
  `

  await sql`
    INSERT INTO event_monitor_configs (
      id,
      enabled,
      run_interval_hours,
      hard_lookahead_days,
      soft_lookahead_days,
      overdue_recheck_hours,
      max_events_per_run,
      verifier_model_key,
      min_candidate_confidence,
      created_at,
      updated_at
    )
    VALUES (
      'default',
      TRUE,
      6,
      7,
      14,
      24,
      25,
      'gpt-5.2',
      0.8,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `

  await sql`
    CREATE TABLE IF NOT EXISTS event_monitor_runs (
      id TEXT PRIMARY KEY,
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'running',
      events_scanned INTEGER NOT NULL DEFAULT 0,
      candidates_created INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT event_monitor_runs_trigger_source_check CHECK (trigger_source IN ('cron', 'manual')),
      CONSTRAINT event_monitor_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
      CONSTRAINT event_monitor_runs_events_scanned_check CHECK (events_scanned >= 0),
      CONSTRAINT event_monitor_runs_candidates_created_check CHECK (candidates_created >= 0)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS event_monitor_runs_started_at_idx ON event_monitor_runs (started_at)`

  await sql`
    CREATE TABLE IF NOT EXISTS event_outcome_candidates (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES fda_calendar_events(id) ON DELETE CASCADE,
      proposed_outcome TEXT NOT NULL,
      proposed_outcome_date TIMESTAMPTZ,
      confidence REAL NOT NULL,
      summary TEXT NOT NULL,
      verifier_model_key TEXT NOT NULL,
      provider_response_id TEXT,
      evidence_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      review_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      CONSTRAINT event_outcome_candidates_proposed_outcome_check CHECK (proposed_outcome IN ('Approved', 'Rejected')),
      CONSTRAINT event_outcome_candidates_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
      CONSTRAINT event_outcome_candidates_status_check CHECK (status IN ('pending_review', 'accepted', 'rejected', 'superseded'))
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS event_outcome_candidates_event_outcome_hash_idx
    ON event_outcome_candidates (event_id, proposed_outcome, evidence_hash)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS event_outcome_candidates_status_created_at_idx
    ON event_outcome_candidates (status, created_at)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS event_outcome_candidates_event_created_at_idx
    ON event_outcome_candidates (event_id, created_at)
  `

  await sql`
    CREATE TABLE IF NOT EXISTS event_outcome_candidate_evidence (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES event_outcome_candidates(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TIMESTAMPTZ,
      excerpt TEXT NOT NULL,
      domain TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT event_outcome_candidate_evidence_source_type_check CHECK (source_type IN ('fda', 'sponsor', 'stored_source', 'web_search'))
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS event_outcome_candidate_evidence_candidate_display_order_idx
    ON event_outcome_candidate_evidence (candidate_id, display_order)
  `

  console.log('Done. Event monitoring schema is ready.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
