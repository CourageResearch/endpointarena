import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

declare global {
  // eslint-disable-next-line no-var
  var __analyticsEventsSchemaReadyPromise: Promise<void> | undefined
}

export async function ensureAnalyticsEventsSchema(): Promise<void> {
  if (globalThis.__analyticsEventsSchemaReadyPromise) {
    return globalThis.__analyticsEventsSchemaReadyPromise
  }

  globalThis.__analyticsEventsSchemaReadyPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        referrer TEXT,
        user_agent TEXT,
        session_hash TEXT,
        element_id TEXT,
        ip_address TEXT,
        country TEXT,
        city TEXT,
        search_query TEXT,
        result_count INTEGER,
        created_at TIMESTAMP DEFAULT now()
      )
    `)

    await db.execute(sql`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS search_query TEXT`)
    await db.execute(sql`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS result_count INTEGER`)

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
      ON analytics_events (created_at)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_events_type_created_at_idx
      ON analytics_events (type, created_at)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_events_search_query_idx
      ON analytics_events (search_query)
    `)
  })().catch((error) => {
    globalThis.__analyticsEventsSchemaReadyPromise = undefined
    throw error
  })

  return globalThis.__analyticsEventsSchemaReadyPromise
}
