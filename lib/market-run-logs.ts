import { and, desc, eq, sql } from 'drizzle-orm'
import { db, marketRunLogs, marketRuns } from '@/lib/db'
import type { DailyRunStatus } from '@/lib/markets/types'
import { MARKET_RUN_STALE_TIMEOUT_MS } from '@/lib/markets/run-health'

type LogType = 'system' | 'activity' | 'progress' | 'error'

export type PersistedRunLogEntry = {
  id: string
  runId: string
  logType: LogType
  message: string
  completedActions: number | null
  totalActions: number | null
  okCount: number | null
  errorCount: number | null
  skippedCount: number | null
  modelId: string | null
  action: string | null
  actionStatus: DailyRunStatus | null
  amountUsd: number | null
  createdAt: string | null
}

export type AdminMarketRunSnapshot = {
  runId: string
  runDate: string
  status: 'running' | 'completed' | 'failed'
  openMarkets: number
  totalActions: number
  processedActions: number
  okCount: number
  errorCount: number
  skippedCount: number
  failureReason: string | null
  createdAt: string | null
  updatedAt: string | null
  completedAt: string | null
  logs: PersistedRunLogEntry[]
}

declare global {
  // eslint-disable-next-line no-var
  var __marketRunLogSchemaReadyPromise: Promise<void> | undefined
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function getRunHeartbeatAt(run: {
  runDate: Date
  createdAt: Date | null
  updatedAt: Date | null
}): Date {
  return run.updatedAt ?? run.createdAt ?? run.runDate
}

async function failStaleRunningRunIfNeeded(run: {
  id: string
  runDate: Date
  createdAt: Date | null
  updatedAt: Date | null
  failureReason: string | null
}): Promise<boolean> {
  const heartbeatAt = getRunHeartbeatAt(run)
  const heartbeatAgeMs = Date.now() - heartbeatAt.getTime()
  if (heartbeatAgeMs < MARKET_RUN_STALE_TIMEOUT_MS) return false

  const now = new Date()
  const autoFailureReason = run.failureReason && run.failureReason.trim().length > 0
    ? run.failureReason
    : `Auto-failed stale run after ${Math.round(heartbeatAgeMs / 60000)}m without heartbeat updates.`

  await db.update(marketRuns)
    .set({
      status: 'failed',
      failureReason: autoFailureReason,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(marketRuns.id, run.id),
      eq(marketRuns.status, 'running'),
    ))

  return true
}

export async function ensureMarketRunLogSchema(): Promise<void> {
  if (globalThis.__marketRunLogSchemaReadyPromise) {
    return globalThis.__marketRunLogSchemaReadyPromise
  }

  globalThis.__marketRunLogSchemaReadyPromise = (async () => {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS market_run_logs (
          id text PRIMARY KEY,
          run_id text NOT NULL REFERENCES market_runs(id) ON DELETE CASCADE,
          log_type text NOT NULL DEFAULT 'activity',
          message text NOT NULL,
          completed_actions integer,
          total_actions integer,
          ok_count integer,
          error_count integer,
          skipped_count integer,
          model_id text,
          action text,
          action_status text,
          amount_usd real,
          created_at timestamp DEFAULT now(),
          CONSTRAINT market_run_logs_log_type_check CHECK (log_type IN ('system', 'activity', 'progress', 'error')),
          CONSTRAINT market_run_logs_action_status_check CHECK (action_status IS NULL OR action_status IN ('ok', 'error', 'skipped')),
          CONSTRAINT market_run_logs_completed_actions_check CHECK (completed_actions IS NULL OR completed_actions >= 0),
          CONSTRAINT market_run_logs_total_actions_check CHECK (total_actions IS NULL OR total_actions >= 0),
          CONSTRAINT market_run_logs_ok_count_check CHECK (ok_count IS NULL OR ok_count >= 0),
          CONSTRAINT market_run_logs_error_count_check CHECK (error_count IS NULL OR error_count >= 0),
          CONSTRAINT market_run_logs_skipped_count_check CHECK (skipped_count IS NULL OR skipped_count >= 0)
        )
      `)

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS market_run_logs_run_created_idx
        ON market_run_logs (run_id, created_at)
      `)

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS market_run_logs_created_at_idx
        ON market_run_logs (created_at)
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_log_type_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_log_type_check
              CHECK (log_type IN ('system', 'activity', 'progress', 'error'));
          END IF;
        END
        $$;
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_action_status_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_action_status_check
              CHECK (action_status IS NULL OR action_status IN ('ok', 'error', 'skipped'));
          END IF;
        END
        $$;
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_completed_actions_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_completed_actions_check
              CHECK (completed_actions IS NULL OR completed_actions >= 0);
          END IF;
        END
        $$;
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_total_actions_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_total_actions_check
              CHECK (total_actions IS NULL OR total_actions >= 0);
          END IF;
        END
        $$;
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_ok_count_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_ok_count_check
              CHECK (ok_count IS NULL OR ok_count >= 0);
          END IF;
        END
        $$;
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_error_count_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_error_count_check
              CHECK (error_count IS NULL OR error_count >= 0);
          END IF;
        END
        $$;
      `)

      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'market_run_logs_skipped_count_check'
              AND conrelid = 'market_run_logs'::regclass
          ) THEN
            ALTER TABLE market_run_logs
              ADD CONSTRAINT market_run_logs_skipped_count_check
              CHECK (skipped_count IS NULL OR skipped_count >= 0);
          END IF;
        END
        $$;
      `)
    } catch (error) {
      globalThis.__marketRunLogSchemaReadyPromise = undefined
      throw error
    }
  })()

  return globalThis.__marketRunLogSchemaReadyPromise
}

export async function appendMarketRunLog(input: {
  runId: string
  logType: LogType
  message: string
  completedActions?: number | null
  totalActions?: number | null
  okCount?: number | null
  errorCount?: number | null
  skippedCount?: number | null
  modelId?: string | null
  action?: string | null
  actionStatus?: DailyRunStatus | null
  amountUsd?: number | null
}): Promise<void> {
  await ensureMarketRunLogSchema()

  await db.insert(marketRunLogs).values({
    runId: input.runId,
    logType: input.logType,
    message: input.message,
    completedActions: input.completedActions ?? null,
    totalActions: input.totalActions ?? null,
    okCount: input.okCount ?? null,
    errorCount: input.errorCount ?? null,
    skippedCount: input.skippedCount ?? null,
    modelId: input.modelId ?? null,
    action: input.action ?? null,
    actionStatus: input.actionStatus ?? null,
    amountUsd: input.amountUsd ?? null,
  })
}

export async function clearMarketRunLogs(runId: string): Promise<void> {
  await ensureMarketRunLogSchema()
  await db.delete(marketRunLogs).where(eq(marketRunLogs.runId, runId))
}

export async function getRunningMarketRunId(): Promise<string | null> {
  const activeRun = await db.query.marketRuns.findFirst({
    where: eq(marketRuns.status, 'running'),
    orderBy: [desc(marketRuns.updatedAt)],
  })

  if (!activeRun) return null
  const staleFailed = await failStaleRunningRunIfNeeded(activeRun)
  return staleFailed ? null : activeRun.id
}

export async function getLatestMarketRunSnapshot(): Promise<AdminMarketRunSnapshot | null> {
  await ensureMarketRunLogSchema()

  let running = await db.query.marketRuns.findFirst({
    where: eq(marketRuns.status, 'running'),
    orderBy: [desc(marketRuns.updatedAt)],
  })

  if (running) {
    const staleFailed = await failStaleRunningRunIfNeeded(running)
    if (staleFailed) {
      running = undefined
    }
  }

  const latest = running ?? await db.query.marketRuns.findFirst({
    orderBy: [desc(marketRuns.runDate)],
  })

  if (!latest) return null

  const logs = await db.query.marketRunLogs.findMany({
    where: eq(marketRunLogs.runId, latest.id),
    orderBy: [desc(marketRunLogs.createdAt)],
    limit: 120,
  })

  return {
    runId: latest.id,
    runDate: latest.runDate.toISOString(),
    status: latest.status as 'running' | 'completed' | 'failed',
    openMarkets: latest.openMarkets,
    totalActions: latest.totalActions,
    processedActions: latest.processedActions,
    okCount: latest.okCount,
    errorCount: latest.errorCount,
    skippedCount: latest.skippedCount,
    failureReason: latest.failureReason ?? null,
    createdAt: toIsoString(latest.createdAt),
    updatedAt: toIsoString(latest.updatedAt),
    completedAt: toIsoString(latest.completedAt),
    logs: logs.map((log) => ({
      id: log.id,
      runId: log.runId,
      logType: log.logType as LogType,
      message: log.message,
      completedActions: log.completedActions ?? null,
      totalActions: log.totalActions ?? null,
      okCount: log.okCount ?? null,
      errorCount: log.errorCount ?? null,
      skippedCount: log.skippedCount ?? null,
      modelId: log.modelId ?? null,
      action: log.action ?? null,
      actionStatus: (log.actionStatus as DailyRunStatus | null) ?? null,
      amountUsd: log.amountUsd ?? null,
      createdAt: toIsoString(log.createdAt),
    })),
  }
}
