import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_PUBLIC_URL or DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(connectionString, { prepare: false })

async function migrate() {
  console.log('Shortening active tweet hold windows to 12 hours...')

  const updatedRows = await sql`
    UPDATE users
    SET tweet_must_stay_until = LEAST(tweet_must_stay_until, tweet_verified_at + interval '12 hours')
    WHERE tweet_verified_at IS NOT NULL
      AND tweet_must_stay_until IS NOT NULL
      AND tweet_must_stay_until > now()
      AND tweet_must_stay_until > tweet_verified_at + interval '12 hours'
    RETURNING id
  `

  console.log(`Updated ${updatedRows.length} user hold window(s).`)
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
