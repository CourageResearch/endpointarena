import { and, desc, eq } from 'drizzle-orm'
import { db, marketRuns } from '@/lib/db'

const DAILY_RUN_STOP_REQUEST_REASON =
  'Stop requested by admin. Finish the current in-flight model step, then halt the run.'
export const DAILY_RUN_STOPPED_REASON =
  'Daily market cycle stopped by admin after the current in-flight model step.'

class DailyRunStoppedError extends Error {
  constructor(message: string = DAILY_RUN_STOPPED_REASON) {
    super(message)
    this.name = 'DailyRunStoppedError'
  }
}

export function isDailyRunStoppedError(error: unknown): error is DailyRunStoppedError {
  return error instanceof DailyRunStoppedError
}

export async function requestDailyRunStop(runId?: string | null): Promise<string | null> {
  const activeRun = runId
    ? await db.query.marketRuns.findFirst({
        where: and(
          eq(marketRuns.id, runId),
          eq(marketRuns.status, 'running'),
        ),
      })
    : await db.query.marketRuns.findFirst({
        where: eq(marketRuns.status, 'running'),
        orderBy: [desc(marketRuns.updatedAt)],
      })

  if (!activeRun) return null

  const updated = await db.update(marketRuns)
    .set({
      failureReason: DAILY_RUN_STOP_REQUEST_REASON,
      updatedAt: new Date(),
    })
    .where(and(
      eq(marketRuns.id, activeRun.id),
      eq(marketRuns.status, 'running'),
    ))
    .returning({ id: marketRuns.id })

  return updated[0]?.id ?? null
}

export async function throwIfDailyRunStopRequested(runId: string): Promise<void> {
  const run = await db.query.marketRuns.findFirst({
    where: eq(marketRuns.id, runId),
    columns: {
      status: true,
      failureReason: true,
    },
  })

  if (!run || run.status !== 'running') return
  if (run.failureReason !== DAILY_RUN_STOP_REQUEST_REASON) return

  throw new DailyRunStoppedError()
}
