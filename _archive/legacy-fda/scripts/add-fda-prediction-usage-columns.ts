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
  console.log('Adding usage + cost columns to fda_predictions...')

  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS input_tokens INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS output_tokens INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS total_tokens INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS estimated_cost_usd REAL`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS cost_source TEXT`

  console.log('Done. fda_predictions now supports usage-based cost tracking.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
