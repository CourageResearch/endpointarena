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
  console.log('Ensuring CNPV event fields exist...')

  await sql`ALTER TABLE fda_calendar_events ADD COLUMN IF NOT EXISTS external_key TEXT`
  await sql`ALTER TABLE fda_calendar_events ADD COLUMN IF NOT EXISTS date_kind TEXT NOT NULL DEFAULT 'public'`
  await sql`ALTER TABLE fda_calendar_events ADD COLUMN IF NOT EXISTS cnpv_award_date TIMESTAMP`

  await sql`
    UPDATE fda_calendar_events
    SET date_kind = 'public'
    WHERE date_kind IS NULL
  `

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS fda_calendar_events_external_key_idx
    ON fda_calendar_events(external_key)
  `

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

  console.log('Done. fda_calendar_events supports CNPV metadata.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
