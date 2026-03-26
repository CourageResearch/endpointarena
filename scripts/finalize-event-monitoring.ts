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
  console.log('Finalizing FDA event monitoring schema...')

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
      WHEN date_kind = 'synthetic' THEN 'soft'
      WHEN date_kind = 'public' THEN 'hard'
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

  await sql`ALTER TABLE fda_calendar_events DROP CONSTRAINT IF EXISTS fda_calendar_events_date_kind_check`
  await sql`DROP INDEX IF EXISTS fda_calendar_events_pdufa_date_idx`
  await sql`ALTER TABLE fda_calendar_events DROP COLUMN IF EXISTS pdufa_date`
  await sql`ALTER TABLE fda_calendar_events DROP COLUMN IF EXISTS date_kind`

  console.log('Done. Legacy FDA date columns have been removed.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Schema finalization failed:', error)
  process.exit(1)
})
