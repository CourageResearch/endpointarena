import { eq, inArray } from 'drizzle-orm'
import {
  db,
  marketAccounts,
  marketDailySnapshots,
  marketPriceSnapshots,
  marketRunLogs,
  marketRuns,
  modelDecisionSnapshots,
  phase2Trials,
  predictionMarkets,
  trialMonitorRuns,
  trialOutcomeCandidateEvidence,
  trialOutcomeCandidates,
  trialQuestions,
  trialSyncRuns,
} from '@/lib/db'
import { openMarketForTrialQuestion } from '@/lib/markets/engine'
import { getTrialMonitorConfig } from '@/lib/trial-monitor-config'
import { TRIAL_QUESTION_DEFINITIONS } from '@/lib/trial-questions'

const EXISTING_TRIAL_CHUNK_SIZE = 500

export type NormalizedPhase2TrialInput = {
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  indication: string
  exactPhase: string
  intervention: string
  primaryEndpoint: string
  studyStartDate: Date | null
  estPrimaryCompletionDate: Date
  estStudyCompletionDate: Date | null
  estResultsPostingDate: Date | null
  currentStatus: string
  estEnrollment: number | null
  keyLocations: string | null
  briefSummary: string
  standardBettingMarkets: string | null
}

export type Phase2IngestionSummary = {
  trialsUpserted: number
  questionsUpserted: number
  marketsOpened: number
  changes: Array<{
    changeType: 'inserted' | 'updated'
    trialId: string
    nctNumber: string
    shortTitle: string
    sponsorName: string
    currentStatus: string
    estPrimaryCompletionDate: Date
    changeSummary: string | null
  }>
}

export type IngestPhase2TrialsOptions = {
  reset?: boolean
  preserveExistingSponsorTickerOnNull?: boolean
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function datesEqual(left: Date | null | undefined, right: Date | null | undefined) {
  const leftTime = left instanceof Date ? left.getTime() : null
  const rightTime = right instanceof Date ? right.getTime() : null
  return leftTime === rightTime
}

function buildChangeSummary(existingTrial: typeof phase2Trials.$inferSelect, nextTrial: NormalizedPhase2TrialInput & { sponsorTicker: string | null }) {
  const changedFields: string[] = []
  const check = (label: string, changed: boolean) => {
    if (changed) changedFields.push(label)
  }

  check('title', existingTrial.shortTitle !== nextTrial.shortTitle)
  check('sponsor', existingTrial.sponsorName !== nextTrial.sponsorName)
  check('ticker', (existingTrial.sponsorTicker ?? null) !== nextTrial.sponsorTicker)
  check('indication', existingTrial.indication !== nextTrial.indication)
  check('phase', existingTrial.exactPhase !== nextTrial.exactPhase)
  check('intervention', existingTrial.intervention !== nextTrial.intervention)
  check('primary endpoint', existingTrial.primaryEndpoint !== nextTrial.primaryEndpoint)
  check('start date', !datesEqual(existingTrial.studyStartDate, nextTrial.studyStartDate))
  check('primary completion', !datesEqual(existingTrial.estPrimaryCompletionDate, nextTrial.estPrimaryCompletionDate))
  check('study completion', !datesEqual(existingTrial.estStudyCompletionDate, nextTrial.estStudyCompletionDate))
  check('results posting', !datesEqual(existingTrial.estResultsPostingDate, nextTrial.estResultsPostingDate))
  check('status', existingTrial.currentStatus !== nextTrial.currentStatus)
  check('enrollment', (existingTrial.estEnrollment ?? null) !== nextTrial.estEnrollment)
  check('locations', (existingTrial.keyLocations ?? null) !== nextTrial.keyLocations)
  check('summary', existingTrial.briefSummary !== nextTrial.briefSummary)
  check('betting markets', (existingTrial.standardBettingMarkets ?? null) !== nextTrial.standardBettingMarkets)

  return changedFields.length > 0 ? changedFields.join(', ') : null
}

async function loadExistingTrialsByNctNumbers(nctNumbers: string[]) {
  const rows = await Promise.all(
    chunkArray(Array.from(new Set(nctNumbers)), EXISTING_TRIAL_CHUNK_SIZE).map((chunk) => (
      db.query.phase2Trials.findMany({
        where: inArray(phase2Trials.nctNumber, chunk),
      })
    )),
  )

  return new Map(rows.flat().map((row) => [row.nctNumber, row]))
}

export async function resetPhase2TrialData(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(trialOutcomeCandidateEvidence)
    await tx.delete(trialOutcomeCandidates)
    await tx.delete(trialMonitorRuns)
    await tx.delete(trialSyncRuns)
    await tx.delete(modelDecisionSnapshots)
    await tx.delete(marketRunLogs)
    await tx.delete(marketRuns)
    await tx.delete(marketPriceSnapshots)
    await tx.delete(marketDailySnapshots)
    await tx.delete(predictionMarkets)
    await tx.delete(trialQuestions)
    await tx.delete(phase2Trials)
    await tx.delete(marketAccounts)
  })
}

export async function ingestPhase2Trials(
  rows: NormalizedPhase2TrialInput[],
  options: IngestPhase2TrialsOptions = {},
): Promise<Phase2IngestionSummary> {
  if (options.reset) {
    await resetPhase2TrialData()
  }

  await getTrialMonitorConfig()

  const existingTrialsByNct = options.preserveExistingSponsorTickerOnNull
    ? await loadExistingTrialsByNctNumbers(rows.map((row) => row.nctNumber))
    : new Map<string, typeof phase2Trials.$inferSelect>()

  const summary: Phase2IngestionSummary = {
    trialsUpserted: 0,
    questionsUpserted: 0,
    marketsOpened: 0,
    changes: [],
  }

  for (const row of rows) {
    const existingTrial = existingTrialsByNct.get(row.nctNumber)
    const sponsorTicker = row.sponsorTicker ?? existingTrial?.sponsorTicker ?? null
    const normalizedRow = {
      ...row,
      sponsorTicker,
    }

    let trial: typeof phase2Trials.$inferSelect
    if (!existingTrial) {
      [trial] = await db.insert(phase2Trials)
        .values({
          nctNumber: row.nctNumber,
          shortTitle: row.shortTitle,
          sponsorName: row.sponsorName,
          sponsorTicker,
          indication: row.indication,
          exactPhase: row.exactPhase,
          intervention: row.intervention,
          primaryEndpoint: row.primaryEndpoint,
          studyStartDate: row.studyStartDate,
          estPrimaryCompletionDate: row.estPrimaryCompletionDate,
          estStudyCompletionDate: row.estStudyCompletionDate,
          estResultsPostingDate: row.estResultsPostingDate,
          currentStatus: row.currentStatus,
          estEnrollment: row.estEnrollment,
          keyLocations: row.keyLocations,
          briefSummary: row.briefSummary,
          standardBettingMarkets: row.standardBettingMarkets,
          updatedAt: new Date(),
        })
        .returning()

      summary.trialsUpserted += 1
      summary.changes.push({
        changeType: 'inserted',
        trialId: trial.id,
        nctNumber: trial.nctNumber,
        shortTitle: trial.shortTitle,
        sponsorName: trial.sponsorName,
        currentStatus: trial.currentStatus,
        estPrimaryCompletionDate: trial.estPrimaryCompletionDate,
        changeSummary: null,
      })
    } else {
      const changeSummary = buildChangeSummary(existingTrial, normalizedRow)

      if (changeSummary) {
        const [updated] = await db.update(phase2Trials)
          .set({
            shortTitle: row.shortTitle,
            sponsorName: row.sponsorName,
            sponsorTicker,
            indication: row.indication,
            exactPhase: row.exactPhase,
            intervention: row.intervention,
            primaryEndpoint: row.primaryEndpoint,
            studyStartDate: row.studyStartDate,
            estPrimaryCompletionDate: row.estPrimaryCompletionDate,
            estStudyCompletionDate: row.estStudyCompletionDate,
            estResultsPostingDate: row.estResultsPostingDate,
            currentStatus: row.currentStatus,
            estEnrollment: row.estEnrollment,
            keyLocations: row.keyLocations,
            briefSummary: row.briefSummary,
            standardBettingMarkets: row.standardBettingMarkets,
            updatedAt: new Date(),
          })
          .where(eq(phase2Trials.id, existingTrial.id))
          .returning()
        trial = updated
        summary.trialsUpserted += 1
        summary.changes.push({
          changeType: 'updated',
          trialId: trial.id,
          nctNumber: trial.nctNumber,
          shortTitle: trial.shortTitle,
          sponsorName: trial.sponsorName,
          currentStatus: trial.currentStatus,
          estPrimaryCompletionDate: trial.estPrimaryCompletionDate,
          changeSummary,
        })
      } else {
        trial = existingTrial
      }
    }

    existingTrialsByNct.set(row.nctNumber, trial)

    for (const definition of TRIAL_QUESTION_DEFINITIONS) {
      const [question] = await db.insert(trialQuestions)
        .values({
          trialId: trial.id,
          slug: definition.slug,
          prompt: definition.prompt,
          status: definition.status,
          isBettable: definition.isBettable,
          sortOrder: definition.sortOrder,
          outcome: 'Pending',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [trialQuestions.trialId, trialQuestions.slug],
          set: {
            prompt: definition.prompt,
            status: definition.status,
            isBettable: definition.isBettable,
            sortOrder: definition.sortOrder,
            updatedAt: new Date(),
          },
        })
        .returning()

      summary.questionsUpserted += 1

      if (!definition.isBettable || definition.status !== 'live') {
        continue
      }

      const existingMarket = await db.query.predictionMarkets.findFirst({
        where: eq(predictionMarkets.trialQuestionId, question.id),
      })
      if (!existingMarket) {
        await openMarketForTrialQuestion(question.id)
        summary.marketsOpened += 1
      }
    }
  }

  return summary
}
