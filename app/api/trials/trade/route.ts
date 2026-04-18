import { and, eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  createRequestId,
  errorResponse,
  parseOptionalJsonBody,
  successResponse,
} from '@/lib/api-response'
import { db, marketAccounts, marketPositions, predictionMarkets } from '@/lib/db'
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors'
import { runBuyAction, runSellAction } from '@/lib/markets/engine'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import { ensureHumanTradingAccount, getCanonicalHumanStartingCash } from '@/lib/human-cash'

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

function buildDefaultExplanation(side: TradeSide): string {
  const label = side.replace('_', ' ').toLowerCase()
  return `Human trader manual ${label}`
}

async function requireAuthenticatedUserId(): Promise<string> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id?.trim()
  if (!userId) {
    throw new UnauthorizedError('Please sign in first')
  }
  return userId
}

async function ensureHumanTraderState(actorId: string, marketId: string): Promise<void> {
  await db.insert(marketPositions)
    .values({
      marketId,
      actorId,
    })
    .onConflictDoNothing({ target: [marketPositions.marketId, marketPositions.actorId] })
}

async function getTraderSnapshot(actorId: string, marketId: string): Promise<{
  cashBalance: number
  yesShares: number
  noShares: number
}> {
  const [account, position] = await Promise.all([
    db.query.marketAccounts.findFirst({
      where: eq(marketAccounts.actorId, actorId),
    }),
    db.query.marketPositions.findFirst({
      where: and(
        eq(marketPositions.marketId, marketId),
        eq(marketPositions.actorId, actorId),
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

function isMarketClosedToTrading(market: {
  status: string
  trialQuestion?: { outcome: string } | null
}): boolean {
  return market.status !== 'OPEN' || market.trialQuestion?.outcome !== 'Pending'
}

export async function GET(request: Request) {
  const requestId = createRequestId()

  try {
    const userId = await requireAuthenticatedUserId()

    const marketId = parseMarketId(new URL(request.url).searchParams.get('marketId'))
    if (!marketId) {
      throw new ValidationError('marketId is required')
    }

    const market = await db.query.predictionMarkets.findFirst({
      columns: predictionMarketColumns,
      where: eq(predictionMarkets.id, marketId),
      with: {
        trialQuestion: {
          columns: {
            outcome: true,
          },
        },
      },
    })

    if (!market) {
      throw new NotFoundError('Market not found')
    }

    if (isMarketClosedToTrading(market)) {
      throw new ConflictError('This market is no longer open')
    }

    const { actor } = await ensureHumanTradingAccount({
      userId,
      startingCash: getCanonicalHumanStartingCash(),
    })
    const actorId = actor.id
    await ensureHumanTraderState(actorId, market.id)
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
      columns: predictionMarketColumns,
      where: eq(predictionMarkets.id, marketId),
      with: {
        trialQuestion: {
          columns: {
            outcome: true,
          },
        },
      },
    })

    if (!market) {
      throw new NotFoundError('Market not found')
    }

    if (isMarketClosedToTrading(market)) {
      throw new ConflictError('This market is no longer open')
    }

    const { actor } = await ensureHumanTradingAccount({
      userId,
      startingCash: getCanonicalHumanStartingCash(),
    })
    const actorId = actor.id
    await ensureHumanTraderState(actorId, market.id)

    const beforeSnapshot = await getTraderSnapshot(actorId, market.id)
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
          actorId,
          runDate,
          side,
          requestedUsd: amountUsd,
          explanation,
          actionSource: 'human',
        })
      : await runSellAction({
          market,
          actorId,
          runDate,
          side,
          requestedUsd: amountUsd,
          explanation,
          actionSource: 'human',
        })

    const traderState = await getTraderSnapshot(actorId, market.id)

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
      trader: traderState,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to execute trade')
  }
}
