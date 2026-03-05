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
  console.log('Adding signup_location column to users...')
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_location TEXT`
  console.log('Done. users.signup_location is ready.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
