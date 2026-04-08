import postgres from 'postgres'
import { assertLocalDatabaseUrl, getAdminDatabaseUrl, getDatabaseName } from './local-db-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const targetUrl = assertLocalDatabaseUrl(connectionString)
  const databaseName = getDatabaseName(targetUrl)
  const adminUrl = getAdminDatabaseUrl(targetUrl)
  const sql = postgres(adminUrl, { prepare: false, max: 1 })

  try {
    const existing = await sql<{ exists: boolean }[]>`
      select exists(select 1 from pg_database where datname = ${databaseName}) as exists
    `

    if (existing[0]?.exists) {
      console.log(`Database ${databaseName} already exists.`)
      return
    }

    await sql.unsafe(`create database "${databaseName}"`)
    console.log(`Created database ${databaseName}.`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
