import postgres from 'postgres'
import { assertLocalOneDrugDatabaseUrl, getAdminDatabaseUrl, ONE_DRUG_DATABASE_NAME } from './one-drug-local-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const targetUrl = assertLocalOneDrugDatabaseUrl(connectionString)
  const adminUrl = getAdminDatabaseUrl(targetUrl)
  const sql = postgres(adminUrl, { prepare: false, max: 1 })

  try {
    const existing = await sql<{ exists: boolean }[]>`
      select exists(select 1 from pg_database where datname = ${ONE_DRUG_DATABASE_NAME}) as exists
    `

    if (existing[0]?.exists) {
      console.log(`Database ${ONE_DRUG_DATABASE_NAME} already exists.`)
      return
    }

    await sql.unsafe(`create database "${ONE_DRUG_DATABASE_NAME}"`)
    console.log(`Created database ${ONE_DRUG_DATABASE_NAME}.`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
