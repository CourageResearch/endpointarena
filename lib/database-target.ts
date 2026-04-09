import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ValidationError } from '@/lib/errors'

const DATABASE_TARGETS = ['main', 'toy'] as const
const DEFAULT_DATABASE_TARGET = 'main'
const DATABASE_TARGET_STATE_FILE = path.join(process.cwd(), 'tmp', 'runtime-database-target.json')
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export type DatabaseTarget = (typeof DATABASE_TARGETS)[number]

type PersistedDatabaseTargetState = {
  target?: unknown
}

type GlobalDatabaseTargetState = typeof globalThis & {
  __endpointArenaActiveDatabaseTarget?: DatabaseTarget
}

function normalizeDatabaseTarget(value: unknown): DatabaseTarget | null {
  return typeof value === 'string' && DATABASE_TARGETS.includes(value as DatabaseTarget)
    ? value as DatabaseTarget
    : null
}

function parseDatabaseName(connectionString: string): string | null {
  try {
    const url = new URL(connectionString)
    const databaseName = url.pathname.replace(/^\//, '').trim()
    return databaseName.length > 0 ? databaseName : null
  } catch {
    return null
  }
}

function deriveToyDatabaseUrl(mainConnectionString: string): string | null {
  try {
    const url = new URL(mainConnectionString)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      return null
    }
    if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
      return null
    }

    url.pathname = '/toy'
    return url.toString()
  } catch {
    return null
  }
}

function getConfiguredMainDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Create a .env.local file and set DATABASE_URL to your Postgres connection string.'
    )
  }

  return connectionString
}

function getConfiguredToyDatabaseUrl(): string | null {
  const explicitToyUrl = process.env.TOY_DATABASE_URL?.trim() || process.env.DATABASE_URL_TOY?.trim()
  if (explicitToyUrl) {
    return explicitToyUrl
  }

  return deriveToyDatabaseUrl(getConfiguredMainDatabaseUrl())
}

function readPersistedDatabaseTarget(): DatabaseTarget | null {
  if (!existsSync(DATABASE_TARGET_STATE_FILE)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(DATABASE_TARGET_STATE_FILE, 'utf8')) as PersistedDatabaseTargetState
    return normalizeDatabaseTarget(parsed.target)
  } catch {
    return null
  }
}

function persistDatabaseTarget(target: DatabaseTarget): void {
  mkdirSync(path.dirname(DATABASE_TARGET_STATE_FILE), { recursive: true })
  writeFileSync(
    DATABASE_TARGET_STATE_FILE,
    JSON.stringify({ target }, null, 2),
    'utf8',
  )
}

export function listDatabaseTargets(): Array<{
  target: DatabaseTarget
  label: string
  description: string
  configured: boolean
  databaseName: string | null
}> {
  const mainDatabaseUrl = getConfiguredMainDatabaseUrl()
  const toyDatabaseUrl = getConfiguredToyDatabaseUrl()

  return [
    {
      target: 'main',
      label: 'Main DB',
      description: 'Primary application dataset.',
      configured: true,
      databaseName: parseDatabaseName(mainDatabaseUrl),
    },
    {
      target: 'toy',
      label: 'Toy DB',
      description: 'Sandbox dataset for testing flows without touching main data.',
      configured: toyDatabaseUrl != null,
      databaseName: toyDatabaseUrl ? parseDatabaseName(toyDatabaseUrl) : null,
    },
  ]
}

export function getDatabaseUrlForTarget(target: DatabaseTarget): string {
  if (target === 'main') {
    return getConfiguredMainDatabaseUrl()
  }

  const toyDatabaseUrl = getConfiguredToyDatabaseUrl()
  if (!toyDatabaseUrl) {
    throw new ValidationError('Toy DB is not configured. Set TOY_DATABASE_URL or use a local DATABASE_URL so /toy can be derived automatically.')
  }

  return toyDatabaseUrl
}

export function getActiveDatabaseTarget(): DatabaseTarget {
  const globalState = globalThis as GlobalDatabaseTargetState
  const persistedTarget = readPersistedDatabaseTarget()
  if (persistedTarget) {
    try {
      getDatabaseUrlForTarget(persistedTarget)
      globalState.__endpointArenaActiveDatabaseTarget = persistedTarget
      return persistedTarget
    } catch {
      // Fall through to global/default selection.
    }
  }

  const currentGlobalTarget = normalizeDatabaseTarget(globalState.__endpointArenaActiveDatabaseTarget)
  if (currentGlobalTarget) {
    try {
      getDatabaseUrlForTarget(currentGlobalTarget)
      return currentGlobalTarget
    } catch {
      // Fall through to default selection.
    }
  }

  globalState.__endpointArenaActiveDatabaseTarget = DEFAULT_DATABASE_TARGET
  return DEFAULT_DATABASE_TARGET
}

export function setActiveDatabaseTarget(target: DatabaseTarget): DatabaseTarget {
  getDatabaseUrlForTarget(target)

  const globalState = globalThis as GlobalDatabaseTargetState
  globalState.__endpointArenaActiveDatabaseTarget = target
  persistDatabaseTarget(target)
  return target
}

export function parseDatabaseTarget(value: unknown): DatabaseTarget {
  const normalized = normalizeDatabaseTarget(value)
  if (!normalized) {
    throw new ValidationError(`target must be one of: ${DATABASE_TARGETS.join(', ')}`)
  }

  return normalized
}
