import { ValidationError } from '@/lib/errors'

const DATABASE_TARGETS = ['main', 'toy'] as const
const DEFAULT_DATABASE_TARGET = 'main'
const DATABASE_TARGET_ENV_KEY = 'DATABASE_TARGET'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export type DatabaseTarget = (typeof DATABASE_TARGETS)[number]
export type DatabaseTargetRuntimeSource = 'local' | 'env' | 'default'

type GlobalDatabaseTargetState = typeof globalThis & {
  __endpointArenaActiveDatabaseTarget?: DatabaseTarget
}

export type DatabaseTargetRuntimeState = {
  activeTarget: DatabaseTarget
  source: DatabaseTargetRuntimeSource
  switchingAllowed: boolean
  isRailwayRuntime: boolean
  sourceDescription: string
}

function normalizeDatabaseTarget(value: unknown): DatabaseTarget | null {
  return typeof value === 'string' && DATABASE_TARGETS.includes(value as DatabaseTarget)
    ? value as DatabaseTarget
    : null
}

function getConfiguredDatabaseTarget(): DatabaseTarget | null {
  const rawValue = process.env[DATABASE_TARGET_ENV_KEY]?.trim()
  if (!rawValue) {
    return null
  }

  const normalized = normalizeDatabaseTarget(rawValue)
  if (!normalized) {
    throw new ValidationError(`${DATABASE_TARGET_ENV_KEY} must be one of: ${DATABASE_TARGETS.join(', ')}`)
  }

  return normalized
}

function isRailwayRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT_ID?.trim()
    || process.env.RAILWAY_PROJECT_ID?.trim()
    || process.env.RAILWAY_SERVICE_ID?.trim()
    || process.env.RAILWAY_DEPLOYMENT_ID?.trim()
  )
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

function getLocalActiveDatabaseTarget(): DatabaseTarget {
  const globalState = globalThis as GlobalDatabaseTargetState
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

export function isRuntimeDatabaseTargetSwitchingAllowed(): boolean {
  if (getConfiguredDatabaseTarget()) {
    return false
  }

  if (isRailwayRuntime()) {
    return false
  }

  return process.env.NODE_ENV !== 'production'
}

export function getDatabaseTargetRuntimeState(): DatabaseTargetRuntimeState {
  const configuredTarget = getConfiguredDatabaseTarget()
  const railwayRuntime = isRailwayRuntime()

  if (configuredTarget) {
    return {
      activeTarget: configuredTarget,
      source: 'env',
      switchingAllowed: false,
      isRailwayRuntime: railwayRuntime,
      sourceDescription: railwayRuntime
        ? 'This Railway deployment is pinned by DATABASE_TARGET. Update the Railway environment and redeploy to switch databases.'
        : 'This runtime is pinned by DATABASE_TARGET. Clear that variable to re-enable local switching.',
    }
  }

  if (isRuntimeDatabaseTargetSwitchingAllowed()) {
    return {
      activeTarget: getLocalActiveDatabaseTarget(),
      source: 'local',
      switchingAllowed: true,
      isRailwayRuntime: false,
      sourceDescription: 'Local development runtime switching is enabled for this dev server process.',
    }
  }

  return {
    activeTarget: DEFAULT_DATABASE_TARGET,
    source: 'default',
    switchingAllowed: false,
    isRailwayRuntime: railwayRuntime,
    sourceDescription: railwayRuntime
      ? 'This Railway deployment defaults to Main DB. Set DATABASE_TARGET in Railway and redeploy to switch databases.'
      : 'This runtime defaults to Main DB.',
  }
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
  return getDatabaseTargetRuntimeState().activeTarget
}

export function setActiveDatabaseTarget(target: DatabaseTarget): DatabaseTarget {
  if (!isRuntimeDatabaseTargetSwitchingAllowed()) {
    if (getConfiguredDatabaseTarget()) {
      throw new ValidationError(
        `Runtime database switching is disabled while ${DATABASE_TARGET_ENV_KEY} is set. Update that variable and restart the app to change targets.`
      )
    }

    if (isRailwayRuntime()) {
      throw new ValidationError(
        'Runtime database switching is disabled for Railway deployments. Set DATABASE_TARGET in Railway and redeploy to change targets.'
      )
    }

    throw new ValidationError('Runtime database switching is disabled in this environment.')
  }

  getDatabaseUrlForTarget(target)

  const globalState = globalThis as GlobalDatabaseTargetState
  globalState.__endpointArenaActiveDatabaseTarget = target
  return target
}

export function parseDatabaseTarget(value: unknown): DatabaseTarget {
  const normalized = normalizeDatabaseTarget(value)
  if (!normalized) {
    throw new ValidationError(`target must be one of: ${DATABASE_TARGETS.join(', ')}`)
  }

  return normalized
}
