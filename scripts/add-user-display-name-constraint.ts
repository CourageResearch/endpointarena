import dotenv from 'dotenv'
import postgres from 'postgres'
import { resolveDisplayName } from '../lib/display-name'

dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(connectionString, { prepare: false })

async function migrate() {
  console.log('Backfilling legacy display names...')

  const rows = await sql<{ id: string; email: string | null; name: string | null }[]>`
    SELECT id, email, name
    FROM users
    WHERE name IS NULL
       OR name !~ '^[A-Za-z0-9]{1,20}$'
  `

  for (const row of rows) {
    const nextName = resolveDisplayName(row.name, row.email ?? row.id)

    await sql`
      UPDATE users
      SET name = ${nextName}
      WHERE id = ${row.id}
    `
  }

  console.log('Refreshing users_display_name_check constraint...')

  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_display_name_check`
  await sql`
    ALTER TABLE users
    ALTER COLUMN name SET NOT NULL
  `
  await sql`
    ALTER TABLE users
    ADD CONSTRAINT users_display_name_check
    CHECK (name ~ '^[A-Za-z0-9]{1,20}$')
  `

  console.log('Done. Users.name is now required and limited to 1-20 alphanumeric characters.')
  await sql.end()
}

migrate().catch(async (error) => {
  console.error('Migration failed:', error)
  await sql.end()
  process.exit(1)
})
