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
  console.log('Adding X verification and gameplay columns to users...')

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS x_user_id TEXT`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS x_username TEXT`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS x_connected_at TIMESTAMP`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tweet_challenge_token_hash TEXT`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tweet_challenge_expires_at TIMESTAMP`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tweet_verified_at TIMESTAMP`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tweet_verified_tweet_id TEXT`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tweet_must_stay_until TIMESTAMP`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS points_balance INTEGER NOT NULL DEFAULT 5`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_points_refill_at TIMESTAMP`

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_x_user_id_idx ON users(x_user_id)`
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_points_balance_check'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_points_balance_check
        CHECK (points_balance >= 0);
      END IF;
    END $$;
  `

  console.log('Done. Users table now supports X verification and play points.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
