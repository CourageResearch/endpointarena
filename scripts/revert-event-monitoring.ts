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
  console.log('Reverting FDA event monitoring schema changes...')

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fda_calendar_events'
          AND column_name = 'pdufa_date'
      ) THEN
        ALTER TABLE fda_calendar_events ADD COLUMN pdufa_date DATE;
      END IF;
    END $$;
  `

  await sql`
    UPDATE fda_calendar_events
    SET pdufa_date = COALESCE(pdufa_date, decision_date)
    WHERE pdufa_date IS NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fda_calendar_events'
          AND column_name = 'decision_date'
      )
  `
  await sql`ALTER TABLE fda_calendar_events ALTER COLUMN pdufa_date SET NOT NULL`

  await sql`ALTER TABLE fda_calendar_events ADD COLUMN IF NOT EXISTS date_kind TEXT`
  await sql`ALTER TABLE fda_calendar_events ALTER COLUMN date_kind SET DEFAULT 'public'`
  await sql`
    UPDATE fda_calendar_events
    SET date_kind = CASE
      WHEN date_kind IN ('public', 'synthetic') THEN date_kind
      WHEN date_kind = 'hard' THEN 'public'
      WHEN date_kind = 'soft' THEN 'synthetic'
      WHEN decision_date_kind = 'hard' THEN 'public'
      WHEN decision_date_kind = 'soft' THEN 'synthetic'
      WHEN date_kind IS NULL OR date_kind = '' THEN 'public'
      ELSE date_kind
    END
  `
  await sql`UPDATE fda_calendar_events SET date_kind = 'public' WHERE date_kind IS NULL`
  await sql`ALTER TABLE fda_calendar_events ALTER COLUMN date_kind SET NOT NULL`

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fda_calendar_events_date_kind_check'
      ) THEN
        ALTER TABLE fda_calendar_events
        ADD CONSTRAINT fda_calendar_events_date_kind_check
        CHECK (date_kind IN ('public', 'synthetic'));
      END IF;
    END $$;
  `

  await sql`CREATE INDEX IF NOT EXISTS fda_calendar_events_pdufa_date_idx ON fda_calendar_events (pdufa_date)`

  console.log('Done. Pre-monitor columns have been backfilled for rollback compatibility.')
  console.log('Note: decision_date, decision_date_kind, event_monitor_* tables, and last_monitored_at are left in place.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Rollback failed:', error)
  process.exit(1)
})
