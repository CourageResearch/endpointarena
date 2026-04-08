import { execSync } from 'node:child_process'

type LogEntry = {
  level?: string
  message?: string
  timestamp?: string
}

const APP_SERVICE = process.env.RAILWAY_APP_SERVICE?.trim() || 'endpoint-arena-app'
const HEALTH_URL = process.env.APP_HEALTH_URL?.trim() || 'https://endpointarena.com/api/health'
const LOG_WINDOW = process.env.ALERT_LOG_WINDOW?.trim() || '1h'
const LOG_LINES = Number(process.env.ALERT_LOG_LINES ?? 1500)

const RAILWAY_BIN = process.env.RAILWAY_BIN?.trim() || 'railway'

const MAX_TOTAL_ERROR_LINES = Number(process.env.ALERT_MAX_TOTAL_ERROR_LINES ?? 50)
const MAX_DB_CONNECTIVITY_ERRORS = Number(process.env.ALERT_MAX_DB_CONNECTIVITY_ERRORS ?? 0)
const MAX_AUTH_CALLBACK_ERRORS = Number(process.env.ALERT_MAX_AUTH_CALLBACK_ERRORS ?? 10)

const DB_CONNECTIVITY_PATTERN =
  /(enotfound|econnrefused|etimedout|getaddrinfo|could not connect|connection.*(refused|terminated|timeout)|timeout expired|host name .* could not be translated)/i
const AUTH_CALLBACK_PATTERN =
  /(api\/auth\/callback|next-auth.*error|auth callback|credentials callback|oauth callback)/i
const ERROR_PATTERN = /\berror\b/i

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

function parseJsonLines(raw: string): LogEntry[] {
  const entries: LogEntry[] = []
  const lines = raw.split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as LogEntry)
    } catch {
      // Ignore non-JSON lines so the check keeps working during CLI format changes.
    }
  }
  return entries
}

async function healthStatus(url: string): Promise<number> {
  const response = await fetch(url, { method: 'GET' })
  return response.status
}

async function main(): Promise<void> {
  console.log('Production alert signal check')
  console.log(`- Service: ${APP_SERVICE}`)
  console.log(`- Health URL: ${HEALTH_URL}`)
  console.log(`- Log window: ${LOG_WINDOW}`)

  const failures: string[] = []

  const health = await healthStatus(HEALTH_URL)
  console.log(`- Health status: ${health}`)
  if (health !== 200) {
    failures.push(`Health endpoint returned ${health}`)
  }

  const rawLogs = runRailway([
    'logs',
    '--service',
    APP_SERVICE,
    '--latest',
    '--since',
    LOG_WINDOW,
    '--lines',
    String(LOG_LINES),
    '--json',
  ])
  const logs = parseJsonLines(rawLogs)

  let totalErrorLines = 0
  let dbConnectivityErrors = 0
  let authCallbackErrors = 0

  for (const entry of logs) {
    const message = entry.message ?? ''
    const level = (entry.level ?? '').toLowerCase()

    if (level === 'error' || ERROR_PATTERN.test(message)) {
      totalErrorLines += 1
    }
    if (DB_CONNECTIVITY_PATTERN.test(message)) {
      dbConnectivityErrors += 1
    }
    if (AUTH_CALLBACK_PATTERN.test(message)) {
      authCallbackErrors += 1
    }
  }

  console.log(`- Parsed log entries: ${logs.length}`)
  console.log(`- Error lines: ${totalErrorLines} (max ${MAX_TOTAL_ERROR_LINES})`)
  console.log(`- DB connectivity errors: ${dbConnectivityErrors} (max ${MAX_DB_CONNECTIVITY_ERRORS})`)
  console.log(`- Auth callback errors: ${authCallbackErrors} (max ${MAX_AUTH_CALLBACK_ERRORS})`)

  if (totalErrorLines > MAX_TOTAL_ERROR_LINES) {
    failures.push(`Error lines above threshold (${totalErrorLines} > ${MAX_TOTAL_ERROR_LINES})`)
  }
  if (dbConnectivityErrors > MAX_DB_CONNECTIVITY_ERRORS) {
    failures.push(
      `DB connectivity errors above threshold (${dbConnectivityErrors} > ${MAX_DB_CONNECTIVITY_ERRORS})`,
    )
  }
  if (authCallbackErrors > MAX_AUTH_CALLBACK_ERRORS) {
    failures.push(`Auth callback errors above threshold (${authCallbackErrors} > ${MAX_AUTH_CALLBACK_ERRORS})`)
  }

  if (failures.length > 0) {
    console.error('\nAlert check failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('\nAlert check passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
