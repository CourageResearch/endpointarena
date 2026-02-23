import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Create a .env.local file and set DATABASE_URL to your Postgres connection string.'
  )
}

declare global {
  // eslint-disable-next-line no-var
  var __endpointArenaPgClient: ReturnType<typeof postgres> | undefined
}

const globalForDb = globalThis as typeof globalThis & {
  __endpointArenaPgClient?: ReturnType<typeof postgres>
}

// Disable prepared statements for transaction poolers and keep the pool tiny by default
// to avoid exhausting connections in Next.js dev/serverless runtimes.
const client =
  globalForDb.__endpointArenaPgClient ??
  postgres(connectionString, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 1),
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__endpointArenaPgClient = client
}

export const db = drizzle(client, { schema })

// Export schema for convenience
export * from './schema'
