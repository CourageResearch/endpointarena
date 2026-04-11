import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  db,
  trials,
  trialMonitorRuns,
  trialOutcomeCandidates,
  trialQuestions,
} from '../lib/db'
import { assertLocalProjectDatabaseUrl } from './local-db-utils'

type CountRow = {
  count: unknown
}

function readCount(rows: CountRow[]): number {
  return Number(rows[0]?.count ?? 0)
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  assertLocalProjectDatabaseUrl(connectionString)

  const targetQuestions = await db.query.trialQuestions.findMany({
    where: and(
      eq(trialQuestions.status, 'live'),
      eq(trialQuestions.isBettable, true),
      eq(trialQuestions.outcome, 'Pending'),
    ),
    columns: {
      id: true,
      trialId: true,
    },
  })

  const targetQuestionIds = targetQuestions.map((question) => question.id)
  const targetTrialIds = Array.from(new Set(targetQuestions.map((question) => question.trialId)))

  const [runsBeforeRows, candidatesBeforeRows, eligibleBeforeRows] = await Promise.all([
    db.select({ count: sql`count(*)::int` }).from(trialMonitorRuns),
    targetQuestionIds.length > 0
      ? db.select({ count: sql`count(*)::int` })
        .from(trialOutcomeCandidates)
        .where(inArray(trialOutcomeCandidates.trialQuestionId, targetQuestionIds))
      : Promise.resolve([{ count: 0 }]),
    db.select({ count: sql`count(*)::int` }).from(trialQuestions).where(and(
      eq(trialQuestions.status, 'live'),
      eq(trialQuestions.isBettable, true),
      eq(trialQuestions.outcome, 'Pending'),
    )),
  ])

  const runsBefore = readCount(runsBeforeRows)
  const candidatesBefore = readCount(candidatesBeforeRows)
  const eligibleBefore = readCount(eligibleBeforeRows)

  const result = await db.transaction(async (tx) => {
    let deletedCandidateCount = 0
    let resetTrialCount = 0

    if (targetQuestionIds.length > 0) {
      const deletedCandidates = await tx.delete(trialOutcomeCandidates)
        .where(inArray(trialOutcomeCandidates.trialQuestionId, targetQuestionIds))
        .returning({ id: trialOutcomeCandidates.id })
      deletedCandidateCount = deletedCandidates.length
    }

    if (targetTrialIds.length > 0) {
      const resetTrials = await tx.update(trials)
        .set({
          lastMonitoredAt: null,
          updatedAt: new Date(),
        })
        .where(inArray(trials.id, targetTrialIds))
        .returning({ id: trials.id })
      resetTrialCount = resetTrials.length
    }

    const deletedRuns = await tx.delete(trialMonitorRuns)
      .returning({ id: trialMonitorRuns.id })

    return {
      deletedCandidateCount,
      deletedRunCount: deletedRuns.length,
      resetTrialCount,
    }
  })

  const [runsAfterRows, candidatesAfterRows] = await Promise.all([
    db.select({ count: sql`count(*)::int` }).from(trialMonitorRuns),
    targetQuestionIds.length > 0
      ? db.select({ count: sql`count(*)::int` })
        .from(trialOutcomeCandidates)
        .where(inArray(trialOutcomeCandidates.trialQuestionId, targetQuestionIds))
      : Promise.resolve([{ count: 0 }]),
  ])

  const runsAfter = readCount(runsAfterRows)
  const candidatesAfter = readCount(candidatesAfterRows)

  console.log('Local trial monitor wipe complete.')
  console.log(`- Live pending questions kept: ${eligibleBefore}`)
  console.log(`- Monitor runs deleted: ${result.deletedRunCount} (was ${runsBefore}, now ${runsAfter})`)
  console.log(`- Candidates deleted for live pending questions: ${result.deletedCandidateCount} (was ${candidatesBefore}, now ${candidatesAfter})`)
  console.log(`- Trials reset for fresh monitoring: ${result.resetTrialCount}`)

  await db.$client.end({ timeout: 5 })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
