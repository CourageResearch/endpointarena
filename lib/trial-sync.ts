import { and, desc, eq, inArray } from 'drizzle-orm'
import { trials, db, trialSyncRunItems, trialSyncRuns } from '@/lib/db'
import { ExternalServiceError } from '@/lib/errors'
import {
  buildClinicalTrialsIncrementalQueryTerm,
  buildClinicalTrialsReconcileQueryTerm,
  type ClinicalTrialsGovStudy,
  fetchClinicalTrialsStudies,
  fetchClinicalTrialsVersion,
  getClinicalTrialsLeadSponsorName,
  getClinicalTrialsLastUpdatePostDate,
  getClinicalTrialsNctNumber,
  isClinicalTrialsActiveStatusStudy,
  isClinicalTrialsBaseUniverseStudy,
  isClinicalTrialsStudyOnOrAfterDate,
  isClinicalTrialsStudyInRollingWindow,
  mapClinicalTrialsStudyToTrialInput,
  normalizeClinicalTrialsSponsorKey,
  parseClinicalTrialsDate,
  toUtcDayStart,
} from '@/lib/clinicaltrials-gov'
import { ingestTrials } from '@/lib/trial-ingestion'
import { getTrialSyncConfig, updateTrialSyncConfig } from '@/lib/trial-sync-config'

const EXISTING_TRIAL_LOOKUP_CHUNK_SIZE = 500

export type TrialSyncMode = 'incremental' | 'reconcile'
type TrialSyncTriggerSource = 'cron' | 'manual'
type TrialSyncRunStatus = 'running' | 'completed' | 'failed' | 'skipped'

export type TrialSyncRunResult = {
  executed: boolean
  reason?: 'disabled' | 'not_due' | 'up_to_date'
  runId?: string
  mode?: TrialSyncMode
  sourceDataTimestamp?: string | null
  studiesFetched: number
  studiesMatched: number
  trialsUpserted: number
  questionsUpserted: number
  marketsOpened: number
}

export type TrialSyncPreloadedSource = {
  completionSinceDate?: string | null
  sourceDataTimestamp?: string | null
  sponsorMappings?: Record<string, {
    decision: 'allow' | 'skip' | null
    sponsorName: string
    sponsorTicker: string | null
  }>
  studies: ClinicalTrialsGovStudy[]
}

type TrialSyncInput = {
  triggerSource: TrialSyncTriggerSource
  force?: boolean
  maxMarketsToOpen?: number
  mode?: TrialSyncMode | 'auto'
  preloadedSource?: TrialSyncPreloadedSource
}

function addHours(value: Date, hours: number) {
  return new Date(value.getTime() + (hours * 60 * 60 * 1000))
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + (days * 24 * 60 * 60 * 1000))
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function getLatestCompletedRun(mode?: TrialSyncMode) {
  return db.query.trialSyncRuns.findFirst({
    where: mode
      ? and(eq(trialSyncRuns.status, 'completed'), eq(trialSyncRuns.mode, mode))
      : eq(trialSyncRuns.status, 'completed'),
    orderBy: [desc(trialSyncRuns.startedAt)],
  })
}

async function startRun(mode: TrialSyncMode, triggerSource: TrialSyncTriggerSource, sourceDataTimestamp: string | null | undefined) {
  const [run] = await db.insert(trialSyncRuns)
    .values({
      mode,
      triggerSource,
      status: 'running',
      sourceDataTimestamp: sourceDataTimestamp ?? null,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  return run
}

async function finishRun(
  runId: string,
  status: Exclude<TrialSyncRunStatus, 'running'>,
  input: Partial<{
    sourceDataTimestamp: string | null
    studiesFetched: number
    studiesMatched: number
    trialsUpserted: number
    questionsUpserted: number
    marketsOpened: number
    errorSummary: string | null
  }> = {},
) {
  await db.update(trialSyncRuns)
    .set({
      status,
      sourceDataTimestamp: input.sourceDataTimestamp,
      studiesFetched: input.studiesFetched,
      studiesMatched: input.studiesMatched,
      trialsUpserted: input.trialsUpserted,
      questionsUpserted: input.questionsUpserted,
      marketsOpened: input.marketsOpened,
      errorSummary: input.errorSummary,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(trialSyncRuns.id, runId))
}

async function loadExistingNctNumbers(nctNumbers: string[]) {
  if (nctNumbers.length === 0) {
    return new Set<string>()
  }

  const rows = await Promise.all(
    chunkArray(Array.from(new Set(nctNumbers)), EXISTING_TRIAL_LOOKUP_CHUNK_SIZE).map((chunk) => (
      db.query.trials.findMany({
        where: inArray(trials.nctNumber, chunk),
        columns: {
          nctNumber: true,
        },
      })
    )),
  )

  return new Set(rows.flat().map((row) => row.nctNumber))
}

function toErrorSummary(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function computeMaxLastUpdatePostDate(studies: Awaited<ReturnType<typeof fetchClinicalTrialsStudies>>['studies']) {
  let latest: Date | null = null

  for (const study of studies) {
    const value = getClinicalTrialsLastUpdatePostDate(study)
    if (!value) continue
    if (!latest || value.getTime() > latest.getTime()) {
      latest = value
    }
  }

  return latest
}

async function chooseMode(input: TrialSyncInput, sourceDataTimestamp: string | null) {
  const config = await getTrialSyncConfig()
  const now = new Date()

  if (!config.enabled && !input.force) {
    return { config, decision: { execute: false as const, reason: 'disabled' as const } }
  }

  const latestCompletedRun = await getLatestCompletedRun()
  const latestCompletedReconcileRun = await getLatestCompletedRun('reconcile')
  const requestedMode = input.mode ?? 'auto'

  const reconcileDue = !latestCompletedReconcileRun
    || latestCompletedReconcileRun.startedAt.getTime() < addHours(now, -config.reconcileIntervalHours).getTime()
  const syncDue = !latestCompletedRun
    || latestCompletedRun.startedAt.getTime() < addHours(now, -config.syncIntervalHours).getTime()
  const hasNewSourceSnapshot = Boolean(sourceDataTimestamp && sourceDataTimestamp !== config.lastSuccessfulDataTimestamp)

  if (input.force) {
    if (requestedMode === 'auto') {
      return {
        config,
        decision: {
          execute: true as const,
          mode: config.lastSuccessfulUpdatePostDate ? 'incremental' as const : 'reconcile' as const,
        },
      }
    }
    return {
      config,
      decision: {
        execute: true as const,
        mode: requestedMode,
      },
    }
  }

  if (requestedMode === 'reconcile') {
    if (reconcileDue) {
      return { config, decision: { execute: true as const, mode: 'reconcile' as const } }
    }
    return { config, decision: { execute: false as const, reason: 'not_due' as const } }
  }

  if (requestedMode === 'incremental') {
    if (!config.lastSuccessfulUpdatePostDate) {
      return { config, decision: { execute: true as const, mode: 'reconcile' as const } }
    }
    if (hasNewSourceSnapshot || syncDue) {
      return { config, decision: { execute: true as const, mode: 'incremental' as const } }
    }
    return {
      config,
      decision: {
        execute: false as const,
        reason: sourceDataTimestamp === config.lastSuccessfulDataTimestamp ? 'up_to_date' as const : 'not_due' as const,
      },
    }
  }

  if (!config.lastSuccessfulUpdatePostDate || reconcileDue) {
    return { config, decision: { execute: true as const, mode: 'reconcile' as const } }
  }
  if (hasNewSourceSnapshot || syncDue) {
    return { config, decision: { execute: true as const, mode: 'incremental' as const } }
  }

  return {
    config,
    decision: {
      execute: false as const,
      reason: sourceDataTimestamp === config.lastSuccessfulDataTimestamp ? 'up_to_date' as const : 'not_due' as const,
    },
  }
}

export async function runTrialSync(input: TrialSyncInput): Promise<TrialSyncRunResult> {
  let sourceDataTimestamp: string | null = input.preloadedSource?.sourceDataTimestamp?.trim() || null

  if (!input.preloadedSource) {
    try {
      const version = await fetchClinicalTrialsVersion()
      sourceDataTimestamp = version.dataTimestamp?.trim() || null
    } catch (error) {
      throw new ExternalServiceError('Failed to load ClinicalTrials.gov API version metadata', {
        cause: error,
      })
    }
  }

  const { config, decision } = await chooseMode(input, sourceDataTimestamp)
  if (!decision.execute) {
    return {
      executed: false,
      reason: decision.reason,
      studiesFetched: 0,
      studiesMatched: 0,
      trialsUpserted: 0,
      questionsUpserted: 0,
      marketsOpened: 0,
      sourceDataTimestamp,
    }
  }

  const mode = decision.mode
  const run = await startRun(mode, input.triggerSource, sourceDataTimestamp)

  try {
    const now = new Date()
    const cutoffDate = addDays(toUtcDayStart(now), -config.recentCompletionLookbackDays)
    const preloadedCompletionSinceDate = parseClinicalTrialsDate(input.preloadedSource?.completionSinceDate)
    if (input.preloadedSource?.completionSinceDate && !preloadedCompletionSinceDate) {
      throw new Error(`Invalid completionSinceDate in preloaded source: ${input.preloadedSource.completionSinceDate}`)
    }
    const matchStartDate = preloadedCompletionSinceDate ?? cutoffDate
    const sourceResult = input.preloadedSource
      ? {
          totalCount: input.preloadedSource.studies.length,
          studies: input.preloadedSource.studies,
        }
      : mode === 'reconcile'
        ? await fetchClinicalTrialsStudies({
            queryTerm: buildClinicalTrialsReconcileQueryTerm(cutoffDate),
          })
        : await fetchClinicalTrialsStudies({
            queryTerm: buildClinicalTrialsIncrementalQueryTerm(config.lastSuccessfulUpdatePostDate ?? cutoffDate),
          })

    const rawStudies = sourceResult.studies
    const existingNctNumbers = await loadExistingNctNumbers(
      rawStudies
        .map((study) => getClinicalTrialsNctNumber(study))
        .filter((value): value is string => Boolean(value)),
    )

    const matchedStudies = rawStudies.filter((study) => {
      const nctNumber = getClinicalTrialsNctNumber(study)
      if (!nctNumber) return false

      if (mode === 'reconcile') {
        return isClinicalTrialsBaseUniverseStudy(study)
          && isClinicalTrialsActiveStatusStudy(study)
          && (
            preloadedCompletionSinceDate
              ? isClinicalTrialsStudyOnOrAfterDate(study, matchStartDate)
              : isClinicalTrialsStudyInRollingWindow(study, config.recentCompletionLookbackDays, now)
          )
      }

      if (existingNctNumbers.has(nctNumber)) {
        return true
      }

      return isClinicalTrialsBaseUniverseStudy(study)
        && isClinicalTrialsActiveStatusStudy(study)
        && (
          preloadedCompletionSinceDate
            ? isClinicalTrialsStudyOnOrAfterDate(study, matchStartDate)
            : isClinicalTrialsStudyInRollingWindow(study, config.recentCompletionLookbackDays, now)
        )
    })

    const sponsorMappings = input.preloadedSource?.sponsorMappings
    const sponsorOverridesByNct = new Map<string, {
      sponsorName: string
      sponsorTicker: string | null
    }>()
    let studiesToNormalize = matchedStudies

    if (sponsorMappings) {
      const unresolvedSponsors = new Set<string>()

      studiesToNormalize = matchedStudies.filter((study) => {
        const sponsorName = getClinicalTrialsLeadSponsorName(study)
        const sponsorKey = sponsorName ? normalizeClinicalTrialsSponsorKey(sponsorName) : ''
        const mapping = sponsorKey ? sponsorMappings[sponsorKey] : undefined

        if (!mapping || mapping.decision === null) {
          unresolvedSponsors.add(sponsorName ?? '(missing sponsor name)')
          return false
        }

        if (mapping.decision === 'skip') {
          return false
        }

        const nctNumber = getClinicalTrialsNctNumber(study)
        if (nctNumber) {
          sponsorOverridesByNct.set(nctNumber, {
            sponsorName: mapping.sponsorName,
            sponsorTicker: mapping.sponsorTicker,
          })
        }

        return true
      })

      if (unresolvedSponsors.size > 0) {
        const sampleSponsors = Array.from(unresolvedSponsors).sort().slice(0, 10)
        throw new Error(
          `Sponsor map is missing allow/skip decisions for ${unresolvedSponsors.size} sponsor(s): ${sampleSponsors.join(', ')}`,
        )
      }
    }

    const normalizedRows = studiesToNormalize
      .map((study) => mapClinicalTrialsStudyToTrialInput(
        study,
        (() => {
          const nctNumber = getClinicalTrialsNctNumber(study)
          return nctNumber ? sponsorOverridesByNct.get(nctNumber) : undefined
        })(),
      ))
      .filter((row): row is NonNullable<typeof row> => row !== null)

    const ingestionSummary = await ingestTrials(normalizedRows, {
      maxMarketsToOpen: input.maxMarketsToOpen,
      preserveExistingSponsorTickerOnNull: true,
    })

    const lastSuccessfulUpdatePostDate = computeMaxLastUpdatePostDate(rawStudies) ?? config.lastSuccessfulUpdatePostDate

    await persistRunItems(run.id, ingestionSummary.changes)

    await updateTrialSyncConfig({
      lastSuccessfulUpdatePostDate,
      lastSuccessfulDataTimestamp: sourceDataTimestamp,
    })

    await finishRun(run.id, 'completed', {
      sourceDataTimestamp,
      studiesFetched: rawStudies.length,
      studiesMatched: studiesToNormalize.length,
      trialsUpserted: ingestionSummary.trialsUpserted,
      questionsUpserted: ingestionSummary.questionsUpserted,
      marketsOpened: ingestionSummary.marketsOpened,
      errorSummary: null,
    })

    return {
      executed: true,
      runId: run.id,
      mode,
      sourceDataTimestamp,
      studiesFetched: rawStudies.length,
      studiesMatched: studiesToNormalize.length,
      trialsUpserted: ingestionSummary.trialsUpserted,
      questionsUpserted: ingestionSummary.questionsUpserted,
      marketsOpened: ingestionSummary.marketsOpened,
    }
  } catch (error) {
    await finishRun(run.id, 'failed', {
      sourceDataTimestamp,
      errorSummary: toErrorSummary(error),
    })
    throw error
  }
}

async function persistRunItems(
  runId: string,
  items: Array<{
    changeType: 'inserted' | 'updated'
    trialId: string
    nctNumber: string
    shortTitle: string
    sponsorName: string
    currentStatus: string
    estPrimaryCompletionDate: Date
    changeSummary: string | null
  }>,
) {
  if (items.length === 0) return

  await db.insert(trialSyncRunItems).values(items.map((item) => ({
    runId,
    trialId: item.trialId,
    nctNumber: item.nctNumber,
    shortTitle: item.shortTitle,
    sponsorName: item.sponsorName,
    currentStatus: item.currentStatus,
    estPrimaryCompletionDate: item.estPrimaryCompletionDate,
    changeType: item.changeType,
    changeSummary: item.changeSummary,
    createdAt: new Date(),
  })))
}
