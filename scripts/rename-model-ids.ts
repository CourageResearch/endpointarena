import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import dotenv from 'dotenv'
import postgres from 'postgres'
import {
  LEGACY_MODEL_ID_RENAMES,
  LEGACY_VERIFIER_MODEL_KEY_RENAMES,
  renameLegacyAiBatchState,
} from './model-id-rename-shared'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  apply: boolean
  databaseUrl: string | null
}

type AiBatchRow = {
  id: string
  status: string
  state: Record<string, unknown>
  error: string | null
}

type PlannedAiBatchUpdate = {
  id: string
  fromStatus: string
  toStatus: string
  stateChanged: boolean
  nextState: Record<string, unknown>
}

type ArchivedFile = {
  source: string
  destination: string
}

type VerifierTableName =
  | 'trial_monitor_configs'
  | 'trial_monitor_runs'
  | 'trial_outcome_candidates'
  | 'event_monitor_configs'
  | 'event_outcome_candidates'

type MigrationSummary = {
  apply: boolean
  marketActorsByLegacyKey: Record<string, number>
  verifierRowsByTable: Record<string, number>
  conflictingModelKeys: string[]
  aiBatchUpdates: Array<{
    id: string
    fromStatus: string
    toStatus: string
    stateChanged: boolean
  }>
  archivedFiles: ArchivedFile[]
}

const NON_TERMINAL_BATCH_STATUSES = new Set(['collecting', 'waiting', 'ready', 'clearing'])
const HANDOFF_ROOT = path.join(process.cwd(), 'tmp', 'admin-ai-handoff')
const HANDOFF_EXPORTS_DIR = path.join(HANDOFF_ROOT, 'exports')
const HANDOFF_DECISIONS_DIR = path.join(HANDOFF_ROOT, 'decisions')
const HANDOFF_ARCHIVE_DIR = path.join(HANDOFF_ROOT, 'archive')
const MAINTENANCE_LOG_MESSAGE = 'Batch reset during canonical model ID rename maintenance. Regenerate any subscription packets before rerunning.'

function parseArgs(argv: string[]): ParsedArgs {
  let apply = false
  let databaseUrl: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--dry-run') {
      apply = false
      continue
    }
    if (arg === '--database-url') {
      databaseUrl = argv[index + 1] ?? null
      index += 1
    }
  }

  return { apply, databaseUrl }
}

function resolveConnectionString(args: ParsedArgs): string {
  const connectionString =
    args.databaseUrl?.trim() ||
    process.env.TARGET_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim()

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Pass --database-url or set TARGET_DATABASE_URL/DATABASE_URL.')
  }

  return connectionString
}

function toInt(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function buildMaintenanceLog(nowIso: string) {
  return {
    id: crypto.randomUUID(),
    at: nowIso,
    message: MAINTENANCE_LOG_MESSAGE,
    tone: 'warning',
  }
}

function planAiBatchUpdate(row: AiBatchRow, nowIso: string): PlannedAiBatchUpdate | null {
  const renamedState = renameLegacyAiBatchState(row.state)
  const nextStatus = NON_TERMINAL_BATCH_STATUSES.has(row.status) ? 'reset' : row.status
  const nextLogs = Array.isArray(renamedState.logs)
    ? [...renamedState.logs, buildMaintenanceLog(nowIso)]
    : [buildMaintenanceLog(nowIso)]
  const nextState = NON_TERMINAL_BATCH_STATUSES.has(row.status)
    ? {
        ...renamedState,
        status: 'reset',
        updatedAt: nowIso,
        failureMessage: null,
        logs: nextLogs,
      }
    : renamedState

  const stateChanged = !isDeepStrictEqual(row.state, nextState)
  if (!stateChanged && row.status === nextStatus) {
    return null
  }

  return {
    id: row.id,
    fromStatus: row.status,
    toStatus: nextStatus,
    stateChanged,
    nextState,
  }
}

async function countRowsByModelKey(sql: postgres.Sql, modelKey: string): Promise<number> {
  const [row] = await sql<{ row_count: number | string }[]>`
    select count(*)::int as row_count
    from market_actors
    where actor_type = 'model'
      and model_key = ${modelKey}
  `

  return toInt(row?.row_count)
}

async function listConflictingTargetModelKeys(sql: postgres.Sql): Promise<string[]> {
  const conflicts: string[] = []

  for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_MODEL_ID_RENAMES)) {
    const [legacyCount, canonicalCount] = await Promise.all([
      countRowsByModelKey(sql, legacyKey),
      countRowsByModelKey(sql, canonicalKey),
    ])

    if (legacyCount > 0 && canonicalCount > 0) {
      conflicts.push(`${legacyKey} -> ${canonicalKey}`)
    }
  }

  return conflicts
}

async function listPendingHandoffFiles(): Promise<string[]> {
  const files: string[] = []

  for (const directory of [HANDOFF_EXPORTS_DIR, HANDOFF_DECISIONS_DIR]) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(path.join(directory, entry.name))
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

async function archivePendingHandoffFiles(files: string[]): Promise<ArchivedFile[]> {
  if (files.length === 0) {
    return []
  }

  await fs.mkdir(HANDOFF_ARCHIVE_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archived: ArchivedFile[] = []

  for (const source of files) {
    const directoryLabel = source.startsWith(HANDOFF_EXPORTS_DIR) ? 'exports' : 'decisions'
    const destination = path.join(
      HANDOFF_ARCHIVE_DIR,
      `${timestamp}-model-id-cutover-${directoryLabel}-${path.basename(source)}`,
    )
    await fs.rename(source, destination)
    archived.push({ source, destination })
  }

  return archived
}

async function countVerifierRows(sql: postgres.Sql, tableName: VerifierTableName, legacyKey: string): Promise<number> {
  if (tableName === 'trial_monitor_configs') {
    const [row] = await sql<{ row_count: number | string }[]>`
      select count(*)::int as row_count
      from trial_monitor_configs
      where verifier_model_key = ${legacyKey}
    `
    return toInt(row?.row_count)
  }
  if (tableName === 'trial_monitor_runs') {
    const [row] = await sql<{ row_count: number | string }[]>`
      select count(*)::int as row_count
      from trial_monitor_runs
      where verifier_model_key = ${legacyKey}
    `
    return toInt(row?.row_count)
  }
  if (tableName === 'trial_outcome_candidates') {
    const [row] = await sql<{ row_count: number | string }[]>`
      select count(*)::int as row_count
      from trial_outcome_candidates
      where verifier_model_key = ${legacyKey}
    `
    return toInt(row?.row_count)
  }
  if (tableName === 'event_monitor_configs') {
    const [row] = await sql<{ row_count: number | string }[]>`
      select count(*)::int as row_count
      from event_monitor_configs
      where verifier_model_key = ${legacyKey}
    `
    return toInt(row?.row_count)
  }

  const [row] = await sql<{ row_count: number | string }[]>`
    select count(*)::int as row_count
    from event_outcome_candidates
    where verifier_model_key = ${legacyKey}
  `
  return toInt(row?.row_count)
}

async function applyVerifierKeyRename(tx: postgres.Sql, tableName: VerifierTableName, legacyKey: string, canonicalKey: string): Promise<void> {
  if (tableName === 'trial_monitor_configs') {
    await tx`
      update trial_monitor_configs
      set verifier_model_key = ${canonicalKey}
      where verifier_model_key = ${legacyKey}
    `
    return
  }
  if (tableName === 'trial_monitor_runs') {
    await tx`
      update trial_monitor_runs
      set verifier_model_key = ${canonicalKey}
      where verifier_model_key = ${legacyKey}
    `
    return
  }
  if (tableName === 'trial_outcome_candidates') {
    await tx`
      update trial_outcome_candidates
      set verifier_model_key = ${canonicalKey}
      where verifier_model_key = ${legacyKey}
    `
    return
  }
  if (tableName === 'event_monitor_configs') {
    await tx`
      update event_monitor_configs
      set verifier_model_key = ${canonicalKey}
      where verifier_model_key = ${legacyKey}
    `
    return
  }

  await tx`
    update event_outcome_candidates
    set verifier_model_key = ${canonicalKey}
    where verifier_model_key = ${legacyKey}
  `
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const connectionString = resolveConnectionString(args)
  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    const [marketActorsByLegacyKeyEntries, conflictingModelKeys, aiBatchRows, pendingHandoffFiles] = await Promise.all([
      Promise.all(Object.keys(LEGACY_MODEL_ID_RENAMES).map(async (legacyKey) => (
        [legacyKey, await countRowsByModelKey(sql, legacyKey)] as const
      ))),
      listConflictingTargetModelKeys(sql),
      sql<AiBatchRow[]>`
        select id, status, state, error
        from ai_batches
        order by created_at, id
      `,
      listPendingHandoffFiles(),
    ])

    const verifierTables: readonly VerifierTableName[] = [
      'trial_monitor_configs',
      'trial_monitor_runs',
      'trial_outcome_candidates',
      'event_monitor_configs',
      'event_outcome_candidates',
    ]

    const verifierRowsByTableEntries = await Promise.all(verifierTables.map(async (tableName) => {
      let rowCount = 0
      for (const legacyKey of Object.keys(LEGACY_VERIFIER_MODEL_KEY_RENAMES)) {
        rowCount += await countVerifierRows(sql, tableName, legacyKey)
      }
      return [tableName, rowCount] as const
    }))

    const nowIso = new Date().toISOString()
    const aiBatchUpdates = aiBatchRows
      .map((row) => planAiBatchUpdate(row, nowIso))
      .filter((row): row is PlannedAiBatchUpdate => row !== null)

    const summary: MigrationSummary = {
      apply: args.apply,
      marketActorsByLegacyKey: Object.fromEntries(marketActorsByLegacyKeyEntries),
      verifierRowsByTable: Object.fromEntries(verifierRowsByTableEntries),
      conflictingModelKeys,
      aiBatchUpdates: aiBatchUpdates.map((row) => ({
        id: row.id,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        stateChanged: row.stateChanged,
      })),
      archivedFiles: pendingHandoffFiles.map((source) => ({
        source,
        destination: path.join(HANDOFF_ARCHIVE_DIR, `model-id-cutover-${path.basename(source)}`),
      })),
    }

    if (conflictingModelKeys.length > 0) {
      throw new Error(`Cannot rename model ids while both legacy and canonical actor rows exist: ${conflictingModelKeys.join(', ')}`)
    }

    if (!args.apply) {
      console.log(JSON.stringify(summary, null, 2))
      return
    }

    const archivedFiles = await archivePendingHandoffFiles(pendingHandoffFiles)

    await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql

      for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_MODEL_ID_RENAMES)) {
        await tx`
          update market_actors
          set model_key = ${canonicalKey}
          where actor_type = 'model'
            and model_key = ${legacyKey}
        `
      }

      for (const tableName of verifierTables) {
        for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_VERIFIER_MODEL_KEY_RENAMES)) {
          await applyVerifierKeyRename(tx, tableName, legacyKey, canonicalKey)
        }
      }

      for (const row of aiBatchUpdates) {
        await tx`
          update ai_batches
          set
            status = ${row.toStatus},
            state = ${JSON.stringify(row.nextState)}::jsonb,
            error = ${null},
            updated_at = ${nowIso}
          where id = ${row.id}
        `
      }
    })

    console.log(JSON.stringify({
      ...summary,
      archivedFiles,
    }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
