import { eq, inArray, sql } from 'drizzle-orm'
import {
  aiBatches,
  db,
  marketActions,
  marketAccounts,
  marketActors,
  marketDailySnapshots,
  marketPositions,
  marketPriceSnapshots,
  marketRunLogs,
  marketRuns,
  modelDecisionSnapshots,
  trials,
  predictionMarkets,
  trialMonitorRuns,
  trialOutcomeCandidateEvidence,
  trialOutcomeCandidates,
  trialQuestionOutcomeHistory,
  trialQuestions,
  trialSyncRuns,
  trialSyncRunItems,
} from '@/lib/db'
import { getTrialMonitorConfig } from '@/lib/trial-monitor-config'
import { TRIAL_QUESTION_DEFINITIONS } from '@/lib/trial-questions'
import type { TrialTherapeuticArea } from '@/lib/trial-therapeutic-areas'

const EXISTING_TRIAL_CHUNK_SIZE = 500

export type NormalizedTrialInput = {
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  indication: string
  therapeuticArea: TrialTherapeuticArea | null
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

export type TrialIngestionSummary = {
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

export type IngestTrialOptions = {
  /**
   * @deprecated Season 4 trial ingestion never opens legacy offchain markets.
   * This option is accepted for old callers, but it no longer changes behavior.
   */
  maxMarketsToOpen?: number
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

function shouldOpenMarketForTrial(row: NormalizedTrialInput, now: Date) {
  const normalizedStatus = row.currentStatus.trim().toLowerCase()
  if (normalizedStatus === 'completed' || normalizedStatus === 'terminated' || normalizedStatus === 'withdrawn' || normalizedStatus === 'suspended') {
    return false
  }

  return row.estPrimaryCompletionDate.getTime() >= now.getTime()
}

function compareRowsForMarketOpenPriority(
  left: NormalizedTrialInput,
  right: NormalizedTrialInput,
  now: Date,
) {
  const leftOpenable = shouldOpenMarketForTrial(left, now)
  const rightOpenable = shouldOpenMarketForTrial(right, now)

  if (leftOpenable !== rightOpenable) {
    return leftOpenable ? -1 : 1
  }

  return left.estPrimaryCompletionDate.getTime() - right.estPrimaryCompletionDate.getTime()
}

function buildChangeSummary(existingTrial: typeof trials.$inferSelect, nextTrial: NormalizedTrialInput & { sponsorTicker: string | null }) {
  const changedFields: string[] = []
  const check = (label: string, changed: boolean) => {
    if (changed) changedFields.push(label)
  }

  check('title', existingTrial.shortTitle !== nextTrial.shortTitle)
  check('sponsor', existingTrial.sponsorName !== nextTrial.sponsorName)
  check('ticker', (existingTrial.sponsorTicker ?? null) !== nextTrial.sponsorTicker)
  check('indication', existingTrial.indication !== nextTrial.indication)
  check('therapeutic area', (existingTrial.therapeuticArea ?? null) !== nextTrial.therapeuticArea)
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
      db.query.trials.findMany({
        where: inArray(trials.nctNumber, chunk),
      })
    )),
  )

  return new Map(rows.flat().map((row) => [row.nctNumber, row]))
}

async function resetTrialData(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(aiBatches)
    await tx.delete(trialOutcomeCandidateEvidence)
    await tx.delete(trialQuestionOutcomeHistory)
    await tx.delete(trialOutcomeCandidates)
    await tx.delete(trialSyncRunItems)
    await tx.delete(trialMonitorRuns)
    await tx.delete(trialSyncRuns)
    await tx.delete(modelDecisionSnapshots)
    await tx.delete(marketActions)
    await tx.delete(marketRunLogs)
    await tx.delete(marketRuns)
    await tx.delete(marketPriceSnapshots)
    await tx.delete(marketDailySnapshots)
    await tx.delete(marketPositions)
    await tx.delete(predictionMarkets)
    await tx.delete(trialQuestions)
    await tx.delete(trials)
    await tx.execute(sql`
      delete from market_accounts as account
      using market_actors as actor
      where account.actor_id = actor.id
        and actor.actor_type = 'model'
    `)
    await tx.delete(marketActors).where(eq(marketActors.actorType, 'model'))
  })
}

export async function ingestTrials(
  rows: NormalizedTrialInput[],
  options: IngestTrialOptions = {},
): Promise<TrialIngestionSummary> {
  if (options.reset) {
    await resetTrialData()
  }

  await getTrialMonitorConfig()

  if (options.maxMarketsToOpen != null) {
    const parsedMaxMarketsToOpen = Math.round(options.maxMarketsToOpen)
    if (!Number.isFinite(parsedMaxMarketsToOpen) || parsedMaxMarketsToOpen < 0) {
      throw new Error('maxMarketsToOpen must be a non-negative number when provided')
    }
    options.maxMarketsToOpen = parsedMaxMarketsToOpen
  }

  const existingTrialsByNct = options.preserveExistingSponsorTickerOnNull
    ? await loadExistingTrialsByNctNumbers(rows.map((row) => row.nctNumber))
    : new Map<string, typeof trials.$inferSelect>()

  const summary: TrialIngestionSummary = {
    trialsUpserted: 0,
    questionsUpserted: 0,
    marketsOpened: 0,
    changes: [],
  }

  const now = new Date()
  const orderedRows = [...rows].sort((left, right) => compareRowsForMarketOpenPriority(left, right, now))

  for (const row of orderedRows) {
    const existingTrial = existingTrialsByNct.get(row.nctNumber)
    const sponsorTicker = row.sponsorTicker ?? existingTrial?.sponsorTicker ?? null
    const normalizedRow = {
      ...row,
      sponsorTicker,
    }

    let trial: typeof trials.$inferSelect
    if (!existingTrial) {
      [trial] = await db.insert(trials)
        .values({
          nctNumber: row.nctNumber,
          source: 'sync_import',
          shortTitle: row.shortTitle,
          sponsorName: row.sponsorName,
          sponsorTicker,
          indication: row.indication,
          therapeuticArea: row.therapeuticArea,
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
        const [updated] = await db.update(trials)
          .set({
            shortTitle: row.shortTitle,
            sponsorName: row.sponsorName,
            sponsorTicker,
            indication: row.indication,
            therapeuticArea: row.therapeuticArea,
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
          .where(eq(trials.id, existingTrial.id))
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

      // Season 4 sync is question-only. Linked onchain markets are created
      // through manual/admin Season 4 intake.
    }
  }

  return summary
}
