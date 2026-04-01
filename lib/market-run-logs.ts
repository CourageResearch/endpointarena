import { and, desc, eq, sql } from 'drizzle-orm'
import { db, marketRunLogs, marketRuns } from '@/lib/db'
import type { DailyRunActivityPhase, DailyRunStatus } from '@/lib/markets/types'
import { MARKET_RUN_STALE_TIMEOUT_MINUTES, MARKET_RUN_STALE_TIMEOUT_SECONDS } from '@/lib/markets/run-health'

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
  marketId: string | null
  trialQuestionId: string | null
  actorId: string | null
  modelId: string | null
  activityPhase: DailyRunActivityPhase | null
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

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

async function failStaleRunningRunIfNeeded(run: {
  id: string
  failureReason: string | null
}): Promise<boolean> {
  const now = new Date()
  const autoFailureReason = run.failureReason && run.failureReason.trim().length > 0
    ? run.failureReason
    : `Auto-failed stale run after ${MARKET_RUN_STALE_TIMEOUT_MINUTES}m without heartbeat updates.`

  const updated = await db.update(marketRuns)
    .set({
      status: 'failed',
      failureReason: autoFailureReason,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(marketRuns.id, run.id),
      eq(marketRuns.status, 'running'),
      sql`COALESCE(${marketRuns.updatedAt}, ${marketRuns.createdAt}, ${marketRuns.runDate}) < NOW() - (${MARKET_RUN_STALE_TIMEOUT_SECONDS} * INTERVAL '1 second')`,
    ))
    .returning({ id: marketRuns.id })

  return updated.length > 0
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
  marketId?: string | null
  trialQuestionId?: string | null
  actorId?: string | null
  activityPhase?: DailyRunActivityPhase | null
  action?: string | null
  actionStatus?: DailyRunStatus | null
  amountUsd?: number | null
}): Promise<void> {
  await db.insert(marketRunLogs).values({
    runId: input.runId,
    logType: input.logType,
    message: input.message,
    completedActions: input.completedActions ?? null,
    totalActions: input.totalActions ?? null,
    okCount: input.okCount ?? null,
    errorCount: input.errorCount ?? null,
    skippedCount: input.skippedCount ?? null,
    marketId: input.marketId ?? null,
    trialQuestionId: input.trialQuestionId ?? null,
    actorId: input.actorId ?? null,
    activityPhase: input.activityPhase ?? null,
    action: input.action ?? null,
    actionStatus: input.actionStatus ?? null,
    amountUsd: input.amountUsd ?? null,
  })
}

async function getRunningMarketRunId(): Promise<string | null> {
  const activeRun = await db.query.marketRuns.findFirst({
    where: eq(marketRuns.status, 'running'),
    orderBy: [desc(marketRuns.updatedAt), desc(marketRuns.createdAt)],
  })

  if (!activeRun) return null
  const staleFailed = await failStaleRunningRunIfNeeded(activeRun)
  return staleFailed ? null : activeRun.id
}

export async function getLatestMarketRunSnapshot(): Promise<AdminMarketRunSnapshot | null> {
  let running = await db.query.marketRuns.findFirst({
    where: eq(marketRuns.status, 'running'),
    orderBy: [desc(marketRuns.updatedAt), desc(marketRuns.createdAt)],
  })

  if (running) {
    const staleFailed = await failStaleRunningRunIfNeeded(running)
    if (staleFailed) {
      running = undefined
    }
  }

  const latest = running ?? await db.query.marketRuns.findFirst({
    orderBy: [desc(marketRuns.createdAt), desc(marketRuns.updatedAt)],
  })

  if (!latest) return null

  const logs = await db.query.marketRunLogs.findMany({
    where: eq(marketRunLogs.runId, latest.id),
    orderBy: [desc(marketRunLogs.createdAt)],
    limit: 120,
    with: {
      actor: true,
    },
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
      marketId: log.marketId ?? null,
      trialQuestionId: log.trialQuestionId ?? null,
      actorId: log.actorId ?? null,
      modelId: log.actor?.modelKey ?? null,
      activityPhase: (log.activityPhase as DailyRunActivityPhase | null) ?? null,
      action: log.action ?? null,
      actionStatus: (log.actionStatus as DailyRunStatus | null) ?? null,
      amountUsd: log.amountUsd ?? null,
      createdAt: toIsoString(log.createdAt),
    })),
  }
}
