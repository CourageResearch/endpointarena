import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import dotenv from 'dotenv'
import postgres from 'postgres'
import { getAdminDatabaseUrl, getDatabaseName } from './local-db-utils'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_ENV_FILE = '.env.local'
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.endpointarena-pg18')
const DEFAULT_LOG_FILE_NAME = 'server.log'

type Command = 'status' | 'ensure' | 'start' | 'stop' | 'switch'

type ParsedArgs = {
  command: Command
}

type CommandResult = {
  stdout: string
  stderr: string
  status: number | null
}

type ClusterConfig = {
  targetUrl: URL
  host: string
  port: number
  requiredDatabaseNames: string[]
  expectedDataDir: string
  logFile: string
}

type ClusterInspection = {
  ready: boolean
  databases: string[] | null
  connectionError: string | null
  listeningDataDir: string | null
  expectedClusterRunning: boolean
  expectedClusterStatusOutput: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const commandArg = argv[0] ?? 'status'
  if (!['status', 'ensure', 'start', 'stop', 'switch'].includes(commandArg)) {
    throw new Error(`Unknown command "${commandArg}". Expected one of: status, ensure, start, stop, switch.`)
  }

  if (argv.includes('--env-file')) {
    throw new Error('The local Postgres guard no longer supports --env-file. Use .env.local with DATABASE_URL set to endpointarena_local_main.')
  }

  return {
    command: commandArg as Command,
  }
}

function loadEnvFile(filePath: string, override = false): boolean {
  if (!existsSync(filePath)) {
    return false
  }

  dotenv.config({
    path: filePath,
    override,
    quiet: true,
  })
  return true
}

function loadEnv(): void {
  const repoRoot = process.cwd()

  loadEnvFile(path.join(repoRoot, '.env'))
  loadEnvFile(path.join(repoRoot, DEFAULT_ENV_FILE), true)
}

function expandHome(inputPath: string): string {
  if (inputPath === '~') {
    return os.homedir()
  }
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2))
  }
  return inputPath
}

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase())
}

function normalizePort(url: URL): number {
  if (url.port) {
    return Number(url.port)
  }
  return 5432
}

function parseConnectionString(name: string): URL | null {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return null
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new Error(`${name} is not a valid URL.`)
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${name} must use postgres:// or postgresql://`)
  }

  if (!isLocalHostname(url.hostname)) {
    return null
  }

  return url
}

function runCommand(command: string, args: string[], allowFailure = false): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  const output = {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    status: result.status,
  }

  if (!allowFailure && result.status !== 0) {
    throw new Error([output.stdout, output.stderr].filter(Boolean).join('\n') || `${command} exited with status ${result.status}`)
  }

  return output
}

function extractDataDirFromCommand(command: string): string | null {
  const match = command.match(/(?:^|\s)-D\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/)
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null
  return value ? path.resolve(value) : null
}

function getListeningPostgresDataDir(port: number): string | null {
  const lsofResult = runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], true)
  if (lsofResult.status !== 0 || !lsofResult.stdout) {
    return null
  }

  const pid = lsofResult.stdout
    .split('\n')
    .find((line) => line.startsWith('p'))
    ?.slice(1)

  if (!pid) {
    return null
  }

  const psResult = runCommand('ps', ['-p', pid, '-o', 'command='], true)
  if (psResult.status !== 0 || !psResult.stdout) {
    return null
  }

  return extractDataDirFromCommand(psResult.stdout)
}

function getExpectedClusterStatus(dataDir: string): { running: boolean, output: string } {
  if (!existsSync(dataDir)) {
    return {
      running: false,
      output: `Data directory does not exist: ${dataDir}`,
    }
  }

  const result = runCommand('pg_ctl', ['-D', dataDir, 'status'], true)
  return {
    running: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n') || `pg_ctl exited with status ${result.status}`,
  }
}

async function listDatabases(targetUrl: URL): Promise<string[]> {
  const adminUrl = getAdminDatabaseUrl(targetUrl)
  const sql = postgres(adminUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
  })

  try {
    const rows = await sql<{ datname: string }[]>`
      select datname
      from pg_database
      where datistemplate = false
      order by datname
    `

    return rows.map((row) => row.datname)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function buildConfig(): Promise<ClusterConfig | null> {
  loadEnv()

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.')
  }

  const targetUrl = parseConnectionString('DATABASE_URL')
  if (!targetUrl) {
    console.log(`Skipping local Postgres guard because DATABASE_URL is not local: ${databaseUrl}`)
    return null
  }

  const requiredDatabaseNames = [getDatabaseName(targetUrl)]

  const expectedDataDir = path.resolve(
    expandHome(process.env.LOCAL_POSTGRES_DATA_DIR?.trim() || DEFAULT_DATA_DIR),
  )

  const logFile = path.resolve(
    expandHome(process.env.LOCAL_POSTGRES_LOG_FILE?.trim() || path.join(expectedDataDir, DEFAULT_LOG_FILE_NAME)),
  )

  return {
    targetUrl,
    host: targetUrl.hostname,
    port: normalizePort(targetUrl),
    requiredDatabaseNames,
    expectedDataDir,
    logFile,
  }
}

async function inspectCluster(config: ClusterConfig): Promise<ClusterInspection> {
  let databases: string[] | null = null
  let connectionError: string | null = null

  try {
    databases = await listDatabases(config.targetUrl)
  } catch (error) {
    connectionError = error instanceof Error ? error.message : String(error)
  }

  const listeningDataDir = getListeningPostgresDataDir(config.port)
  const expectedStatus = getExpectedClusterStatus(config.expectedDataDir)
  const ready = databases !== null && config.requiredDatabaseNames.every((name) => databases.includes(name))

  return {
    ready,
    databases,
    connectionError,
    listeningDataDir,
    expectedClusterRunning: expectedStatus.running,
    expectedClusterStatusOutput: expectedStatus.output,
  }
}

function formatReadySummary(config: ClusterConfig, inspection: ClusterInspection): string {
  const parts = [
    `Local Postgres is ready on ${config.host}:${config.port}.`,
    `Required databases: ${config.requiredDatabaseNames.join(', ')}`,
  ]

  if (inspection.listeningDataDir) {
    parts.push(`Listening data dir: ${inspection.listeningDataDir}`)
  }

  if (inspection.databases) {
    parts.push(`Available databases: ${inspection.databases.join(', ')}`)
  }

  return parts.join('\n')
}

function formatWrongClusterMessage(config: ClusterConfig, inspection: ClusterInspection): string {
  const foundDatabases = inspection.databases?.join(', ') || '(unknown)'
  const listeningDataDir = inspection.listeningDataDir ?? '(unable to detect active postgres data dir)'

  return [
    `A different Postgres cluster is listening on ${config.host}:${config.port}.`,
    `Expected databases: ${config.requiredDatabaseNames.join(', ')}`,
    `Found databases: ${foundDatabases}`,
    `Active data dir: ${listeningDataDir}`,
    `Expected data dir: ${config.expectedDataDir}`,
    'Run `npm run db:switch-local-postgres` to swap back to the project cluster.',
  ].join('\n')
}

function formatDownMessage(config: ClusterConfig, inspection: ClusterInspection): string {
  const details = inspection.connectionError ? `\nConnection error: ${inspection.connectionError}` : ''
  const runningElsewhere = inspection.expectedClusterRunning
    ? `\nThe project cluster is already running, but not on ${config.host}:${config.port}. Run \`npm run db:switch-local-postgres\` to move it back.`
    : ''

  return [
    `No usable Postgres cluster is available on ${config.host}:${config.port}.`,
    `Expected databases: ${config.requiredDatabaseNames.join(', ')}`,
    `Expected data dir: ${config.expectedDataDir}`,
    details,
    runningElsewhere,
    `Run \`npm run db:start-local-postgres\` to start the project cluster.`,
  ].filter(Boolean).join('\n')
}

function stopDataDir(dataDir: string): void {
  if (!existsSync(dataDir)) {
    throw new Error(`Data directory does not exist: ${dataDir}`)
  }

  const result = runCommand('pg_ctl', ['-D', dataDir, 'stop', '-m', 'fast'], true)
  if (result.status !== 0 && !/no server running/i.test([result.stdout, result.stderr].join('\n'))) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n') || `Failed to stop ${dataDir}`)
  }
}

function startDataDir(dataDir: string, logFile: string): void {
  if (!existsSync(dataDir)) {
    throw new Error(`Data directory does not exist: ${dataDir}`)
  }

  const result = runCommand('pg_ctl', ['-D', dataDir, '-l', logFile, 'start'], true)
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n') || `Failed to start ${dataDir}`)
  }
}

async function ensureReady(config: ClusterConfig, allowSwitch = false): Promise<void> {
  const inspection = await inspectCluster(config)
  if (inspection.ready) {
    console.log(formatReadySummary(config, inspection))
    return
  }

  if (inspection.databases) {
    if (!allowSwitch) {
      throw new Error(formatWrongClusterMessage(config, inspection))
    }

    if (inspection.listeningDataDir && path.resolve(inspection.listeningDataDir) !== config.expectedDataDir) {
      stopDataDir(inspection.listeningDataDir)
    } else if (inspection.listeningDataDir === null) {
      throw new Error(`${formatWrongClusterMessage(config, inspection)}\nRefusing to stop an unidentified cluster automatically.`)
    }
  } else if (inspection.expectedClusterRunning && !allowSwitch) {
    throw new Error(formatDownMessage(config, inspection))
  }

  const expectedStatus = getExpectedClusterStatus(config.expectedDataDir)
  if (expectedStatus.running) {
    stopDataDir(config.expectedDataDir)
  }

  startDataDir(config.expectedDataDir, config.logFile)

  const refreshed = await inspectCluster(config)
  if (!refreshed.ready) {
    if (refreshed.databases) {
      throw new Error(formatWrongClusterMessage(config, refreshed))
    }
    throw new Error(formatDownMessage(config, refreshed))
  }

  console.log(formatReadySummary(config, refreshed))
}

async function printStatus(config: ClusterConfig): Promise<void> {
  const inspection = await inspectCluster(config)

  if (inspection.ready) {
    console.log(formatReadySummary(config, inspection))
    return
  }

  if (inspection.databases) {
    throw new Error(formatWrongClusterMessage(config, inspection))
  }

  throw new Error(formatDownMessage(config, inspection))
}

async function stopExpectedCluster(config: ClusterConfig): Promise<void> {
  const status = getExpectedClusterStatus(config.expectedDataDir)
  if (!status.running) {
    console.log(`Project Postgres cluster is already stopped.\n${status.output}`)
    return
  }

  stopDataDir(config.expectedDataDir)
  console.log(`Stopped project Postgres cluster at ${config.expectedDataDir}.`)
}

async function main() {
  const { command } = parseArgs(process.argv.slice(2))
  const config = await buildConfig()
  if (!config) {
    return
  }

  if (command === 'status') {
    await printStatus(config)
    return
  }

  if (command === 'ensure' || command === 'start') {
    await ensureReady(config, false)
    return
  }

  if (command === 'switch') {
    await ensureReady(config, true)
    return
  }

  if (command === 'stop') {
    await stopExpectedCluster(config)
    return
  }

  throw new Error(`Unsupported command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
