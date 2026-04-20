import { desc, eq, inArray } from 'drizzle-orm'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import { MOCK_USDC_ABI, PREDICTION_MARKET_MANAGER_ABI, SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { getSeason4OnchainConfig } from '@/lib/onchain/config'
import { syncSeason4OnchainIndex } from '@/lib/onchain/indexer'
import { normalizeWalletAddress } from '@/lib/onchain/wallet-link'
import { getSeason4FaucetClaimState } from '@/lib/season4-faucet-eligibility'
import { formatSeason4FaucetEthAmount, formatSeason4FaucetUsdcAmount } from '@/lib/season4-faucet-config'
import { onchainBalances, onchainEvents, onchainMarkets, onchainUserWallets, users } from '@/lib/schema'

const MARKET_DECIMALS = 1_000_000

export type Season4ProfileHolding = {
  marketId: string
  marketSlug: string
  title: string
  marketHref: string
  status: string
  closeTime: string | null
  resolvedOutcome: 'YES' | 'NO' | null
  priceYes: number | null
  priceNo: number | null
  yesShares: number
  noShares: number
  markValueDisplay: number
}

export type Season4ProfileActivity = {
  txHash: string
  approvalTxHash: string | null
  createdAt: string
  eventName: 'TradeExecuted' | 'FaucetClaimed' | 'GasTopUp' | 'WinningsRedeemed'
  label: string
  marketSlug: string | null
  title: string | null
  marketHref: string | null
  collateralAmountDisplay: number
  amountLabel: string | null
  shareDeltaDisplay: number | null
}

export type Season4ProfileData = {
  user: {
    id: string
    name: string
    email: string | null
    xUsername: string | null
    xConnectedAt: string | null
    privyUserId: string | null
    embeddedWalletAddress: string | null
    walletProvisioningStatus: string
    walletProvisionedAt: string | null
  }
  wallet: {
    address: string | null
    provisioningStatus: string
    firstClaimedAt: string | null
  }
  viewer: {
    collateralBalanceDisplay: number
    hasClaimedFaucet: boolean
    canClaimFromFaucet: boolean
    faucetClaimAmountLabel: string
    latestFaucetClaim: {
      status: string
      txHash: string | null
      requestedAt: string
    } | null
  }
  holdings: Season4ProfileHolding[]
  activities: Season4ProfileActivity[]
  totals: {
    collateralBalanceDisplay: number
    positionsValueDisplay: number
    totalEquityDisplay: number
  }
  primaryMarketHref: string
  chain: {
    enabled: boolean
    chainId: number
    chainName: string
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

function extractMarketId(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'gas') return null
  if (value.startsWith('market:')) {
    return trimOrNull(value.slice('market:'.length))
  }
  return trimOrNull(value)
}

function formatGasTopUpAmount(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return 'ETH'
  }

  try {
    return `${formatSeason4FaucetEthAmount(BigInt(value))} ETH`
  } catch {
    return 'ETH'
  }
}

async function loadMarketPrices(marketIds: string[]): Promise<Map<string, number>> {
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
      // Leave the price absent if the contract read fails.
    }
  }))

  return prices
}

export async function getSeason4ProfileData(
  userId: string,
  options: { sync?: boolean } = {},
): Promise<Season4ProfileData> {
  if (options.sync && getSeason4OnchainConfig().enabled) {
    await syncSeason4OnchainIndex()
  }

  const [user] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    xUsername: users.xUsername,
    xConnectedAt: users.xConnectedAt,
    privyUserId: users.privyUserId,
    embeddedWalletAddress: users.embeddedWalletAddress,
    walletProvisioningStatus: users.walletProvisioningStatus,
    walletProvisionedAt: users.walletProvisionedAt,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    throw new NotFoundError('Season 4 user not found')
  }

  const [walletLink, primaryMarket] = await Promise.all([
    db.select({
      walletAddress: onchainUserWallets.walletAddress,
      provisioningStatus: onchainUserWallets.provisioningStatus,
      firstClaimedAt: onchainUserWallets.firstClaimedAt,
    })
      .from(onchainUserWallets)
      .where(eq(onchainUserWallets.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select({
      marketSlug: onchainMarkets.marketSlug,
    })
      .from(onchainMarkets)
      .orderBy(desc(onchainMarkets.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])

  const walletAddress = walletLink?.walletAddress ?? normalizeWalletAddress(user.embeddedWalletAddress)
  const config = getSeason4OnchainConfig()
  const faucetClaimState = await getSeason4FaucetClaimState({
    userId: user.id,
    walletAddress,
  })

  const [balanceRows, activityRows] = walletAddress
    ? await Promise.all([
        db.select({
          marketRef: onchainBalances.marketRef,
          collateralDisplay: onchainBalances.collateralDisplay,
          yesShares: onchainBalances.yesShares,
          noShares: onchainBalances.noShares,
        })
          .from(onchainBalances)
          .where(eq(onchainBalances.walletAddress, walletAddress)),
        db.select({
          txHash: onchainEvents.txHash,
          createdAt: onchainEvents.createdAt,
          eventName: onchainEvents.eventName,
          marketRef: onchainEvents.marketRef,
          payload: onchainEvents.payload,
        })
          .from(onchainEvents)
          .where(eq(onchainEvents.walletAddress, walletAddress))
          .orderBy(desc(onchainEvents.createdAt))
          .limit(25),
      ])
    : [[], []]

  let collateralBalance = balanceRows.find((row) => row.marketRef === 'collateral')?.collateralDisplay ?? 0
  if (walletAddress && config.enabled && config.collateralTokenAddress) {
    try {
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(config.rpcUrl ?? undefined),
      })
      const tokenBalance = await client.readContract({
        address: config.collateralTokenAddress,
        abi: MOCK_USDC_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      }) as bigint
      collateralBalance = atomicToDisplay(tokenBalance)
    } catch {
      // Keep the mirrored balance if the live token read fails.
    }
  }

  const marketIds = Array.from(new Set([
    ...balanceRows.map((row) => extractMarketId(row.marketRef)),
    ...activityRows.map((row) => extractMarketId(row.marketRef)),
  ].filter((value): value is string => Boolean(value))))

  const markets = marketIds.length > 0
    ? await db.select({
        onchainMarketId: onchainMarkets.onchainMarketId,
        marketSlug: onchainMarkets.marketSlug,
        title: onchainMarkets.title,
        status: onchainMarkets.status,
        closeTime: onchainMarkets.closeTime,
        resolvedOutcome: onchainMarkets.resolvedOutcome,
      })
        .from(onchainMarkets)
        .where(inArray(onchainMarkets.onchainMarketId, marketIds))
    : []

  const marketById = new Map(markets
    .map((market) => {
      const marketId = trimOrNull(market.onchainMarketId)
      return marketId ? [marketId, market] as const : null
    })
    .filter((entry): entry is readonly [string, typeof markets[number]] => Boolean(entry)))

  const priceMap = await loadMarketPrices(marketIds)

  const holdings: Season4ProfileHolding[] = balanceRows.flatMap((row) => {
    const marketId = extractMarketId(row.marketRef)
    if (!marketId) return []

    const market = marketById.get(marketId)
    if (!market) return []

    const yesShares = row.yesShares ?? 0
    const noShares = row.noShares ?? 0
    if (yesShares <= 0 && noShares <= 0) return []

    const resolvedOutcome = market.resolvedOutcome as 'YES' | 'NO' | null
    const livePriceYes = priceMap.get(marketId) ?? 0.5
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
      marketHref: `/trials/${encodeURIComponent(market.marketSlug)}`,
      status: market.status,
      closeTime: market.closeTime ? market.closeTime.toISOString() : null,
      resolvedOutcome,
      priceYes,
      priceNo,
      yesShares,
      noShares,
      markValueDisplay: (yesShares * priceYes) + (noShares * priceNo),
    }]
  }).sort((left, right) => right.markValueDisplay - left.markValueDisplay)

  const activities = activityRows.reduce<Season4ProfileActivity[]>((items, row) => {
    if (row.eventName !== 'TradeExecuted' && row.eventName !== 'FaucetClaimed' && row.eventName !== 'GasTopUp' && row.eventName !== 'WinningsRedeemed') {
      return items
    }

    const payload = row.payload as Record<string, unknown>
    const marketId = extractMarketId(row.marketRef)
    const market = marketId ? marketById.get(marketId) : null

    if (row.eventName === 'TradeExecuted') {
      const isBuy = payload.isBuy === true
      const isYes = payload.isYes === true
      const approvalTxHash = typeof payload.approvalTxHash === 'string'
        ? payload.approvalTxHash
        : null
      items.push({
        txHash: row.txHash,
        approvalTxHash,
        createdAt: row.createdAt.toISOString(),
        eventName: 'TradeExecuted',
        label: `${isBuy ? 'Buy' : 'Sell'} ${isYes ? 'YES' : 'NO'}`,
        marketSlug: market?.marketSlug ?? null,
        title: market?.title ?? null,
        marketHref: market ? `/trials/${encodeURIComponent(market.marketSlug)}` : null,
        collateralAmountDisplay: atomicToDisplay(payload.collateralAmount),
        amountLabel: null,
        shareDeltaDisplay: atomicToDisplay(payload.shareDelta),
      })
      return items
    }

    if (row.eventName === 'WinningsRedeemed') {
      items.push({
        txHash: row.txHash,
        approvalTxHash: null,
        createdAt: row.createdAt.toISOString(),
        eventName: 'WinningsRedeemed',
        label: 'Redeem winnings',
        marketSlug: market?.marketSlug ?? null,
        title: market?.title ?? null,
        marketHref: market ? `/trials/${encodeURIComponent(market.marketSlug)}` : null,
        collateralAmountDisplay: atomicToDisplay(payload.collateralAmount),
        amountLabel: null,
        shareDeltaDisplay: null,
      })
      return items
    }

    if (row.eventName === 'GasTopUp') {
      items.push({
        txHash: row.txHash,
        approvalTxHash: null,
        createdAt: row.createdAt.toISOString(),
        eventName: 'GasTopUp',
        label: 'Gas top-up',
        marketSlug: null,
        title: 'Base Sepolia gas',
        marketHref: null,
        collateralAmountDisplay: 0,
        amountLabel: formatGasTopUpAmount(payload.amountWei),
        shareDeltaDisplay: null,
      })
      return items
    }

    items.push({
      txHash: row.txHash,
      approvalTxHash: null,
      createdAt: row.createdAt.toISOString(),
      eventName: 'FaucetClaimed',
      label: 'Faucet claim',
      marketSlug: null,
      title: null,
      marketHref: null,
      collateralAmountDisplay: atomicToDisplay(payload.amount),
      amountLabel: null,
      shareDeltaDisplay: null,
    })
    return items
  }, [])

  let canClaimFromFaucet = false
  let hasClaimedFaucet = faucetClaimState.hasClaimed
  let faucetClaimAmountLabel = formatSeason4FaucetUsdcAmount()
  if ((config.target === 'toy' || !faucetClaimState.hasClaimed) && walletAddress && config.enabled && config.faucetAddress) {
    try {
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(config.rpcUrl ?? undefined),
      })

      const [canClaim, lastClaimedAt, claimAmount] = await Promise.all([
        client.readContract({
          address: config.faucetAddress!,
          abi: SEASON4_FAUCET_ABI,
          functionName: 'canClaim',
          args: [walletAddress as `0x${string}`],
        }) as Promise<boolean>,
        client.readContract({
          address: config.faucetAddress!,
          abi: SEASON4_FAUCET_ABI,
          functionName: 'lastClaimedAt',
          args: [walletAddress as `0x${string}`],
        }) as Promise<bigint>,
        client.readContract({
          address: config.faucetAddress!,
          abi: SEASON4_FAUCET_ABI,
          functionName: 'claimAmount',
        }) as Promise<bigint>,
      ])
      hasClaimedFaucet = config.target === 'toy'
        ? faucetClaimState.hasClaimed
        : lastClaimedAt > BigInt(0)
      canClaimFromFaucet = config.target === 'toy'
        ? canClaim
        : canClaim && lastClaimedAt === BigInt(0)
      faucetClaimAmountLabel = formatSeason4FaucetUsdcAmount(claimAmount)
    } catch {
      canClaimFromFaucet = false
    }
  }

  const positionsValueDisplay = holdings.reduce((sum, holding) => sum + holding.markValueDisplay, 0)
  const primaryMarketHref = primaryMarket
    ? `/trials/${encodeURIComponent(primaryMarket.marketSlug)}`
    : '/'

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      xUsername: user.xUsername,
      xConnectedAt: user.xConnectedAt ? user.xConnectedAt.toISOString() : null,
      privyUserId: user.privyUserId,
      embeddedWalletAddress: user.embeddedWalletAddress,
      walletProvisioningStatus: user.walletProvisioningStatus,
      walletProvisionedAt: user.walletProvisionedAt ? user.walletProvisionedAt.toISOString() : null,
    },
    wallet: {
      address: walletAddress,
      provisioningStatus: walletLink?.provisioningStatus ?? user.walletProvisioningStatus,
      firstClaimedAt: walletLink?.firstClaimedAt ? walletLink.firstClaimedAt.toISOString() : null,
    },
    viewer: {
      collateralBalanceDisplay: collateralBalance,
      hasClaimedFaucet,
      canClaimFromFaucet,
      faucetClaimAmountLabel,
      latestFaucetClaim: faucetClaimState.latestClaim
        ? {
            status: faucetClaimState.latestClaim.status,
            txHash: faucetClaimState.latestClaim.txHash,
            requestedAt: faucetClaimState.latestClaim.requestedAt.toISOString(),
          }
        : null,
    },
    holdings,
    activities,
    totals: {
      collateralBalanceDisplay: collateralBalance,
      positionsValueDisplay,
      totalEquityDisplay: collateralBalance + positionsValueDisplay,
    },
    primaryMarketHref,
    chain: {
      enabled: config.enabled,
      chainId: config.chainId,
      chainName: config.chainName,
    },
  }
}
