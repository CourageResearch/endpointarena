import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { getActiveDatabaseTarget, getDatabaseUrlForTarget, type DatabaseTarget } from '@/lib/database-target'

function createClient(connectionString: string) {
  return postgres(connectionString, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 1),
  })
}

function createDatabase(connectionString: string) {
  const client = createClient(connectionString)
  return {
    client,
    db: drizzle(client, { schema }),
  }
}

type PgClient = ReturnType<typeof createClient>
type DrizzleDb = ReturnType<typeof createDatabase>['db']

declare global {
  // eslint-disable-next-line no-var
  var __endpointArenaPgClients: Map<DatabaseTarget, PgClient> | undefined
  // eslint-disable-next-line no-var
  var __endpointArenaDrizzleDbs: Map<DatabaseTarget, DrizzleDb> | undefined
}

const globalForDb = globalThis as typeof globalThis & {
  __endpointArenaPgClients?: Map<DatabaseTarget, PgClient>
  __endpointArenaDrizzleDbs?: Map<DatabaseTarget, DrizzleDb>
}

function getClientCache(): Map<DatabaseTarget, PgClient> {
  if (!globalForDb.__endpointArenaPgClients) {
    globalForDb.__endpointArenaPgClients = new Map()
  }

  return globalForDb.__endpointArenaPgClients
}

function getDatabaseCache(): Map<DatabaseTarget, DrizzleDb> {
  if (!globalForDb.__endpointArenaDrizzleDbs) {
    globalForDb.__endpointArenaDrizzleDbs = new Map()
  }

  return globalForDb.__endpointArenaDrizzleDbs
}

export function getDbForTarget(target: DatabaseTarget): DrizzleDb {
  const databaseCache = getDatabaseCache()
  const existingDatabase = databaseCache.get(target)
  if (existingDatabase) {
    return existingDatabase
  }

  const connectionString = getDatabaseUrlForTarget(target)
  const { client, db } = createDatabase(connectionString)

  getClientCache().set(target, client)
  databaseCache.set(target, db)

  return db
}

export function getActiveDb(): DrizzleDb {
  return getDbForTarget(getActiveDatabaseTarget())
}

export async function closeDbConnections(): Promise<void> {
  const clients = getClientCache()
  const databases = getDatabaseCache()

  await Promise.all(
    Array.from(clients.values()).map((client) => client.end({ timeout: 5 })),
  )
  clients.clear()
  databases.clear()
}

function getPathValue(root: unknown, path: PropertyKey[]): unknown {
  let current = root

  for (const segment of path) {
    if (current == null) {
      return undefined
    }

    current = Reflect.get(current as object, segment)
  }

  return current
}

function createDelegatingProxy(path: PropertyKey[] = []): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      const root = getActiveDb()
      const value = getPathValue(root, [...path, prop])

      if (typeof value === 'function') {
        const parent = path.length > 0 ? getPathValue(root, path) : root
        return value.bind(parent)
      }

      if (value && (typeof value === 'object' || typeof value === 'function')) {
        return createDelegatingProxy([...path, prop])
      }

      return value
    },
    has(_target, prop) {
      const value = getPathValue(getActiveDb(), path)
      return value != null && Reflect.has(value as object, prop)
    },
    ownKeys() {
      const value = getPathValue(getActiveDb(), path)
      return value ? Reflect.ownKeys(value as object) : []
    },
    getOwnPropertyDescriptor(_target, prop) {
      const value = getPathValue(getActiveDb(), path)
      if (!value) {
        return undefined
      }

      const descriptor = Reflect.getOwnPropertyDescriptor(value as object, prop)
      if (!descriptor) {
        return undefined
      }

      return {
        ...descriptor,
        configurable: true,
      }
    },
  })
}

export const db = createDelegatingProxy() as DrizzleDb

// Export schema for convenience
export * from './schema'
