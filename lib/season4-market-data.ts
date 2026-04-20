import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { createPublicClient, formatEther, http } from 'viem'
import { db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import { MOCK_USDC_ABI, PREDICTION_MARKET_MANAGER_ABI, SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { getSeason4OnchainConfig, requireSeason4OnchainConfig } from '@/lib/onchain/config'
import { MOCK_USDC_DISPLAY_SCALE, SEASON4_CHAIN } from '@/lib/onchain/constants'
import { syncSeason4OnchainIndex } from '@/lib/onchain/indexer'
import { normalizeWalletAddress } from '@/lib/onchain/wallet-link'
import { getSeason4FaucetClaimState } from '@/lib/season4-faucet-eligibility'
import {
  onchainBalances,
  onchainEvents,
  onchainMarkets,
  onchainUserWallets,
  trialQuestions,
  trials,
  users,
} from '@/lib/schema'

const MARKET_DECIMALS = MOCK_USDC_DISPLAY_SCALE

export type Season4MarketSummary = {
  id: string
  marketSlug: string
  onchainMarketId: string | null
  trialQuestionId: string | null
  questionSlug: string | null
  questionPrompt: string | null
  title: string
  metadataUri: string | null
  status: string
  openedAt: string | null
  closeTime: string | null
  resolvedOutcome: 'YES' | 'NO' | null
  priceYes: number | null
  priceNo: number | null
  totalTrades: number
  totalVolumeDisplay: number
  lastTradeAt: string | null
  shortTitle: string | null
  sponsorName: string | null
  sponsorTicker: string | null
  exactPhase: string | null
  indication: string | null
  intervention: string | null
  primaryEndpoint: string | null
  currentStatus: string | null
  briefSummary: string | null
  nctNumber: string | null
}

export type Season4TradeRow = {
  txHash: string
  createdAt: string
  traderLabel: string
  isBuy: boolean
  isYes: boolean
  collateralAmountDisplay: number
  shareDeltaDisplay: number
  priceYes: number
}

export type Season4ViewerState = {
  userId: string
  walletAddress: string | null
  walletProvisioningStatus: string
  collateralBalanceDisplay: number
  gasBalanceEth: string | null
  yesShares: number
  noShares: number
  canClaimFromFaucet: boolean
  latestFaucetClaim: {
    status: string
    txHash: string | null
    requestedAt: string
  } | null
}

export type Season4LinkedTrial = {
  trialQuestionId: string
  questionSlug: string
  questionPrompt: string
  questionOutcome: 'Pending' | 'YES' | 'NO'
  questionOutcomeDate: string | null
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  indication: string
  exactPhase: string
  intervention: string
  primaryEndpoint: string
  currentStatus: string
  estEnrollment: number | null
  estPrimaryCompletionDate: string | null
  estStudyCompletionDate: string | null
  briefSummary: string
  nctNumber: string
}

export type Season4MarketDetail = {
  market: Season4MarketSummary
  deployTxHash: string | null
  recentTrades: Season4TradeRow[]
  priceHistory: Array<{
    snapshotDate: string
    priceYes: number
  }>
  trial: Season4LinkedTrial | null
  viewer: Season4ViewerState | null
  chain: {
    enabled: boolean
    chainId: number
    chainName: string
    managerAddress: string | null
    faucetAddress: string | null
    collateralTokenAddress: string | null
  }
}

function atomicToDisplay(value: unknown): number {
  const numeric = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? Number(value)
    : Number.NaN
  if (!Number.isFinite(numeric)) return 0
  return numeric / MARKET_DECIMALS
}

function probabilityFromE18(value: bigint): number {
  return Number(value) / 1e18
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function dateValueToString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function formatTradeAddress(address: string | null | undefined): string {
  const normalized = normalizeWalletAddress(address)
  if (!normalized) return 'Unknown trader'
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`
}

function createSeason4PublicClient() {
  const config = requireSeason4OnchainConfig()
  return createPublicClient({
    chain: SEASON4_CHAIN,
    transport: http(config.rpcUrl),
  })
}

async function syncIfEnabled() {
  if (!getSeason4OnchainConfig().enabled) return
  await syncSeason4OnchainIndex()
}

async function loadTradeStats(marketIds: string[]): Promise<Map<string, { totalTrades: number; totalVolumeDisplay: number; lastTradeAt: string | null }>> {
  if (marketIds.length === 0) return new Map()

  const marketRefs = marketIds.flatMap((marketId) => [marketId, `market:${marketId}`])

  const tradeRows = await db.select({
    marketRef: onchainEvents.marketRef,
    createdAt: onchainEvents.createdAt,
    payload: onchainEvents.payload,
  })
    .from(onchainEvents)
    .where(and(
      inArray(onchainEvents.marketRef, marketRefs),
      eq(onchainEvents.eventName, 'TradeExecuted'),
    ))

  const stats = new Map<string, { totalTrades: number; totalVolumeDisplay: number; lastTradeAt: string | null }>()
  for (const row of tradeRows) {
    const marketRef = row.marketRef?.startsWith('market:')
      ? row.marketRef.slice('market:'.length)
      : row.marketRef
    if (!marketRef) continue

    const existing = stats.get(marketRef) ?? { totalTrades: 0, totalVolumeDisplay: 0, lastTradeAt: null }
    const createdAt = row.createdAt?.toISOString?.() ?? null
    const payload = row.payload as Record<string, unknown>
    const collateralAmount = atomicToDisplay(payload.collateralAmount)
    const lastTradeAt = existing.lastTradeAt && createdAt
      ? (existing.lastTradeAt > createdAt ? existing.lastTradeAt : createdAt)
      : existing.lastTradeAt ?? createdAt

    stats.set(marketRef, {
      totalTrades: existing.totalTrades + 1,
      totalVolumeDisplay: existing.totalVolumeDisplay + Math.max(0, collateralAmount),
      lastTradeAt,
    })
  }

  return stats
}

async function loadMarketPrices(marketIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  if (marketIds.length === 0) return prices

  const config = getSeason4OnchainConfig()
  if (!config.enabled || !config.managerAddress) return prices

  const client = createSeason4PublicClient()
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
      // Leave the market without a live price if the contract read fails.
    }
  }))

  return prices
}

async function resolveViewerState(args: {
  userId: string
  walletProvisioningStatus: string
  walletAddress: string | null
  marketRef: string
}): Promise<Season4ViewerState> {
  const normalizedWallet = normalizeWalletAddress(args.walletAddress)
  const [collateralBalance, marketBalance] = normalizedWallet
    ? await Promise.all([
        db.select({
          collateralDisplay: onchainBalances.collateralDisplay,
        })
          .from(onchainBalances)
          .where(and(
            eq(onchainBalances.walletAddress, normalizedWallet),
            eq(onchainBalances.marketRef, 'collateral'),
          ))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        db.select({
          yesShares: onchainBalances.yesShares,
          noShares: onchainBalances.noShares,
        })
          .from(onchainBalances)
          .where(and(
            eq(onchainBalances.walletAddress, normalizedWallet),
            eq(onchainBalances.marketRef, args.marketRef),
          ))
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ])
    : [null, null]
  const faucetClaimState = await getSeason4FaucetClaimState({
    userId: args.userId,
    walletAddress: normalizedWallet,
  })

  let collateralBalanceDisplay = collateralBalance?.collateralDisplay ?? 0
  let canClaimFromFaucet = false
  let gasBalanceEth: string | null = null

  const config = getSeason4OnchainConfig()
  if (normalizedWallet && config.enabled && config.collateralTokenAddress) {
    try {
      const client = createSeason4PublicClient()
      const tokenBalance = await client.readContract({
        address: config.collateralTokenAddress,
        abi: MOCK_USDC_ABI,
        functionName: 'balanceOf',
        args: [normalizedWallet as `0x${string}`],
      }) as bigint
      collateralBalanceDisplay = atomicToDisplay(tokenBalance)
    } catch {
      // Keep the mirrored balance if the live token read fails.
    }
  }

  if ((config.target === 'toy' || !faucetClaimState.hasClaimed) && normalizedWallet && config.enabled && config.faucetAddress) {
    try {
      const client = createSeason4PublicClient()
      const [canClaim, lastClaimedAt, gasBalance] = await Promise.all([
        client.readContract({
          address: config.faucetAddress,
          abi: SEASON4_FAUCET_ABI,
          functionName: 'canClaim',
          args: [normalizedWallet as `0x${string}`],
        }) as Promise<boolean>,
        client.readContract({
          address: config.faucetAddress,
          abi: SEASON4_FAUCET_ABI,
          functionName: 'lastClaimedAt',
          args: [normalizedWallet as `0x${string}`],
        }) as Promise<bigint>,
        client.getBalance({ address: normalizedWallet as `0x${string}` }),
      ])
      canClaimFromFaucet = config.target === 'toy'
        ? canClaim
        : canClaim && lastClaimedAt === BigInt(0)
      gasBalanceEth = formatEther(gasBalance)
    } catch {
      canClaimFromFaucet = false
      gasBalanceEth = null
    }
  }

  return {
    userId: args.userId,
    walletAddress: normalizedWallet,
    walletProvisioningStatus: args.walletProvisioningStatus,
    collateralBalanceDisplay,
    gasBalanceEth,
    yesShares: marketBalance?.yesShares ?? 0,
    noShares: marketBalance?.noShares ?? 0,
    canClaimFromFaucet,
    latestFaucetClaim: faucetClaimState.latestClaim
      ? {
          status: faucetClaimState.latestClaim.status,
          txHash: faucetClaimState.latestClaim.txHash,
          requestedAt: faucetClaimState.latestClaim.requestedAt.toISOString(),
        }
      : null,
  }
}

export async function getSeason4MarketSummaries(options: { sync?: boolean } = {}): Promise<Season4MarketSummary[]> {
  if (options.sync) {
    await syncIfEnabled()
  }

  const config = getSeason4OnchainConfig()
  if (!config.managerAddress) return []

  const markets = await db.select({
    id: onchainMarkets.id,
    marketSlug: onchainMarkets.marketSlug,
    onchainMarketId: onchainMarkets.onchainMarketId,
    trialQuestionId: onchainMarkets.trialQuestionId,
    questionSlug: trialQuestions.slug,
    questionPrompt: trialQuestions.prompt,
    title: onchainMarkets.title,
    metadataUri: onchainMarkets.metadataUri,
    status: onchainMarkets.status,
    createdAt: onchainMarkets.createdAt,
    closeTime: onchainMarkets.closeTime,
    resolvedOutcome: onchainMarkets.resolvedOutcome,
    shortTitle: trials.shortTitle,
    sponsorName: trials.sponsorName,
    sponsorTicker: trials.sponsorTicker,
    exactPhase: trials.exactPhase,
    indication: trials.indication,
    intervention: trials.intervention,
    primaryEndpoint: trials.primaryEndpoint,
    currentStatus: trials.currentStatus,
    briefSummary: trials.briefSummary,
    nctNumber: trials.nctNumber,
  })
    .from(onchainMarkets)
    .leftJoin(trialQuestions, eq(onchainMarkets.trialQuestionId, trialQuestions.id))
    .leftJoin(trials, eq(trialQuestions.trialId, trials.id))
    .where(and(
      eq(onchainMarkets.managerAddress, config.managerAddress),
      inArray(onchainMarkets.status, ['deployed', 'closed', 'resolved']),
    ))
    .orderBy(desc(onchainMarkets.createdAt))

  const marketIds = markets
    .map((market) => trimOrNull(market.onchainMarketId))
    .filter((value): value is string => Boolean(value))
  const [tradeStats, priceMap] = await Promise.all([
    loadTradeStats(marketIds),
    loadMarketPrices(marketIds),
  ])

  return markets.map((market) => {
    const marketId = trimOrNull(market.onchainMarketId)
    const stats = marketId ? tradeStats.get(marketId) : null
    const priceYes = marketId ? (priceMap.get(marketId) ?? null) : null

    return {
      id: market.id,
      marketSlug: market.marketSlug,
      onchainMarketId: marketId,
      trialQuestionId: market.trialQuestionId,
      questionSlug: market.questionSlug,
      questionPrompt: market.questionPrompt,
      title: market.title,
      metadataUri: market.metadataUri,
      status: market.status,
      openedAt: market.createdAt ? market.createdAt.toISOString() : null,
      closeTime: market.closeTime ? market.closeTime.toISOString() : null,
      resolvedOutcome: market.resolvedOutcome as 'YES' | 'NO' | null,
      priceYes,
      priceNo: typeof priceYes === 'number' ? Math.max(0, 1 - priceYes) : null,
      totalTrades: stats?.totalTrades ?? 0,
      totalVolumeDisplay: stats?.totalVolumeDisplay ?? 0,
      lastTradeAt: stats?.lastTradeAt ?? null,
      shortTitle: market.shortTitle,
      sponsorName: market.sponsorName,
      sponsorTicker: market.sponsorTicker,
      exactPhase: market.exactPhase,
      indication: market.indication,
      intervention: market.intervention,
      primaryEndpoint: market.primaryEndpoint,
      currentStatus: market.currentStatus,
      briefSummary: market.briefSummary,
      nctNumber: market.nctNumber,
    }
  })
}

export async function getSeason4MarketDetail(
  identifier: string,
  options: {
    sync?: boolean
    viewerUserId?: string | null
  } = {},
): Promise<Season4MarketDetail> {
  if (options.sync) {
    await syncIfEnabled()
  }

  const trimmedIdentifier = trimOrNull(identifier)
  if (!trimmedIdentifier) {
    throw new NotFoundError('Season 4 market not found')
  }
  const config = getSeason4OnchainConfig()
  if (!config.managerAddress) {
    throw new NotFoundError('Season 4 market not found')
  }

  const [market] = await db.select({
    id: onchainMarkets.id,
    marketSlug: onchainMarkets.marketSlug,
    onchainMarketId: onchainMarkets.onchainMarketId,
    title: onchainMarkets.title,
    metadataUri: onchainMarkets.metadataUri,
    status: onchainMarkets.status,
    createdAt: onchainMarkets.createdAt,
    closeTime: onchainMarkets.closeTime,
    resolvedOutcome: onchainMarkets.resolvedOutcome,
    deployTxHash: onchainMarkets.deployTxHash,
    trialQuestionId: onchainMarkets.trialQuestionId,
    questionSlug: trialQuestions.slug,
    questionPrompt: trialQuestions.prompt,
    questionOutcome: trialQuestions.outcome,
    questionOutcomeDate: trialQuestions.outcomeDate,
    shortTitle: trials.shortTitle,
    sponsorName: trials.sponsorName,
    sponsorTicker: trials.sponsorTicker,
    indication: trials.indication,
    exactPhase: trials.exactPhase,
    intervention: trials.intervention,
    primaryEndpoint: trials.primaryEndpoint,
    currentStatus: trials.currentStatus,
    estEnrollment: trials.estEnrollment,
    estPrimaryCompletionDate: trials.estPrimaryCompletionDate,
    estStudyCompletionDate: trials.estStudyCompletionDate,
    briefSummary: trials.briefSummary,
    nctNumber: trials.nctNumber,
  })
    .from(onchainMarkets)
    .leftJoin(trialQuestions, eq(onchainMarkets.trialQuestionId, trialQuestions.id))
    .leftJoin(trials, eq(trialQuestions.trialId, trials.id))
    .where(and(
      eq(onchainMarkets.managerAddress, config.managerAddress),
      or(
        eq(onchainMarkets.marketSlug, trimmedIdentifier),
        eq(onchainMarkets.onchainMarketId, trimmedIdentifier),
      ),
    ))
    .limit(1)

  if (!market) {
    throw new NotFoundError('Season 4 market not found')
  }

  const marketId = trimOrNull(market.onchainMarketId)
  const [tradeStats, priceMap, tradeEvents] = await Promise.all([
    loadTradeStats(marketId ? [marketId] : []),
    loadMarketPrices(marketId ? [marketId] : []),
    marketId
      ? db.select({
          txHash: onchainEvents.txHash,
          createdAt: onchainEvents.createdAt,
          walletAddress: onchainEvents.walletAddress,
          payload: onchainEvents.payload,
        })
          .from(onchainEvents)
          .where(and(
            inArray(onchainEvents.marketRef, [marketId, `market:${marketId}`]),
            eq(onchainEvents.eventName, 'TradeExecuted'),
          ))
          .orderBy(desc(onchainEvents.createdAt))
          .limit(120)
      : Promise.resolve([]),
  ])

  const priceYes = marketId ? (priceMap.get(marketId) ?? null) : null
  const stats = marketId ? tradeStats.get(marketId) : null
  const summary: Season4MarketSummary = {
    id: market.id,
    marketSlug: market.marketSlug,
    onchainMarketId: marketId,
    trialQuestionId: market.trialQuestionId,
    questionSlug: market.questionSlug,
    questionPrompt: market.questionPrompt,
    title: market.title,
    metadataUri: market.metadataUri,
    status: market.status,
    openedAt: market.createdAt ? market.createdAt.toISOString() : null,
    closeTime: market.closeTime ? market.closeTime.toISOString() : null,
    resolvedOutcome: market.resolvedOutcome as 'YES' | 'NO' | null,
    priceYes,
    priceNo: typeof priceYes === 'number' ? Math.max(0, 1 - priceYes) : null,
    totalTrades: stats?.totalTrades ?? 0,
    totalVolumeDisplay: stats?.totalVolumeDisplay ?? 0,
    lastTradeAt: stats?.lastTradeAt ?? null,
    shortTitle: market.shortTitle,
    sponsorName: market.sponsorName,
    sponsorTicker: market.sponsorTicker,
    exactPhase: market.exactPhase,
    indication: market.indication,
    intervention: market.intervention,
    primaryEndpoint: market.primaryEndpoint,
    currentStatus: market.currentStatus,
    briefSummary: market.briefSummary,
    nctNumber: market.nctNumber,
  }

  const mappedTradeEvents: Season4TradeRow[] = tradeEvents.map((event) => {
    const payload = event.payload as Record<string, unknown>
    const priceYesE18 = typeof payload.priceYesE18 === 'string' || typeof payload.priceYesE18 === 'number'
      ? Number(payload.priceYesE18)
      : 0

    return {
      txHash: event.txHash,
      createdAt: event.createdAt.toISOString(),
      traderLabel: formatTradeAddress(event.walletAddress),
      isBuy: payload.isBuy === true,
      isYes: payload.isYes === true,
      collateralAmountDisplay: atomicToDisplay(payload.collateralAmount),
      shareDeltaDisplay: atomicToDisplay(payload.shareDelta),
      priceYes: priceYesE18 / 1e18,
    }
  })
  const recentTrades = mappedTradeEvents.slice(0, 10)
  const priceHistory = [...mappedTradeEvents]
    .reverse()
    .map((trade) => ({
      snapshotDate: trade.createdAt,
      priceYes: trade.priceYes,
    }))

  const linkedTrial = market.trialQuestionId && market.questionPrompt && market.shortTitle
    ? {
        trialQuestionId: market.trialQuestionId,
        questionSlug: market.questionSlug ?? market.marketSlug,
        questionPrompt: market.questionPrompt,
        questionOutcome: (market.questionOutcome ?? 'Pending') as 'Pending' | 'YES' | 'NO',
        questionOutcomeDate: market.questionOutcomeDate ? market.questionOutcomeDate.toISOString() : null,
        shortTitle: market.shortTitle,
        sponsorName: market.sponsorName ?? 'Unknown sponsor',
        sponsorTicker: market.sponsorTicker,
        indication: market.indication ?? '—',
        exactPhase: market.exactPhase ?? '—',
        intervention: market.intervention ?? '—',
        primaryEndpoint: market.primaryEndpoint ?? '—',
        currentStatus: market.currentStatus ?? '—',
        estEnrollment: market.estEnrollment,
        estPrimaryCompletionDate: dateValueToString(market.estPrimaryCompletionDate),
        estStudyCompletionDate: dateValueToString(market.estStudyCompletionDate),
        briefSummary: market.briefSummary ?? 'No trial summary available yet.',
        nctNumber: market.nctNumber ?? '—',
      } satisfies Season4LinkedTrial
    : null

  let viewer: Season4ViewerState | null = null
  if (options.viewerUserId) {
    const [user] = await db.select({
      id: users.id,
      embeddedWalletAddress: users.embeddedWalletAddress,
      walletProvisioningStatus: users.walletProvisioningStatus,
    })
      .from(users)
      .where(eq(users.id, options.viewerUserId))
      .limit(1)

    if (user) {
      const [walletLink] = await db.select({
        walletAddress: onchainUserWallets.walletAddress,
      })
        .from(onchainUserWallets)
        .where(eq(onchainUserWallets.userId, user.id))
        .limit(1)

      viewer = await resolveViewerState({
        userId: user.id,
        walletProvisioningStatus: user.walletProvisioningStatus,
        walletAddress: walletLink?.walletAddress ?? user.embeddedWalletAddress ?? null,
        marketRef: marketId ? `market:${marketId}` : 'collateral',
      })
    }
  }

  return {
    market: summary,
    deployTxHash: market.deployTxHash,
    recentTrades,
    priceHistory,
    trial: linkedTrial,
    viewer,
    chain: {
      enabled: config.enabled,
      chainId: config.chainId,
      chainName: config.chainName,
      managerAddress: config.managerAddress,
      faucetAddress: config.faucetAddress,
      collateralTokenAddress: config.collateralTokenAddress,
    },
  }
}

export async function getSeason4NavbarBalance(userId: string): Promise<number | null> {
  const [user] = await db.select({
    id: users.id,
    embeddedWalletAddress: users.embeddedWalletAddress,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return null

  const [walletLink] = await db.select({
    walletAddress: onchainUserWallets.walletAddress,
  })
    .from(onchainUserWallets)
    .where(eq(onchainUserWallets.userId, user.id))
    .limit(1)
  const walletAddress = walletLink?.walletAddress ?? normalizeWalletAddress(user.embeddedWalletAddress)
  if (!walletAddress) return null

  const [balance] = await db.select({
    collateralDisplay: onchainBalances.collateralDisplay,
  })
    .from(onchainBalances)
    .where(and(
      eq(onchainBalances.walletAddress, walletAddress),
      eq(onchainBalances.marketRef, 'collateral'),
    ))
    .limit(1)

  return balance?.collateralDisplay ?? 0
}

export async function getSeason4HomepageData(options: { sync?: boolean } = {}) {
  const config = getSeason4OnchainConfig()
  const markets = await getSeason4MarketSummaries(options)
  return {
    chain: {
      enabled: config.enabled,
      chainId: config.chainId,
      chainName: config.chainName,
    },
    markets,
  }
}
