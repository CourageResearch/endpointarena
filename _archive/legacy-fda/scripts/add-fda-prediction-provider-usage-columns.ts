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
  console.log('Adding provider usage detail columns to fda_predictions...')

  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS cache_creation_input_tokens_5m INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS cache_creation_input_tokens_1h INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS cache_read_input_tokens INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS web_search_requests INTEGER`
  await sql`ALTER TABLE fda_predictions ADD COLUMN IF NOT EXISTS inference_geo TEXT`

  console.log('Done. fda_predictions now stores detailed provider usage metadata.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
