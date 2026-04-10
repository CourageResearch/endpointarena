import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type AiBatchRow = {
  id: string
  dataset: string
  status: string
  state: Record<string, unknown>
  error: string | null
  created_at: string
  updated_at: string
}

type SummaryRow = {
  row_count: string | number
  latest_updated_at: string | null
}

type DatasetStatusRow = {
  dataset: string
  status: string
  row_count: string | number
}

type ParsedArgs = {
  apply: boolean
  outputDir: string
  prodService: string
  prodDatabaseUrl: string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let apply = false
  let outputDir = path.resolve(process.cwd(), 'backups')
  let prodService = 'postgres-green'
  let prodDatabaseUrl: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--output-dir') {
      outputDir = path.resolve(process.cwd(), argv[index + 1] ?? '')
      index += 1
      continue
    }
    if (arg === '--prod-service') {
      prodService = (argv[index + 1] ?? '').trim() || prodService
      index += 1
      continue
    }
    if (arg === '--prod-database-url') {
      prodDatabaseUrl = (argv[index + 1] ?? '').trim() || null
      index += 1
    }
  }

  return {
    apply,
    outputDir,
    prodService,
    prodDatabaseUrl,
  }
}

function formatTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '').replace('T', '-').replace('Z', '')
}

function timestampsMatch(left: string | null, right: string | null): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function toSqlValue(value: unknown): string {
  if (value == null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return escapeSqlString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return `${escapeSqlString(JSON.stringify(value))}::jsonb`
}

function buildAiInsertSql(rows: AiBatchRow[]): string {
  if (rows.length === 0) {
    return '-- no rows\n'
  }

  const values = rows.map((row) => `(
  ${toSqlValue(row.id)},
  ${toSqlValue(row.dataset)},
  ${toSqlValue(row.status)},
  ${toSqlValue(row.state)},
  ${toSqlValue(row.error)},
  ${toSqlValue(row.created_at)}::timestamptz,
  ${toSqlValue(row.updated_at)}::timestamptz
)`)

  return [
    'insert into ai_batches (id, dataset, status, state, error, created_at, updated_at)',
    'values',
    `${values.join(',\n')};`,
    '',
  ].join('\n')
}

function buildReplaySql(rows: AiBatchRow[]): string {
  return [
    'begin;',
    'delete from ai_batches;',
    buildAiInsertSql(rows).trimEnd(),
    'commit;',
    '',
  ].join('\n')
}

function resolveProdDatabaseUrl(prodService: string, explicitUrl: string | null): string {
  if (explicitUrl) {
    return explicitUrl
  }

  const output = process.platform === 'win32'
    ? execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `railway variable list --service ${prodService} --json`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    : execFileSync(
        'railway',
        ['variable', 'list', '--service', prodService, '--json'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )

  const parsed = JSON.parse(output) as Record<string, unknown>
  const databasePublicUrl = typeof parsed.DATABASE_PUBLIC_URL === 'string'
    ? parsed.DATABASE_PUBLIC_URL.trim()
    : ''

  if (!databasePublicUrl) {
    throw new Error(`DATABASE_PUBLIC_URL is missing for Railway service ${prodService}`)
  }

  return databasePublicUrl
}

function requireLocalDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('Local DATABASE_URL is not set')
  }

  const parsed = new URL(databaseUrl)
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing to use non-local source DATABASE_URL host "${parsed.hostname}"`)
  }

  return databaseUrl
}

async function loadRows(sql: postgres.Sql): Promise<AiBatchRow[]> {
  return await sql<AiBatchRow[]>`
    select
      id,
      dataset,
      status,
      state,
      error,
      created_at::text,
      updated_at::text
    from ai_batches
    order by created_at, id
  `
}

async function loadSummary(sql: postgres.Sql): Promise<{
  rowCount: number
  latestUpdatedAt: string | null
  datasetStatusCounts: Array<{ dataset: string; status: string; rowCount: number }>
}> {
  const [summaryRows, datasetStatusRows] = await Promise.all([
    sql<SummaryRow[]>`
      select
        count(*)::bigint as row_count,
        max(updated_at)::text as latest_updated_at
      from ai_batches
    `,
    sql<DatasetStatusRow[]>`
      select
        dataset,
        status,
        count(*)::bigint as row_count
      from ai_batches
      group by dataset, status
      order by dataset, status
    `,
  ])

  return {
    rowCount: Number(summaryRows[0]?.row_count ?? 0),
    latestUpdatedAt: summaryRows[0]?.latest_updated_at ?? null,
    datasetStatusCounts: datasetStatusRows.map((row) => ({
      dataset: row.dataset,
      status: row.status,
      rowCount: Number(row.row_count),
    })),
  }
}

async function writeFile(filePath: string, contents: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
  return filePath
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const localDatabaseUrl = requireLocalDatabaseUrl()
  const prodDatabaseUrl = resolveProdDatabaseUrl(args.prodService, args.prodDatabaseUrl)
  const timestamp = formatTimestamp()

  const localSql = postgres(localDatabaseUrl, { prepare: false, max: 1 })
  const prodSql = postgres(prodDatabaseUrl, { prepare: false, max: 1 })

  try {
    const [localRows, prodRows, localSummaryBefore, prodSummaryBefore] = await Promise.all([
      loadRows(localSql),
      loadRows(prodSql),
      loadSummary(localSql),
      loadSummary(prodSql),
    ])

    const prodBackupPath = path.resolve(args.outputDir, `prod-ai-batches-before-sync-${timestamp}.sql`)
    const localReplayPath = path.resolve(args.outputDir, `local-ai-batches-sync-${timestamp}.sql`)

    await Promise.all([
      writeFile(
        prodBackupPath,
        [
          '-- Production ai_batches backup generated before sync',
          buildAiInsertSql(prodRows),
        ].join('\n'),
      ),
      writeFile(
        localReplayPath,
        [
          '-- Local ai_batches replay script for production sync',
          buildReplaySql(localRows),
        ].join('\n'),
      ),
    ])

    let prodSummaryAfter = prodSummaryBefore

    if (args.apply) {
      await prodSql.begin(async (rawTx) => {
        const tx = rawTx as unknown as postgres.Sql

        await tx`delete from ai_batches`

        if (localRows.length > 0) {
          await tx.unsafe(buildAiInsertSql(localRows))
        }
      })

      prodSummaryAfter = await loadSummary(prodSql)
    }

    console.log(JSON.stringify({
      mode: args.apply ? 'apply' : 'dry-run',
      localSourceHost: new URL(localDatabaseUrl).hostname,
      localSourceDatabase: new URL(localDatabaseUrl).pathname.replace(/^\//, ''),
      prodService: args.prodService,
      artifactPaths: {
        prodBackupSql: prodBackupPath,
        localReplaySql: localReplayPath,
      },
      localSummaryBefore,
      prodSummaryBefore,
      prodSummaryAfter,
      localBatchIds: localRows.map((row) => row.id),
      prodBatchIdsBefore: prodRows.map((row) => row.id),
      readyToApply: true,
      verifiedRowCountMatch: args.apply
        ? prodSummaryAfter.rowCount === localSummaryBefore.rowCount
        : null,
      verifiedLatestUpdatedAtMatch: args.apply
        ? timestampsMatch(prodSummaryAfter.latestUpdatedAt, localSummaryBefore.latestUpdatedAt)
        : null,
    }, null, 2))
  } finally {
    await Promise.all([
      localSql.end({ timeout: 1 }),
      prodSql.end({ timeout: 1 }),
    ])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
