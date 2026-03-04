import { and, eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import type { ModelId } from '@/lib/constants'
import { authOptions } from '@/lib/auth'
import {
  createRequestId,
  errorResponse,
  parseOptionalJsonBody,
  successResponse,
} from '@/lib/api-response'
import { db, marketAccounts, marketPositions, predictionMarkets, users } from '@/lib/db'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors'
import { runBuyAction, runSellAction } from '@/lib/markets/engine'
import { getTwitterVerificationStatusForUser } from '@/lib/twitter-status'

type TradeSide = 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO'

type TradeRequest = {
  marketId?: string
  side?: TradeSide
  amountUsd?: number
  explanation?: string
}

function parseMarketId(input: string | null | undefined): string {
  if (typeof input !== 'string') return ''
  return input.trim()
}

function parseTradeAmount(input: unknown): number {
  if (typeof input === 'number') return input
  if (typeof input === 'string') return Number.parseFloat(input)
  return Number.NaN
}

function parseTradeSide(input: unknown): TradeSide | null {
  if (input === 'BUY_YES' || input === 'BUY_NO' || input === 'SELL_YES' || input === 'SELL_NO') {
    return input
  }
  return null
}

function getHumanActorId(userId: string): string {
  return `human:${userId}`
}

function toEngineModelId(actorId: string): ModelId {
  return actorId as unknown as ModelId
}

function buildDefaultExplanation(side: TradeSide): string {
  const label = side.replace('_', ' ').toLowerCase()
  return `Human trader manual ${label}`
}

function normalizePointsBalance(input: number): number {
  if (!Number.isFinite(input)) return 0
  return Math.max(0, Math.round(input))
}

async function requireAuthenticatedUserId(): Promise<string> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id?.trim()
  if (!userId) {
    throw new UnauthorizedError('Please sign in first')
  }
  return userId
}

async function requireVerifiedTrader(userId: string): Promise<void> {
  const status = await getTwitterVerificationStatusForUser(userId)
  if (!status?.verified) {
    throw new ForbiddenError('Complete X verification before trading')
  }
}

async function getUserPointsBalance(userId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      pointsBalance: true,
    },
  })

  if (!user) {
    throw new UnauthorizedError('User account not found')
  }

  return normalizePointsBalance(user.pointsBalance)
}

async function ensureHumanTraderState(
  actorId: string,
  marketId: string,
  initialCashBalance: number,
): Promise<void> {
  await db.insert(marketAccounts)
    .values({
      modelId: actorId,
      startingCash: initialCashBalance,
      cashBalance: initialCashBalance,
    })
    .onConflictDoNothing({ target: marketAccounts.modelId })

  await db.insert(marketPositions)
    .values({
      marketId,
      modelId: actorId,
    })
    .onConflictDoNothing({ target: [marketPositions.marketId, marketPositions.modelId] })
}

async function syncHumanTraderCashWithPoints(actorId: string, pointsBalance: number): Promise<void> {
  await db.update(marketAccounts)
    .set({
      cashBalance: pointsBalance,
      updatedAt: new Date(),
    })
    .where(eq(marketAccounts.modelId, actorId))
}

async function persistPointsBalance(userId: string, nextBalance: number): Promise<number> {
  const normalizedBalance = normalizePointsBalance(nextBalance)
  const [updated] = await db.update(users)
    .set({
      pointsBalance: normalizedBalance,
    })
    .where(eq(users.id, userId))
    .returning({
      pointsBalance: users.pointsBalance,
    })

  if (!updated) {
    throw new UnauthorizedError('User account not found')
  }

  return normalizePointsBalance(updated.pointsBalance)
}

async function getTraderSnapshot(actorId: string, marketId: string): Promise<{
  cashBalance: number
  yesShares: number
  noShares: number
}> {
  const [account, position] = await Promise.all([
    db.query.marketAccounts.findFirst({
      where: eq(marketAccounts.modelId, actorId),
    }),
    db.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, marketId),
        eq(marketPositions.modelId, actorId),
      ),
    }),
  ])

  if (!account || !position) {
    throw new ValidationError('Trader account state is not initialized')
  }

  return {
    cashBalance: account.cashBalance,
    yesShares: position.yesShares,
    noShares: position.noShares,
  }
}

export async function GET(request: Request) {
  const requestId = createRequestId()

  try {
    const userId = await requireAuthenticatedUserId()
    await requireVerifiedTrader(userId)

    const marketId = parseMarketId(new URL(request.url).searchParams.get('marketId'))
    if (!marketId) {
      throw new ValidationError('marketId is required')
    }

    const market = await db.query.predictionMarkets.findFirst({
      where: eq(predictionMarkets.id, marketId),
    })

    if (!market) {
      throw new NotFoundError('Market not found')
    }

    const actorId = getHumanActorId(userId)
    const pointsBalance = await getUserPointsBalance(userId)
    await ensureHumanTraderState(actorId, market.id, pointsBalance)
    await syncHumanTraderCashWithPoints(actorId, pointsBalance)
    const snapshot = await getTraderSnapshot(actorId, market.id)

    return successResponse({
      success: true,
      marketId: market.id,
      marketStatus: market.status,
      actorId,
      ...snapshot,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load trader state')
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const userId = await requireAuthenticatedUserId()
    await requireVerifiedTrader(userId)

    const body = await parseOptionalJsonBody<TradeRequest>(request, {})
    const marketId = parseMarketId(body.marketId)
    const side = parseTradeSide(body.side)
    const amountUsd = parseTradeAmount(body.amountUsd)
    const explanation = typeof body.explanation === 'string' && body.explanation.trim()
      ? body.explanation.trim().slice(0, 600)
      : buildDefaultExplanation(side ?? 'BUY_YES')

    if (!marketId) {
      throw new ValidationError('marketId is required')
    }

    if (!side) {
      throw new ValidationError('side must be one of BUY_YES, BUY_NO, SELL_YES, SELL_NO')
    }

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new ValidationError('amountUsd must be a positive number')
    }

    if (amountUsd > 1_000_000) {
      throw new ValidationError('amountUsd is too large')
    }

    const market = await db.query.predictionMarkets.findFirst({
      where: eq(predictionMarkets.id, marketId),
    })

    if (!market) {
      throw new NotFoundError('Market not found')
    }

    if (market.status !== 'OPEN') {
      throw new ConflictError('This market is no longer open')
    }

    const actorId = getHumanActorId(userId)
    const pointsBalance = await getUserPointsBalance(userId)
    await ensureHumanTraderState(actorId, market.id, pointsBalance)
    await syncHumanTraderCashWithPoints(actorId, pointsBalance)

    const beforeSnapshot = await getTraderSnapshot(actorId, market.id)
    const engineModelId = toEngineModelId(actorId)
    const runDate = new Date()

    if ((side === 'BUY_YES' || side === 'BUY_NO') && beforeSnapshot.cashBalance <= 0) {
      throw new ValidationError('Insufficient cash balance')
    }

    if ((side === 'SELL_YES' || side === 'SELL_NO')) {
      const heldShares = side === 'SELL_YES' ? beforeSnapshot.yesShares : beforeSnapshot.noShares
      if (heldShares <= 0) {
        throw new ValidationError(`No ${side === 'SELL_YES' ? 'YES' : 'NO'} shares available to sell`)
      }
    }

    const result = side === 'BUY_YES' || side === 'BUY_NO'
      ? await runBuyAction({
          market,
          modelId: engineModelId,
          runDate,
          side,
          requestedUsd: amountUsd,
          explanation,
        })
      : await runSellAction({
          market,
          modelId: engineModelId,
          runDate,
          side,
          requestedUsd: amountUsd,
          explanation,
        })

    const traderState = await getTraderSnapshot(actorId, market.id)
    const syncedPointsBalance = await persistPointsBalance(userId, traderState.cashBalance)
    await syncHumanTraderCashWithPoints(actorId, syncedPointsBalance)
    const syncedTraderState = await getTraderSnapshot(actorId, market.id)

    return successResponse({
      success: true,
      marketId: market.id,
      actorId,
      side,
      requestedUsd: amountUsd,
      executedUsd: 'spent' in result ? result.spent : result.proceeds,
      sharesDelta: 'spent' in result ? result.shares : -result.shares,
      priceBefore: result.priceBefore,
      priceAfter: result.priceAfter,
      trader: syncedTraderState,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to execute trade')
  }
}
