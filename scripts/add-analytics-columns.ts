import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(connectionString, { prepare: false })

async function migrate() {
  console.log('Adding ip_address, country, city columns to analytics_events...')

  await sql`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS ip_address TEXT`
  await sql`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS country TEXT`
  await sql`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS city TEXT`

  console.log('Done. Columns added successfully.')
  await sql.end()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
