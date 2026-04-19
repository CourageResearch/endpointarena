import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import {
  db,
  marketAccounts,
  marketPositions,
  trials,
  predictionMarkets,
  trialQuestions,
} from '@/lib/db'
import { isModelId, type ModelId } from '@/lib/constants'
import { ValidationError } from '@/lib/errors'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import {
  ensureMarketAccounts,
  ensureMarketPositions,
  normalizeRunDate,
  rotateModelOrder,
} from '@/lib/markets/engine'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { getModelActorIds } from '@/lib/market-actors'
import { filterSupportedTrialQuestions } from '@/lib/trial-questions'
import { getActiveDatabaseTarget } from '@/lib/database-target'

export type OpenTrialMarket = typeof predictionMarkets.$inferSelect & {
  trialQuestionId: string
}

export type TrialQuestionWithTrial = typeof trialQuestions.$inferSelect & {
  trial: typeof trials.$inferSelect
}

export interface DailyRunPreparationOptions {
  nctNumber?: string
  modelIds?: ModelId[]
  marketIds?: string[]
}

export interface DailyRunPlannedMarket {
  marketId: string
  trialQuestionId: string
  trialId: string
  shortTitle: string
  sponsorName: string
  decisionDate: string
}

export interface DailyRunPreparedContext {
  normalizedRunDate: Date
  runDateIso: string
  runtimeConfig: Awaited<ReturnType<typeof getMarketRuntimeConfig>>
  modelOrder: ModelId[]
  scopedNctNumber: string | null
  scopedOpenMarkets: OpenTrialMarket[]
  orderedMarketPlan: DailyRunPlannedMarket[]
  questionById: Map<string, TrialQuestionWithTrial>
  actorIdByModelId: Map<ModelId, string>
  accountByActorId: Map<string, typeof marketAccounts.$inferSelect>
  positionByMarketActorKey: Map<string, typeof marketPositions.$inferSelect>
}

function normalizeScopedNctNumber(value: string): string {
  return value.trim().toUpperCase()
}

function resolveDailyRunModelOrder(runDate: Date, requestedModelIds?: ModelId[]): ModelId[] {
  if (requestedModelIds && requestedModelIds.length > 0) {
    return Array.from(new Set(requestedModelIds))
  }

  const defaultOrder = rotateModelOrder(runDate)
  const rawModelIds = process.env.MARKET_RUN_MODEL_IDS?.trim()
  if (!rawModelIds) {
    return defaultOrder
  }

  const allowedModelIds = Array.from(new Set(
    rawModelIds
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is ModelId => isModelId(value)),
  ))

  if (allowedModelIds.length === 0) {
    throw new Error('MARKET_RUN_MODEL_IDS did not include any valid model ids')
  }

  const allowedModelIdSet = new Set<ModelId>(allowedModelIds)
  const filteredOrder = defaultOrder.filter((modelId) => allowedModelIdSet.has(modelId))
  if (filteredOrder.length === 0) {
    throw new Error('MARKET_RUN_MODEL_IDS did not overlap with the active daily-run model order')
  }

  return filteredOrder
}

function buildPositionKey(marketId: string, actorId: string): string {
  return `${marketId}:${actorId}`
}

export async function prepareDailyRunContext(
  runDate: Date,
  options: DailyRunPreparationOptions = {},
): Promise<DailyRunPreparedContext> {
  if (getActiveDatabaseTarget() !== 'toy') {
    throw new ValidationError('Legacy daily run is toy-only on season 4. Use the season 4 model cycle instead.')
  }

  const normalizedRunDate = normalizeRunDate(runDate)
  const runDateIso = normalizedRunDate.toISOString()
  const modelOrder = resolveDailyRunModelOrder(normalizedRunDate, options.modelIds)
  const scopedNctNumber = options.nctNumber ? normalizeScopedNctNumber(options.nctNumber) : null
  const requestedMarketIds = options.marketIds
    ? Array.from(new Set(options.marketIds.map((value) => value.trim()).filter(Boolean)))
    : null

  const [runtimeConfig, rawOpenMarkets] = await Promise.all([
    getMarketRuntimeConfig(),
    db.query.predictionMarkets.findMany({
      columns: predictionMarketColumns,
      where: and(
        eq(predictionMarkets.status, 'OPEN'),
        isNotNull(predictionMarkets.trialQuestionId),
      ),
    }),
  ])

  const openMarkets = rawOpenMarkets.filter((market): market is OpenTrialMarket => (
    typeof market.trialQuestionId === 'string' && market.trialQuestionId.length > 0
  ))

  const openQuestionIds = Array.from(new Set(openMarkets.map((market) => market.trialQuestionId)))
  const rawOpenQuestions = openQuestionIds.length > 0
    ? await db.query.trialQuestions.findMany({
        where: inArray(trialQuestions.id, openQuestionIds),
        with: {
          trial: true,
        },
      }) as TrialQuestionWithTrial[]
    : []
  const openQuestions = filterSupportedTrialQuestions(rawOpenQuestions)
  const supportedQuestionIds = new Set(openQuestions.map((question) => question.id))
  const supportedOpenMarkets = openMarkets.filter((market) => supportedQuestionIds.has(market.trialQuestionId))
  const questionById = new Map(openQuestions.map((question) => [question.id, question]))

  const orderedOpenMarkets = [...supportedOpenMarkets].sort((a, b) => {
    const aQuestion = questionById.get(a.trialQuestionId)
    const bQuestion = questionById.get(b.trialQuestionId)
    const aDecisionTime = aQuestion?.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bDecisionTime = bQuestion?.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    if (aDecisionTime !== bDecisionTime) return aDecisionTime - bDecisionTime

    const aOpenedTime = a.openedAt?.getTime() ?? 0
    const bOpenedTime = b.openedAt?.getTime() ?? 0
    if (aOpenedTime !== bOpenedTime) return aOpenedTime - bOpenedTime

    return a.id.localeCompare(b.id)
  })

  const filteredByNct = scopedNctNumber
    ? orderedOpenMarkets.filter((market) => questionById.get(market.trialQuestionId)?.trial.nctNumber.toUpperCase() === scopedNctNumber)
    : orderedOpenMarkets

  const scopedOpenMarkets = requestedMarketIds
    ? filteredByNct.filter((market) => requestedMarketIds.includes(market.id))
    : filteredByNct

  if (scopedNctNumber && filteredByNct.length === 0) {
    throw new Error(`No open trial found for ${scopedNctNumber}`)
  }

  if (requestedMarketIds && scopedOpenMarkets.length !== requestedMarketIds.length) {
    const foundIds = new Set(scopedOpenMarkets.map((market) => market.id))
    const missingIds = requestedMarketIds.filter((marketId) => !foundIds.has(marketId))
    throw new Error(`Some imported markets are no longer open: ${missingIds.slice(0, 3).join(', ')}`)
  }

  if (scopedOpenMarkets.length === 0) {
    throw new Error('No open trials matched the selected scope')
  }

  const orderedMarketPlan = scopedOpenMarkets
    .map((market) => {
      const question = questionById.get(market.trialQuestionId)
      if (!question) return null

      return {
        marketId: market.id,
        trialQuestionId: market.trialQuestionId,
        trialId: question.trial.id,
        shortTitle: question.trial.shortTitle,
        sponsorName: question.trial.sponsorName,
        decisionDate: question.trial.estPrimaryCompletionDate.toISOString(),
      } satisfies DailyRunPlannedMarket
    })
    .filter((entry): entry is DailyRunPlannedMarket => entry !== null)

  await ensureMarketAccounts()
  await Promise.all(scopedOpenMarkets.map((market) => ensureMarketPositions(market.id)))
  const actorIdByModelId = await getModelActorIds(modelOrder)

  const actorIds = Array.from(new Set(Array.from(actorIdByModelId.values())))
  const [accounts, positions] = await Promise.all([
    actorIds.length === 0
      ? []
      : db.query.marketAccounts.findMany({
          where: inArray(marketAccounts.actorId, actorIds),
        }),
    actorIds.length === 0 || scopedOpenMarkets.length === 0
      ? []
      : db.query.marketPositions.findMany({
          where: and(
            inArray(marketPositions.actorId, actorIds),
            inArray(marketPositions.marketId, scopedOpenMarkets.map((market) => market.id)),
          ),
        }),
  ])

  const accountByActorId = new Map(accounts.map((account) => [account.actorId, account]))
  const positionByMarketActorKey = new Map(
    positions.map((position) => [buildPositionKey(position.marketId, position.actorId), position]),
  )

  return {
    normalizedRunDate,
    runDateIso,
    runtimeConfig,
    modelOrder,
    scopedNctNumber,
    scopedOpenMarkets,
    orderedMarketPlan,
    questionById,
    actorIdByModelId,
    accountByActorId,
    positionByMarketActorKey,
  }
}

export function getDailyRunPositionKey(marketId: string, actorId: string): string {
  return buildPositionKey(marketId, actorId)
}
