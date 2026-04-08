import { eq, sql } from 'drizzle-orm'
import { db, trialOutcomeCandidates } from '../lib/db'
import { listEligibleTrialOutcomeQuestions } from '../lib/trial-monitor'
import { getTrialMonitorConfig } from '../lib/trial-monitor-config'
import { assertLocalProjectDatabaseUrl } from './local-db-utils'

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  assertLocalProjectDatabaseUrl(connectionString)

  const [config, eligibleBefore, pendingCandidatesBeforeRows] = await Promise.all([
    getTrialMonitorConfig(),
    listEligibleTrialOutcomeQuestions(),
    db.select({ count: sql<number>`count(*)::int` })
      .from(trialOutcomeCandidates)
      .where(eq(trialOutcomeCandidates.status, 'pending_review')),
  ])

  const resetRows = await db.execute(sql`
    update phase2_trials as trial
    set
      last_monitored_at = null,
      updated_at = now()
    from trial_questions as question
    where question.trial_id = trial.id
      and question.status = 'live'
      and question.is_bettable = true
      and question.outcome = 'Pending'
      and trial.last_monitored_at is not null
    returning trial.id
  `)

  const eligibleAfter = await listEligibleTrialOutcomeQuestions()
  const pendingCandidatesAfterRows = await db.select({ count: sql<number>`count(*)::int` })
    .from(trialOutcomeCandidates)
    .where(eq(trialOutcomeCandidates.status, 'pending_review'))

  const pendingCandidatesBefore = pendingCandidatesBeforeRows[0]?.count ?? 0
  const pendingCandidatesAfter = pendingCandidatesAfterRows[0]?.count ?? 0

  console.log('Local trial monitor state reset complete.')
  console.log(`- Lookahead days: ${config.lookaheadDays}`)
  console.log(`- Max questions per run: ${config.maxQuestionsPerRun}`)
  console.log(`- Eligible questions before reset: ${eligibleBefore.length}`)
  console.log(`- Trials with monitor timestamps cleared: ${resetRows.length}`)
  console.log(`- Eligible questions after reset: ${eligibleAfter.length}`)
  console.log(`- Pending review candidates left untouched: ${pendingCandidatesAfter} (was ${pendingCandidatesBefore})`)

  await db.$client.end({ timeout: 5 })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
