import { execFileSync, execSync } from 'node:child_process'
import postgres from 'postgres'

type ServiceInstanceNode = {
  serviceId: string
  serviceName: string
  latestDeployment?: {
    id: string
    status: string
    createdAt: string
    meta?: {
      commitHash?: string
      commitMessage?: string
    }
  } | null
}

type RailwayStatus = {
  environments?: {
    edges?: Array<{
      node?: {
        name?: string
        serviceInstances?: {
          edges?: Array<{
            node?: ServiceInstanceNode
          }>
        }
      }
    }>
  }
}

type CountRow = {
  table_name: string
  row_count: string | number
}

const APP_SERVICE = process.env.RAILWAY_APP_SERVICE?.trim() || 'endpoint-arena-app'
const GREEN_DB_SERVICE = process.env.RAILWAY_GREEN_DB_SERVICE?.trim() || 'postgres-green'
const EXPECT_DB_TARGET = (process.env.EXPECT_DB_TARGET?.trim().toLowerCase() || 'green')
const EXPECT_MAINTENANCE_MODE = (process.env.EXPECT_MAINTENANCE_MODE?.trim().toLowerCase() || 'false')
const HEALTH_URL = process.env.APP_HEALTH_URL?.trim() || 'https://endpointarena.com/api/health'
const REQUIRED_APP_VARS = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL'] as const
const PREDICTION_PROVIDER_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'BASETEN_DEEPSEEK_API_KEY',
  'BASETEN_GLM_API_KEY',
  'BASETEN_KIMI_API_KEY',
  'MINIMAX_API_KEY',
] as const

function resolveRailwayBin(): string {
  const override = process.env.RAILWAY_BIN?.trim()
  if (override) return override

  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const output = execFileSync(finder, ['railway'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const matches = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (process.platform === 'win32') {
      const preferred = matches.find((line) => /\.(cmd|exe|bat)$/i.test(line))
      return preferred || matches[0] || 'railway'
    }
    return matches[0] || 'railway'
  } catch {
    return 'railway'
  }
}

const RAILWAY_BIN = resolveRailwayBin()

const MIN_USERS = Number(process.env.MIN_USERS ?? 1)
const MIN_EVENTS = Number(process.env.MIN_FDA_EVENTS ?? 1)
const MIN_MARKETS = Number(process.env.MIN_MARKETS ?? 1)
const MIN_ACTIONS = Number(process.env.MIN_MARKET_ACTIONS ?? 0)
const MIN_RUNS = Number(process.env.MIN_MARKET_RUNS ?? 0)
const MIN_SNAPSHOTS = Number(process.env.MIN_MODEL_SNAPSHOTS ?? 1)

function hasNonEmptyVar(vars: Record<string, string>, key: string): boolean {
  const value = vars[key]
  return typeof value === 'string' && value.trim().length > 0
}

function describeAppEnvAudit(appVars: Record<string, string>): {
  failures: string[]
  warnings: string[]
  providerKeysPresent: string[]
} {
  const failures: string[] = []
  const warnings: string[] = []

  for (const key of REQUIRED_APP_VARS) {
    if (!hasNonEmptyVar(appVars, key)) {
      failures.push(`Missing required app variable on ${APP_SERVICE}: ${key}`)
    }
  }

  const providerKeysPresent = PREDICTION_PROVIDER_VARS.filter((key) => hasNonEmptyVar(appVars, key))
  if (providerKeysPresent.length === 0) {
    failures.push(
      `No prediction provider API keys are configured on ${APP_SERVICE}; set at least one of ${PREDICTION_PROVIDER_VARS.join(', ')}`,
    )
  }

  if (!hasNonEmptyVar(appVars, 'MAINTENANCE_MODE')) {
    warnings.push('MAINTENANCE_MODE is unset; writes default to enabled unless explicitly frozen')
  }

  const hasTwitterId = hasNonEmptyVar(appVars, 'TWITTER_CLIENT_ID')
  const hasTwitterSecret = hasNonEmptyVar(appVars, 'TWITTER_CLIENT_SECRET')
  if (hasTwitterId !== hasTwitterSecret) {
    warnings.push('Twitter OAuth is partially configured; set both TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET or neither')
  } else if (!hasTwitterId) {
    warnings.push('Twitter OAuth is not configured; Twitter sign-in/linking is disabled')
  }

  if (!hasNonEmptyVar(appVars, 'RESEND_API_KEY')) {
    warnings.push('RESEND_API_KEY is not configured; email auth, contact, waitlist, and crash alert emails are disabled')
  }

  return {
    failures,
    warnings,
    providerKeysPresent,
  }
}

function runRailway(args: string[]): string {
  try {
    const command = [RAILWAY_BIN, ...args].map(shellQuote).join(' ')
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`railway ${args.join(' ')} failed: ${message}`)
  }
}

function shellQuote(value: string): string {
  if (value.length === 0) return '""'
  if (/^[a-zA-Z0-9_./:\\-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function runRailwayJson<T>(args: string[]): T {
  const output = runRailway(args)
  return JSON.parse(output) as T
}

function resolveServiceInstance(status: RailwayStatus, service: string): ServiceInstanceNode {
  const production = status.environments?.edges?.find((edge) => edge.node?.name === 'production')?.node
  const instances = production?.serviceInstances?.edges?.flatMap((edge) => (edge.node ? [edge.node] : [])) ?? []
  const match = instances.find((instance) => instance.serviceId === service || instance.serviceName === service)
  if (!match) {
    const available = instances.map((instance) => `${instance.serviceName} (${instance.serviceId})`).join(', ')
    throw new Error(`Could not find service "${service}" in production. Available: ${available}`)
  }
  return match
}

function resolveDbTarget(appVars: Record<string, string>): 'green' | 'blue' | 'custom' {
  const active = appVars.DATABASE_URL?.trim()
  const green = appVars.GREEN_DATABASE_URL?.trim()
  const blue = appVars.BLUE_DATABASE_URL?.trim()

  if (!active) {
    throw new Error('DATABASE_URL is missing on endpoint-arena-app')
  }
  if (green && active === green) return 'green'
  if (blue && active === blue) return 'blue'
  return 'custom'
}

async function loadGreenCounts(greenDbPublicUrl: string): Promise<Record<string, number>> {
  const sql = postgres(greenDbPublicUrl, { prepare: false, max: 1 })
  try {
    const rows = await sql<CountRow[]>`
      select 'users'::text as table_name, count(*)::bigint as row_count from users
      union all
      select 'fda_calendar_events'::text as table_name, count(*)::bigint as row_count from fda_calendar_events
      union all
      select 'prediction_markets'::text as table_name, count(*)::bigint as row_count from prediction_markets
      union all
      select 'market_actions'::text as table_name, count(*)::bigint as row_count from market_actions
      union all
      select 'market_runs'::text as table_name, count(*)::bigint as row_count from market_runs
      union all
      select 'model_decision_snapshots'::text as table_name, count(*)::bigint as row_count from model_decision_snapshots
    `

    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.table_name] = Number(row.row_count)
    }
    return counts
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function checkHealth(url: string): Promise<number> {
  const response = await fetch(url, { method: 'GET' })
  return response.status
}

async function main(): Promise<void> {
  console.log('Post-cutover production checklist')
  console.log(`- App service: ${APP_SERVICE}`)
  console.log(`- Green DB service: ${GREEN_DB_SERVICE}`)
  console.log(`- Health URL: ${HEALTH_URL}`)

  const failures: string[] = []

  const status = runRailwayJson<RailwayStatus>(['status', '--json'])
  const appInstance = resolveServiceInstance(status, APP_SERVICE)
  const deployment = appInstance.latestDeployment

  if (!deployment) {
    failures.push('App deployment info is missing')
  } else {
    console.log(`- Active deployment: ${deployment.id}`)
    console.log(`- Deployment status: ${deployment.status}`)
    if (deployment.meta?.commitHash) {
      console.log(`- Commit hash: ${deployment.meta.commitHash}`)
    }
    if (deployment.status !== 'SUCCESS') {
      failures.push(`App deployment is not SUCCESS (got ${deployment.status})`)
    }
  }

  const appVars = runRailwayJson<Record<string, string>>(['variable', 'list', '--service', APP_SERVICE, '--json'])
  const envAudit = describeAppEnvAudit(appVars)
  const dbTarget = hasNonEmptyVar(appVars, 'DATABASE_URL') ? resolveDbTarget(appVars) : 'custom'
  const maintenanceMode = (appVars.MAINTENANCE_MODE ?? '').trim().toLowerCase()

  failures.push(...envAudit.failures)

  console.log('- App env audit:')
  console.log(`  - Required vars present: ${REQUIRED_APP_VARS.filter((key) => hasNonEmptyVar(appVars, key)).length}/${REQUIRED_APP_VARS.length}`)
  console.log(
    `  - Prediction provider keys present: ${envAudit.providerKeysPresent.length > 0 ? envAudit.providerKeysPresent.join(', ') : '(none)'}`,
  )
  if (envAudit.warnings.length > 0) {
    console.log('  - Non-blocking warnings:')
    for (const warning of envAudit.warnings) {
      console.log(`    - ${warning}`)
    }
  } else {
    console.log('  - Non-blocking warnings: none')
  }

  console.log(`- DATABASE_URL target: ${dbTarget}`)
  console.log(`- MAINTENANCE_MODE: ${maintenanceMode || '(unset)'}`)

  if (hasNonEmptyVar(appVars, 'DATABASE_URL') && dbTarget !== EXPECT_DB_TARGET) {
    failures.push(`DATABASE_URL target mismatch (expected ${EXPECT_DB_TARGET}, got ${dbTarget})`)
  }
  if (maintenanceMode !== EXPECT_MAINTENANCE_MODE) {
    failures.push(
      `MAINTENANCE_MODE mismatch (expected ${EXPECT_MAINTENANCE_MODE}, got ${maintenanceMode || '(unset)'})`,
    )
  }

  const healthStatus = await checkHealth(HEALTH_URL)
  console.log(`- Health check status: ${healthStatus}`)
  if (healthStatus !== 200) {
    failures.push(`Health endpoint returned ${healthStatus}`)
  }

  const greenDbVars = runRailwayJson<Record<string, string>>([
    'variable',
    'list',
    '--service',
    GREEN_DB_SERVICE,
    '--json',
  ])
  const greenDbPublicUrl = greenDbVars.DATABASE_PUBLIC_URL?.trim()
  if (!greenDbPublicUrl) {
    failures.push(`DATABASE_PUBLIC_URL is missing on ${GREEN_DB_SERVICE}`)
  } else {
    const counts = await loadGreenCounts(greenDbPublicUrl)
    const minimums: Record<string, number> = {
      users: MIN_USERS,
      fda_calendar_events: MIN_EVENTS,
      prediction_markets: MIN_MARKETS,
      market_actions: MIN_ACTIONS,
      market_runs: MIN_RUNS,
      model_decision_snapshots: MIN_SNAPSHOTS,
    }

    console.log('- Green DB critical counts:')
    for (const [tableName, minimum] of Object.entries(minimums)) {
      const value = counts[tableName]
      console.log(`  - ${tableName}: ${value} (min ${minimum})`)
      if (!Number.isFinite(value)) {
        failures.push(`Missing count for ${tableName}`)
      } else if (value < minimum) {
        failures.push(`${tableName} count below minimum (${value} < ${minimum})`)
      }
    }
  }

  if (failures.length > 0) {
    console.error('\nChecklist failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('\nChecklist passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
