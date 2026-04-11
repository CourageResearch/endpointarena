import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { isModelId, type ModelId } from '@/lib/constants'
import { db, marketActions, marketAccounts, marketActors, marketPositions, predictionMarkets, trialQuestions } from '@/lib/db'
import { filterSupportedTrialQuestions } from '@/lib/trial-questions'

type AccountWithActor = typeof marketAccounts.$inferSelect & { actor: typeof marketActors.$inferSelect }
type PositionWithActor = typeof marketPositions.$inferSelect & { actor: typeof marketActors.$inferSelect }
type MarketActionWithActor = typeof marketActions.$inferSelect & { actor: typeof marketActors.$inferSelect }
type OpenMarket = Pick<
  typeof predictionMarkets.$inferSelect,
  'id' | 'trialQuestionId' | 'status' | 'openingProbability' | 'b' | 'priceYes' | 'openedAt' | 'resolvedAt' | 'resolvedOutcome'
>
type PortfolioValuedMarket = Pick<typeof predictionMarkets.$inferSelect, 'id' | 'priceYes'>

const openMarketColumns = {
  id: true,
  trialQuestionId: true,
  status: true,
  openingProbability: true,
  b: true,
  priceYes: true,
  openedAt: true,
  resolvedAt: true,
  resolvedOutcome: true,
} as const

const portfolioMarketColumns = {
  id: true,
  priceYes: true,
} as const

export function toModelId(value: string | null | undefined): ModelId | null {
  return isModelId(value) ? value : null
}

export function buildMarketActorKey(marketId: string, actorId: string): string {
  return `${marketId}:${actorId}`
}

function buildActorAccountMaps(accounts: AccountWithActor[]): {
  byActorId: Map<string, AccountWithActor>
  byModelKey: Map<ModelId, AccountWithActor>
  byUserId: Map<string, AccountWithActor>
} {
  const byActorId = new Map<string, AccountWithActor>()
  const byModelKey = new Map<ModelId, AccountWithActor>()
  const byUserId = new Map<string, AccountWithActor>()

  for (const account of accounts) {
    byActorId.set(account.actorId, account)

    const modelId = toModelId(account.actor.modelKey)
    if (modelId) {
      byModelKey.set(modelId, account)
    }

    if (account.actor.userId) {
      byUserId.set(account.actor.userId, account)
    }
  }

  return {
    byActorId,
    byModelKey,
    byUserId,
  }
}

function buildPositionsByMarketActor(positions: PositionWithActor[]): Map<string, PositionWithActor> {
  const positionsByMarketActor = new Map<string, PositionWithActor>()
  for (const position of positions) {
    positionsByMarketActor.set(buildMarketActorKey(position.marketId, position.actorId), position)
  }
  return positionsByMarketActor
}

export function buildLatestModelActionByMarketActor(actions: MarketActionWithActor[]): Map<string, MarketActionWithActor> {
  const latestModelActionByMarketActor = new Map<string, MarketActionWithActor>()
  for (const action of actions) {
    const key = buildMarketActorKey(action.marketId, action.actorId)
    if (!latestModelActionByMarketActor.has(key)) {
      latestModelActionByMarketActor.set(key, action)
    }
  }
  return latestModelActionByMarketActor
}

function buildPositionsValueByActorId(args: {
  positions: PositionWithActor[]
  marketById: Map<string, Pick<typeof predictionMarkets.$inferSelect, 'id' | 'priceYes'>>
}): Map<string, number> {
  const positionsValueByActorId = new Map<string, number>()

  for (const position of args.positions) {
    const market = args.marketById.get(position.marketId)
    if (!market) continue

    const markedValue = (position.yesShares * market.priceYes) + (position.noShares * (1 - market.priceYes))
    positionsValueByActorId.set(
      position.actorId,
      (positionsValueByActorId.get(position.actorId) ?? 0) + markedValue,
    )
  }

  return positionsValueByActorId
}

export async function loadOpenMarketActorState(input: {
  includeMarketIds?: string[]
  includeResolved?: boolean
  includePortfolioValues?: boolean
} = {}): Promise<{
  accounts: AccountWithActor[]
  openMarkets: OpenMarket[]
  openMarketIds: string[]
  marketById: Map<string, OpenMarket>
  positions: PositionWithActor[]
  accountMaps: ReturnType<typeof buildActorAccountMaps>
  positionsByMarketActor: Map<string, PositionWithActor>
  positionsValueByActorId: Map<string, number>
  portfolioPositionsValueByActorId: Map<string, number>
}> {
  const includeMarketIds = Array.from(new Set(
    (input.includeMarketIds ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0),
  ))
  const includeResolved = input.includeResolved === true
  const includePortfolioValues = input.includePortfolioValues !== false

  const marketWhere = includeMarketIds.length > 0
    ? and(
        isNotNull(predictionMarkets.trialQuestionId),
        or(
          includeResolved
            ? or(eq(predictionMarkets.status, 'OPEN'), eq(predictionMarkets.status, 'RESOLVED'))
            : eq(predictionMarkets.status, 'OPEN'),
          inArray(predictionMarkets.id, includeMarketIds),
        ),
      )
    : and(
        includeResolved
          ? or(eq(predictionMarkets.status, 'OPEN'), eq(predictionMarkets.status, 'RESOLVED'))
          : eq(predictionMarkets.status, 'OPEN'),
        isNotNull(predictionMarkets.trialQuestionId),
      )

  const emptyMarkets: OpenMarket[] = []
  const emptyPortfolioMarkets: PortfolioValuedMarket[] = []
  const emptyPositions: PositionWithActor[] = []
  const [accounts, rawVisibleMarkets, allOpenMarkets] = await Promise.all([
    db.query.marketAccounts.findMany({
      with: {
        actor: true,
      },
    }),
    db.query.predictionMarkets.findMany({
      columns: openMarketColumns,
      where: marketWhere,
    }),
    includePortfolioValues
      ? db.query.predictionMarkets.findMany({
          columns: portfolioMarketColumns,
          where: eq(predictionMarkets.status, 'OPEN'),
        })
      : Promise.resolve(emptyPortfolioMarkets),
  ])

  const questionIds = Array.from(new Set(
    rawVisibleMarkets
      .map((market) => market.trialQuestionId)
      .filter((value): value is string => Boolean(value)),
  ))
  const supportedQuestionIds = new Set(
    questionIds.length > 0
      ? filterSupportedTrialQuestions(await db.query.trialQuestions.findMany({
          where: inArray(trialQuestions.id, questionIds),
          columns: {
            id: true,
            slug: true,
          },
        })).map((question) => question.id)
      : [],
  )
  const openMarkets = rawVisibleMarkets.filter((market) => (
    typeof market.trialQuestionId === 'string' && supportedQuestionIds.has(market.trialQuestionId)
  ))
  const actuallyOpenMarkets = openMarkets.filter((market) => market.status === 'OPEN')

  const openMarketIds = openMarkets.map((market) => market.id)
  const allOpenMarketIds = allOpenMarkets.map((market) => market.id)
  const [positions, allOpenPositions] = await Promise.all([
    openMarketIds.length > 0
      ? db.query.marketPositions.findMany({
          where: inArray(marketPositions.marketId, openMarketIds),
        with: {
          actor: true,
        },
      })
      : Promise.resolve(emptyPositions),
    includePortfolioValues && allOpenMarketIds.length > 0
      ? db.query.marketPositions.findMany({
          where: inArray(marketPositions.marketId, allOpenMarketIds),
          with: {
            actor: true,
          },
        })
      : Promise.resolve(emptyPositions),
  ])

  const marketById = new Map(openMarkets.map((market) => [market.id, market]))
  const actuallyOpenMarketById = new Map(actuallyOpenMarkets.map((market) => [market.id, market]))
  const allOpenMarketById = new Map(allOpenMarkets.map((market) => [market.id, market]))

  return {
    accounts,
    openMarkets,
    openMarketIds,
    marketById,
    positions,
    accountMaps: buildActorAccountMaps(accounts),
    positionsByMarketActor: buildPositionsByMarketActor(positions),
    positionsValueByActorId: buildPositionsValueByActorId({
      positions,
      marketById: actuallyOpenMarketById,
    }),
    portfolioPositionsValueByActorId: includePortfolioValues
      ? buildPositionsValueByActorId({
          positions: allOpenPositions,
          marketById: allOpenMarketById,
        })
      : new Map<string, number>(),
  }
}
