import { and, desc, eq, inArray, sql } from 'drizzle-orm'
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

export type AdminTrialRunSnapshot = {
  runId: string
  runDate: string
  status: 'running' | 'completed' | 'failed'
  runCount: number
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

function toEpoch(value: Date | null | undefined): number {
  return value instanceof Date ? value.getTime() : Number.NaN
}

function maxDate(...values: Array<Date | null | undefined>): Date | null {
  const dated = values.filter((value): value is Date => value instanceof Date)
  if (dated.length === 0) return null
  return dated.reduce((latest, current) => (current.getTime() > latest.getTime() ? current : latest))
}

function minDate(...values: Array<Date | null | undefined>): Date | null {
  const dated = values.filter((value): value is Date => value instanceof Date)
  if (dated.length === 0) return null
  return dated.reduce((earliest, current) => (current.getTime() < earliest.getTime() ? current : earliest))
}

type RunLogWithActor = typeof marketRunLogs.$inferSelect & {
  actor?: {
    modelKey: string | null
  } | null
}

function mapRunLogEntry(log: RunLogWithActor): PersistedRunLogEntry {
  return {
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
  }
}

function buildSnapshotFromRuns(input: {
  runs: Array<typeof marketRuns.$inferSelect>
  logs: RunLogWithActor[]
}): AdminTrialRunSnapshot | null {
  const { runs, logs } = input
  if (runs.length === 0) return null

  const latestRun = [...runs].sort((left, right) => {
    const updatedDiff = toEpoch(right.updatedAt ?? right.createdAt) - toEpoch(left.updatedAt ?? left.createdAt)
    if (updatedDiff !== 0) return updatedDiff
    return toEpoch(right.createdAt) - toEpoch(left.createdAt)
  })[0]

  const createdAt = minDate(...runs.map((run) => run.createdAt))
  const updatedAt = maxDate(...runs.map((run) => run.updatedAt ?? run.createdAt))
  const completedAt = maxDate(...runs.map((run) => run.completedAt ?? run.updatedAt ?? run.createdAt))
  const touchedMarketIds = new Set(
    logs
      .map((log) => log.marketId)
      .filter((marketId): marketId is string => typeof marketId === 'string' && marketId.length > 0),
  )

  return {
    runId: latestRun.id,
    runDate: latestRun.runDate.toISOString(),
    status: runs.some((run) => run.status === 'running')
      ? 'running'
      : runs.some((run) => run.status === 'failed')
        ? 'failed'
        : 'completed',
    runCount: runs.length,
    openMarkets: touchedMarketIds.size > 0
      ? touchedMarketIds.size
      : runs.reduce((total, run) => total + run.openMarkets, 0),
    totalActions: runs.reduce((total, run) => total + run.totalActions, 0),
    processedActions: runs.reduce((total, run) => total + run.processedActions, 0),
    okCount: runs.reduce((total, run) => total + run.okCount, 0),
    errorCount: runs.reduce((total, run) => total + run.errorCount, 0),
    skippedCount: runs.reduce((total, run) => total + run.skippedCount, 0),
    failureReason: latestRun.failureReason ?? null,
    createdAt: toIsoString(createdAt),
    updatedAt: toIsoString(updatedAt),
    completedAt: toIsoString(completedAt),
    logs: logs.map(mapRunLogEntry),
  }
}

function isTrialRunSql() {
  return sql`(
    exists (
      select 1
      from market_run_logs mrl
      where mrl.run_id = ${marketRuns.id}
        and mrl.trial_question_id is not null
    )
    or exists (
      select 1
      from market_actions ma
      where ma.run_id = ${marketRuns.id}
        and ma.trial_question_id is not null
    )
    or exists (
      select 1
      from model_decision_snapshots mds
      where mds.run_id = ${marketRuns.id}
        and mds.trial_question_id is not null
    )
  )`
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

export async function appendTrialRunLog(input: {
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
    where: and(
      eq(marketRuns.status, 'running'),
      isTrialRunSql(),
    ),
    orderBy: [desc(marketRuns.updatedAt), desc(marketRuns.createdAt)],
  })

  if (!activeRun) return null
  const staleFailed = await failStaleRunningRunIfNeeded(activeRun)
  return staleFailed ? null : activeRun.id
}

export async function getLatestTrialRunSnapshot(): Promise<AdminTrialRunSnapshot | null> {
  let running = await db.query.marketRuns.findFirst({
    where: and(
      eq(marketRuns.status, 'running'),
      isTrialRunSql(),
    ),
    orderBy: [desc(marketRuns.updatedAt), desc(marketRuns.createdAt)],
  })

  if (running) {
    const staleFailed = await failStaleRunningRunIfNeeded(running)
    if (staleFailed) {
      running = undefined
    }
  }

  const latest = running ?? await db.query.marketRuns.findFirst({
    where: isTrialRunSql(),
    orderBy: [desc(marketRuns.createdAt), desc(marketRuns.updatedAt)],
  })

  if (!latest) return null

  const runsForDate = await db.query.marketRuns.findMany({
    where: and(
      eq(marketRuns.runDate, latest.runDate),
      isTrialRunSql(),
    ),
    orderBy: [desc(marketRuns.createdAt), desc(marketRuns.updatedAt)],
  })
  const runIds = runsForDate.map((run) => run.id)
  const logs = runIds.length === 0
    ? []
    : await db.query.marketRunLogs.findMany({
        where: and(
          inArray(marketRunLogs.runId, runIds),
          sql`${marketRunLogs.trialQuestionId} is not null`,
        ),
        orderBy: [desc(marketRunLogs.createdAt)],
        limit: 4000,
        with: {
          actor: true,
        },
      })

  return buildSnapshotFromRuns({
    runs: runsForDate,
    logs,
  })
}
