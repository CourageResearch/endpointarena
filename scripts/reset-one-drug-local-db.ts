import postgres from 'postgres'
import {
  assertLocalOneDrugDatabaseUrl,
  getAdminDatabaseUrl,
  ONE_DRUG_DATABASE_NAME,
} from './one-drug-local-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const targetUrl = assertLocalOneDrugDatabaseUrl(connectionString)
  const adminUrl = getAdminDatabaseUrl(targetUrl)
  const sql = postgres(adminUrl, { prepare: false, max: 1 })

  try {
    await sql`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${ONE_DRUG_DATABASE_NAME}
        and pid <> pg_backend_pid()
    `

    await sql.unsafe(`drop database if exists "${ONE_DRUG_DATABASE_NAME}"`)
    await sql.unsafe(`create database "${ONE_DRUG_DATABASE_NAME}"`)

    console.log(`Reset database ${ONE_DRUG_DATABASE_NAME}.`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
