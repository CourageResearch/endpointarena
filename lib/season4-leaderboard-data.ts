import { desc, eq, inArray } from 'drizzle-orm'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { db } from '@/lib/db'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { getGeneratedDisplayName, normalizeDisplayName } from '@/lib/display-name'
import { PREDICTION_MARKET_MANAGER_ABI } from '@/lib/onchain/abi'
import { getSeason4OnchainConfig } from '@/lib/onchain/config'
import { syncSeason4OnchainIndex } from '@/lib/onchain/indexer'
import {
  onchainBalances,
  onchainMarkets,
  onchainModelWallets,
  onchainUserWallets,
  users,
} from '@/lib/schema'

export interface Season4ModelLeaderboardEntry {
  id: ModelId
  correct: number
  wrong: number
  pending: number
  decided: number
  total: number
  accuracy: number
  avgConfidence: number
  avgConfidenceCorrect: number
  avgConfidenceWrong: number
  totalEquity: number | null
  pnl: number | null
}

export interface Season4HumanLeaderboardEntry {
  userId: string
  displayName: string
  cashBalance: number
  positionsValue: number
  startingCash: number
  totalEquity: number
  pnl: number
}

export type Season4LeaderboardBalanceRow = {
  modelKey: string | null
  userId: string | null
  marketRef: string
  collateralDisplay: number
  yesShares: number
  noShares: number
}

export type Season4LeaderboardMarketRow = {
  marketId: string
  marketSlug: string
  title: string
  status: string
  resolvedOutcome: 'YES' | 'NO' | null
  priceYes: number
  priceNo: number
}

export type Season4LeaderboardModelWalletRow = {
  modelKey: ModelId
  bankrollDisplay: number
  fundingStatus: string
}

type ModelStats = {
  correct: number
  wrong: number
  pending: number
  confidenceSum: number
  confidenceCorrectSum: number
  confidenceWrongSum: number
  total: number
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractMarketId(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  if (trimmed.startsWith('market:')) {
    return trimOrNull(trimmed.slice('market:'.length))
  }
  return trimmed
}

function probabilityFromE18(value: bigint): number {
  return Number(value) / 1e18
}

function deriveConfidencePercent(yesShares: number, noShares: number): number {
  const totalShares = yesShares + noShares
  if (!Number.isFinite(totalShares) || totalShares <= 0) return 0
  const dominance = Math.abs(yesShares - noShares) / totalShares
  return 50 + (dominance * 50)
}

function derivePredictedOutcome(yesShares: number, noShares: number): 'YES' | 'NO' | null {
  if (yesShares > noShares) return 'YES'
  if (noShares > yesShares) return 'NO'
  return null
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

export function buildSeason4ModelLeaderboard(args: {
  modelWallets: Season4LeaderboardModelWalletRow[]
  balanceRows: Season4LeaderboardBalanceRow[]
  markets: Season4LeaderboardMarketRow[]
}): {
  leaderboard: Season4ModelLeaderboardEntry[]
  moneyLeaderboard: Season4ModelLeaderboardEntry[]
} {
  const walletByModel = new Map(args.modelWallets.map((wallet) => [wallet.modelKey, wallet] as const))
  const marketById = new Map(args.markets.map((market) => [market.marketId, market] as const))
  const balancesByModel = new Map<ModelId, Season4LeaderboardBalanceRow[]>()

  for (const row of args.balanceRows) {
    if (!isModelId(row.modelKey)) continue
    const current = balancesByModel.get(row.modelKey) ?? []
    current.push(row)
    balancesByModel.set(row.modelKey, current)
  }

  const leaderboard = MODEL_IDS.map((modelId) => {
    const wallet = walletByModel.get(modelId)
    const rows = balancesByModel.get(modelId) ?? []
    const stats: ModelStats = {
      correct: 0,
      wrong: 0,
      pending: 0,
      confidenceSum: 0,
      confidenceCorrectSum: 0,
      confidenceWrongSum: 0,
      total: 0,
    }

    let collateralBalance = 0
    let positionsValue = 0
    let hasTrackedBalance = false

    for (const row of rows) {
      if (row.marketRef === 'collateral') {
        collateralBalance += row.collateralDisplay ?? 0
        if ((row.collateralDisplay ?? 0) > 0) {
          hasTrackedBalance = true
        }
        continue
      }

      const marketId = extractMarketId(row.marketRef)
      if (!marketId) continue

      const yesShares = row.yesShares ?? 0
      const noShares = row.noShares ?? 0
      const totalShares = yesShares + noShares
      if (totalShares <= 0) continue

      hasTrackedBalance = true

      const market = marketById.get(marketId)
      const priceYes = market?.priceYes ?? 0.5
      const priceNo = market?.priceNo ?? Math.max(0, 1 - priceYes)
      positionsValue += (yesShares * priceYes) + (noShares * priceNo)

      const confidence = deriveConfidencePercent(yesShares, noShares)
      const predictedOutcome = derivePredictedOutcome(yesShares, noShares)
      stats.confidenceSum += confidence
      stats.total += 1

      if (!market?.resolvedOutcome || !predictedOutcome) {
        stats.pending += 1
        continue
      }

      if (predictedOutcome === market.resolvedOutcome) {
        stats.correct += 1
        stats.confidenceCorrectSum += confidence
      } else {
        stats.wrong += 1
        stats.confidenceWrongSum += confidence
      }
    }

    const decided = stats.correct + stats.wrong
    const seededBankroll = wallet?.fundingStatus === 'funded'
      ? (wallet.bankrollDisplay ?? 0)
      : 0
    const trackedEquity = roundMoney(collateralBalance + positionsValue)
    const startingBankroll = seededBankroll
    const totalEquity = hasTrackedBalance ? trackedEquity : seededBankroll
    const pnl = roundMoney(totalEquity - startingBankroll)

    return {
      id: modelId,
      correct: stats.correct,
      wrong: stats.wrong,
      pending: stats.pending,
      decided,
      total: stats.total,
      accuracy: decided > 0 ? (stats.correct / decided) * 100 : 0,
      avgConfidence: stats.total > 0 ? stats.confidenceSum / stats.total : 0,
      avgConfidenceCorrect: stats.correct > 0 ? stats.confidenceCorrectSum / stats.correct : 0,
      avgConfidenceWrong: stats.wrong > 0 ? stats.confidenceWrongSum / stats.wrong : 0,
      totalEquity,
      pnl,
    }
  }).sort((a, b) =>
    b.accuracy - a.accuracy ||
    b.correct - a.correct ||
    (b.totalEquity ?? Number.NEGATIVE_INFINITY) - (a.totalEquity ?? Number.NEGATIVE_INFINITY) ||
    a.id.localeCompare(b.id)
  )

  const moneyLeaderboard = [...leaderboard].sort((a, b) =>
    (b.totalEquity ?? Number.NEGATIVE_INFINITY) - (a.totalEquity ?? Number.NEGATIVE_INFINITY) ||
    b.accuracy - a.accuracy ||
    b.correct - a.correct ||
    a.id.localeCompare(b.id)
  )

  return {
    leaderboard,
    moneyLeaderboard,
  }
}

async function loadLivePriceMap(marketIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  const config = getSeason4OnchainConfig()
  if (!config.enabled || !config.managerAddress || marketIds.length === 0) {
    return prices
  }

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl ?? undefined),
  })

  await Promise.all(marketIds.map(async (marketId) => {
    try {
      const value = await client.readContract({
        address: config.managerAddress!,
        abi: PREDICTION_MARKET_MANAGER_ABI,
        functionName: 'priceYesE18',
        args: [BigInt(marketId)],
      }) as bigint
      prices.set(marketId, probabilityFromE18(value))
    } catch {
      // Leave the live price absent if the chain read fails.
    }
  }))

  return prices
}

export async function getSeason4LeaderboardData(options: { sync?: boolean } = {}) {
  if (options.sync && getSeason4OnchainConfig().enabled) {
    await syncSeason4OnchainIndex()
  }

  const [modelWalletRows, balanceRows, marketRows, userRows, walletLinks] = await Promise.all([
    db.select({
      modelKey: onchainModelWallets.modelKey,
      bankrollDisplay: onchainModelWallets.bankrollDisplay,
      fundingStatus: onchainModelWallets.fundingStatus,
    })
      .from(onchainModelWallets),
    db.select({
      modelKey: onchainBalances.modelKey,
      userId: onchainBalances.userId,
      marketRef: onchainBalances.marketRef,
      collateralDisplay: onchainBalances.collateralDisplay,
      yesShares: onchainBalances.yesShares,
      noShares: onchainBalances.noShares,
    })
      .from(onchainBalances),
    db.select({
      onchainMarketId: onchainMarkets.onchainMarketId,
      marketSlug: onchainMarkets.marketSlug,
      title: onchainMarkets.title,
      status: onchainMarkets.status,
      resolvedOutcome: onchainMarkets.resolvedOutcome,
      closeTime: onchainMarkets.closeTime,
      createdAt: onchainMarkets.createdAt,
    })
      .from(onchainMarkets)
      .where(inArray(onchainMarkets.status, ['deployed', 'closed', 'resolved']))
      .orderBy(desc(onchainMarkets.createdAt)),
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
      .from(users),
    db.select({
      userId: onchainUserWallets.userId,
      walletAddress: onchainUserWallets.walletAddress,
    })
      .from(onchainUserWallets),
  ])

  const marketIds = marketRows
    .map((market) => trimOrNull(market.onchainMarketId))
    .filter((value): value is string => Boolean(value))
  const livePriceMap = await loadLivePriceMap(marketIds)

  const markets: Season4LeaderboardMarketRow[] = marketRows.flatMap((market) => {
    const marketId = trimOrNull(market.onchainMarketId)
    if (!marketId) return []

    const livePriceYes = livePriceMap.get(marketId) ?? 0.5
    const resolvedOutcome = market.resolvedOutcome as 'YES' | 'NO' | null
    const priceYes = resolvedOutcome === 'YES'
      ? 1
      : resolvedOutcome === 'NO'
        ? 0
        : livePriceYes
    const priceNo = resolvedOutcome === 'YES'
      ? 0
      : resolvedOutcome === 'NO'
        ? 1
        : Math.max(0, 1 - priceYes)

    return [{
      marketId,
      marketSlug: market.marketSlug,
      title: market.title,
      status: market.status,
      resolvedOutcome,
      priceYes,
      priceNo,
    }]
  })

  const modelWallets: Season4LeaderboardModelWalletRow[] = modelWalletRows.flatMap((row) => (
    isModelId(row.modelKey)
      ? [{
          modelKey: row.modelKey,
          bankrollDisplay: row.bankrollDisplay ?? 0,
          fundingStatus: row.fundingStatus,
        }]
      : []
  ))

  const { leaderboard, moneyLeaderboard } = buildSeason4ModelLeaderboard({
    modelWallets,
    balanceRows,
    markets,
  })

  const userById = new Map(userRows.map((user) => [user.id, user] as const))
  const walletByUserId = new Map(walletLinks.map((row) => [row.userId, row.walletAddress] as const))
  const marketById = new Map(markets.map((market) => [market.marketId, market] as const))
  const balanceRowsByUser = new Map<string, Season4LeaderboardBalanceRow[]>()

  for (const row of balanceRows) {
    if (!row.userId) continue
    const current = balanceRowsByUser.get(row.userId) ?? []
    current.push(row)
    balanceRowsByUser.set(row.userId, current)
  }

  const humanLeaderboard: Season4HumanLeaderboardEntry[] = Array.from(balanceRowsByUser.entries())
    .flatMap(([userId, rows]) => {
      const user = userById.get(userId)
      if (!user) return []

      const cashBalance = rows
        .filter((row) => row.marketRef === 'collateral')
        .reduce((sum, row) => sum + (row.collateralDisplay ?? 0), 0)
      const positionsValue = rows.reduce((sum, row) => {
        const marketId = extractMarketId(row.marketRef)
        if (!marketId) return sum
        const market = marketById.get(marketId)
        if (!market) return sum
        return sum + ((row.yesShares ?? 0) * market.priceYes) + ((row.noShares ?? 0) * market.priceNo)
      }, 0)
      const totalEquity = roundMoney(cashBalance + positionsValue)
      const displayName = normalizeDisplayName(user.name) ?? getGeneratedDisplayName(user.email || walletByUserId.get(userId) || userId)

      return [{
        userId,
        displayName,
        cashBalance: roundMoney(cashBalance),
        positionsValue: roundMoney(positionsValue),
        startingCash: 0,
        totalEquity,
        pnl: totalEquity,
      }]
    })
    .sort((a, b) =>
      b.totalEquity - a.totalEquity ||
      b.cashBalance - a.cashBalance ||
      a.displayName.localeCompare(b.displayName, 'en-US', { sensitivity: 'base' }) ||
      a.userId.localeCompare(b.userId)
    )

  return {
    leaderboard,
    moneyLeaderboard,
    humanLeaderboard,
    recentResolvedQuestions: [],
  }
}
