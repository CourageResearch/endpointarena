import { and, eq } from 'drizzle-orm'
import { createPublicClient, decodeEventLog, http, type Address, type PublicClient } from 'viem'
import { db } from '@/lib/db'
import {
  onchainBalances,
  onchainEvents,
  onchainFaucetClaims,
  onchainIndexerCursors,
  onchainMarkets,
  onchainModelWallets,
  onchainUserWallets,
} from '@/lib/schema'
import { PREDICTION_MARKET_MANAGER_ABI, SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { getSeason4OnchainConfig, requireSeason4OnchainConfig } from '@/lib/onchain/config'

type IndexedAddressTarget = {
  cursorId: string
  address: Address
  kind: 'manager' | 'faucet'
}

export type Season4IndexerSummary = {
  chainId: number
  latestBlock: string
  fromBlocks: Record<string, string>
  logsIndexed: number
  marketEvents: number
  faucetEvents: number
}

type WalletIdentity = {
  userId: string | null
  modelKey: string | null
}

const MOCK_USDC_DECIMALS = BigInt(6)
const MAX_LOG_RANGE = BigInt(9_999)

function lowercaseAddress(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value.toLowerCase() : null
}

function serializeForJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((entry) => serializeForJson(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serializeForJson(nested)]))
  }

  return value
}

function formatTokenDisplay(value: bigint, decimals = MOCK_USDC_DECIMALS): number {
  const divisor = Number(BigInt(10) ** decimals)
  return Number(value) / divisor
}

function createClient(): PublicClient {
  const config = requireSeason4OnchainConfig()
  return createPublicClient({
    transport: http(config.rpcUrl),
  })
}

async function fetchLogsInChunks(args: {
  client: PublicClient
  address: Address
  fromBlock: bigint
  toBlock: bigint
}): Promise<Awaited<ReturnType<PublicClient['getLogs']>>> {
  if (args.fromBlock > args.toBlock) {
    return []
  }

  const logs: Awaited<ReturnType<PublicClient['getLogs']>> = []
  let cursor = args.fromBlock

  while (cursor <= args.toBlock) {
    const chunkToBlock = cursor + MAX_LOG_RANGE > args.toBlock
      ? args.toBlock
      : cursor + MAX_LOG_RANGE

    const chunkLogs = await args.client.getLogs({
      address: args.address,
      fromBlock: cursor,
      toBlock: chunkToBlock,
    })
    logs.push(...chunkLogs)
    cursor = chunkToBlock + BigInt(1)
  }

  return logs
}

async function getCursorBlock(target: IndexedAddressTarget, fallbackBlock: bigint): Promise<bigint> {
  const [existing] = await db.select({
    lastSyncedBlock: onchainIndexerCursors.lastSyncedBlock,
  })
    .from(onchainIndexerCursors)
    .where(and(
      eq(onchainIndexerCursors.id, target.cursorId),
      eq(onchainIndexerCursors.contractAddress, target.address),
    ))
    .limit(1)

  if (!existing) return fallbackBlock

  try {
    return BigInt(existing.lastSyncedBlock)
  } catch {
    return fallbackBlock
  }
}

async function saveCursor(target: IndexedAddressTarget, blockNumber: bigint): Promise<void> {
  const [existing] = await db.select({
    id: onchainIndexerCursors.id,
  })
    .from(onchainIndexerCursors)
    .where(eq(onchainIndexerCursors.id, target.cursorId))
    .limit(1)

  if (existing) {
    await db.update(onchainIndexerCursors)
      .set({
        chainId: getSeason4OnchainConfig().chainId,
        contractAddress: target.address,
        lastSyncedBlock: blockNumber.toString(),
        latestSeenBlock: blockNumber.toString(),
        updatedAt: new Date(),
      })
      .where(eq(onchainIndexerCursors.id, target.cursorId))
    return
  }

  await db.insert(onchainIndexerCursors).values({
    id: target.cursorId,
    chainId: getSeason4OnchainConfig().chainId,
    contractAddress: target.address,
    lastSyncedBlock: blockNumber.toString(),
    latestSeenBlock: blockNumber.toString(),
    updatedAt: new Date(),
  })
}

async function resolveWalletIdentity(walletAddress: string): Promise<WalletIdentity> {
  const normalized = lowercaseAddress(walletAddress)
  if (!normalized) {
    return { userId: null, modelKey: null }
  }

  const [userWallet, modelWallet] = await Promise.all([
    db.select({
      userId: onchainUserWallets.userId,
    })
      .from(onchainUserWallets)
      .where(eq(onchainUserWallets.walletAddress, normalized))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select({
      modelKey: onchainModelWallets.modelKey,
    })
      .from(onchainModelWallets)
      .where(eq(onchainModelWallets.walletAddress, normalized))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])

  return {
    userId: userWallet?.userId ?? null,
    modelKey: modelWallet?.modelKey ?? null,
  }
}

async function upsertBalanceRow(args: {
  walletAddress: string
  marketRef: string
  collateralDelta?: number
  yesShareDelta?: number
  noShareDelta?: number
  blockNumber: bigint
}): Promise<void> {
  const walletAddress = lowercaseAddress(args.walletAddress)
  if (!walletAddress) return

  const identity = await resolveWalletIdentity(walletAddress)
  const [existing] = await db.select({
    id: onchainBalances.id,
    collateralDisplay: onchainBalances.collateralDisplay,
    yesShares: onchainBalances.yesShares,
    noShares: onchainBalances.noShares,
  })
    .from(onchainBalances)
    .where(and(
      eq(onchainBalances.chainId, getSeason4OnchainConfig().chainId),
      eq(onchainBalances.walletAddress, walletAddress),
      eq(onchainBalances.marketRef, args.marketRef),
    ))
    .limit(1)

  const nextCollateral = Math.max(0, (existing?.collateralDisplay ?? 0) + (args.collateralDelta ?? 0))
  const nextYesShares = Math.max(0, (existing?.yesShares ?? 0) + (args.yesShareDelta ?? 0))
  const nextNoShares = Math.max(0, (existing?.noShares ?? 0) + (args.noShareDelta ?? 0))

  if (existing) {
    await db.update(onchainBalances)
      .set({
        userId: identity.userId,
        modelKey: identity.modelKey,
        collateralDisplay: nextCollateral,
        yesShares: nextYesShares,
        noShares: nextNoShares,
        lastIndexedBlock: args.blockNumber.toString(),
        updatedAt: new Date(),
      })
      .where(eq(onchainBalances.id, existing.id))
    return
  }

  await db.insert(onchainBalances).values({
    chainId: getSeason4OnchainConfig().chainId,
    walletAddress,
    marketRef: args.marketRef,
    userId: identity.userId,
    modelKey: identity.modelKey,
    collateralDisplay: nextCollateral,
    yesShares: nextYesShares,
    noShares: nextNoShares,
    lastIndexedBlock: args.blockNumber.toString(),
    updatedAt: new Date(),
  })
}

async function persistEventRow(args: {
  chainId: number
  contractAddress: string
  txHash: string
  blockHash: string | null
  blockNumber: bigint
  logIndex: number
  eventName: string
  marketRef?: string | null
  walletAddress?: string | null
  payload: Record<string, unknown>
}): Promise<boolean> {
  const [existing] = await db.select({
    id: onchainEvents.id,
  })
    .from(onchainEvents)
    .where(and(
      eq(onchainEvents.chainId, args.chainId),
      eq(onchainEvents.txHash, args.txHash),
      eq(onchainEvents.logIndex, args.logIndex),
    ))
    .limit(1)

  if (existing) {
    return false
  }

  await db.insert(onchainEvents).values({
    chainId: args.chainId,
    contractAddress: lowercaseAddress(args.contractAddress) ?? args.contractAddress,
    txHash: args.txHash,
    blockHash: args.blockHash,
    blockNumber: args.blockNumber.toString(),
    logIndex: args.logIndex,
    eventName: args.eventName,
    marketRef: args.marketRef ?? null,
    walletAddress: lowercaseAddress(args.walletAddress) ?? null,
    payload: serializeForJson(args.payload) as Record<string, unknown>,
  })

  return true
}

async function handleManagerLog(target: IndexedAddressTarget, log: Awaited<ReturnType<PublicClient['getLogs']>>[number]) {
  let decoded: ReturnType<typeof decodeEventLog<typeof PREDICTION_MARKET_MANAGER_ABI>>
  try {
    decoded = decodeEventLog({
      abi: PREDICTION_MARKET_MANAGER_ABI,
      data: log.data,
      topics: log.topics,
    })
  } catch {
    return { marketEvents: 0 }
  }
  const eventName = decoded.eventName
  const chainId = getSeason4OnchainConfig().chainId
  const marketRef = 'marketId' in decoded.args ? String(decoded.args.marketId) : null
  const walletAddress = 'trader' in decoded.args ? String(decoded.args.trader) : null

  const inserted = await persistEventRow({
    chainId,
    contractAddress: target.address,
    txHash: log.transactionHash!,
    blockHash: log.blockHash ?? null,
    blockNumber: log.blockNumber!,
    logIndex: log.logIndex!,
    eventName,
    marketRef,
    walletAddress,
    payload: decoded.args as Record<string, unknown>,
  })

  if (!inserted) return { marketEvents: 0 }

  if (eventName === 'MarketCreated') {
    const marketId = String(decoded.args.marketId)
    const [existing] = await db.select({
      id: onchainMarkets.id,
      marketSlug: onchainMarkets.marketSlug,
      title: onchainMarkets.title,
      trialQuestionId: onchainMarkets.trialQuestionId,
    })
      .from(onchainMarkets)
      .where(and(
        eq(onchainMarkets.chainId, chainId),
        eq(onchainMarkets.managerAddress, lowercaseAddress(target.address) ?? target.address),
        eq(onchainMarkets.onchainMarketId, marketId),
      ))
      .limit(1)

    const baseValues = {
      chainId,
      managerAddress: lowercaseAddress(target.address) ?? target.address,
      onchainMarketId: marketId,
      metadataUri: typeof decoded.args.metadataUri === 'string' ? decoded.args.metadataUri : null,
      collateralTokenAddress: lowercaseAddress(String(decoded.args.collateralToken)) ?? String(decoded.args.collateralToken),
      status: 'deployed' as const,
      closeTime: new Date(Number(decoded.args.closeTime) * 1000),
      deployTxHash: log.transactionHash!,
      updatedAt: new Date(),
    }

    if (existing) {
      await db.update(onchainMarkets)
        .set(baseValues)
        .where(eq(onchainMarkets.id, existing.id))
    } else {
      await db.insert(onchainMarkets).values({
        trialQuestionId: null,
        marketSlug: `season4-market-${marketId}`,
        title: `Season 4 Market ${marketId}`,
        ...baseValues,
      })
    }
  }

  if (eventName === 'MarketResolved') {
    await db.update(onchainMarkets)
      .set({
        status: 'resolved',
        resolvedOutcome: decoded.args.outcomeYes ? 'YES' : 'NO',
        resolveTxHash: log.transactionHash!,
        updatedAt: new Date(),
      })
      .where(and(
        eq(onchainMarkets.chainId, chainId),
        eq(onchainMarkets.managerAddress, lowercaseAddress(target.address) ?? target.address),
        eq(onchainMarkets.onchainMarketId, String(decoded.args.marketId)),
      ))
  }

  if (eventName === 'TradeExecuted') {
    const collateralDelta = formatTokenDisplay(decoded.args.collateralAmount) * (decoded.args.isBuy ? -1 : 1)
    const shareDelta = formatTokenDisplay(decoded.args.shareDelta)
    const isYes = Boolean(decoded.args.isYes)
    await upsertBalanceRow({
      walletAddress: String(decoded.args.trader),
      marketRef: 'collateral',
      collateralDelta,
      blockNumber: log.blockNumber!,
    })
    await upsertBalanceRow({
      walletAddress: String(decoded.args.trader),
      marketRef: `market:${decoded.args.marketId.toString()}`,
      yesShareDelta: isYes ? (decoded.args.isBuy ? shareDelta : -shareDelta) : 0,
      noShareDelta: isYes ? 0 : (decoded.args.isBuy ? shareDelta : -shareDelta),
      blockNumber: log.blockNumber!,
    })
  }

  if (eventName === 'WinningsRedeemed') {
    await upsertBalanceRow({
      walletAddress: String(decoded.args.trader),
      marketRef: 'collateral',
      collateralDelta: formatTokenDisplay(decoded.args.collateralAmount),
      blockNumber: log.blockNumber!,
    })
  }

  return { marketEvents: 1 }
}

async function handleFaucetLog(target: IndexedAddressTarget, log: Awaited<ReturnType<PublicClient['getLogs']>>[number]) {
  let decoded: ReturnType<typeof decodeEventLog<typeof SEASON4_FAUCET_ABI>>
  try {
    decoded = decodeEventLog({
      abi: SEASON4_FAUCET_ABI,
      data: log.data,
      topics: log.topics,
    })
  } catch {
    return { faucetEvents: 0 }
  }

  const inserted = await persistEventRow({
    chainId: getSeason4OnchainConfig().chainId,
    contractAddress: target.address,
    txHash: log.transactionHash!,
    blockHash: log.blockHash ?? null,
    blockNumber: log.blockNumber!,
    logIndex: log.logIndex!,
    eventName: decoded.eventName,
    walletAddress: String(decoded.args.recipient),
    payload: decoded.args as Record<string, unknown>,
  })

  if (!inserted) return { faucetEvents: 0 }

  const walletAddress = lowercaseAddress(String(decoded.args.recipient)) ?? String(decoded.args.recipient)
  const [claim] = await db.select({
    id: onchainFaucetClaims.id,
  })
    .from(onchainFaucetClaims)
    .where(and(
      eq(onchainFaucetClaims.walletAddress, walletAddress),
      eq(onchainFaucetClaims.txHash, log.transactionHash!),
    ))
    .limit(1)

  if (claim) {
    await db.update(onchainFaucetClaims)
      .set({
        status: 'confirmed',
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(onchainFaucetClaims.id, claim.id))
  }

  await upsertBalanceRow({
    walletAddress,
    marketRef: 'collateral',
    collateralDelta: formatTokenDisplay(decoded.args.amount),
    blockNumber: log.blockNumber!,
  })

  return { faucetEvents: 1 }
}

export async function syncSeason4OnchainIndex(): Promise<Season4IndexerSummary> {
  const config = requireSeason4OnchainConfig()
  const client = createClient()
  const latestBlock = await client.getBlockNumber()
  const targets: IndexedAddressTarget[] = [
    {
      cursorId: 'season4-manager',
      address: config.managerAddress,
      kind: 'manager',
    },
    {
      cursorId: 'season4-faucet',
      address: config.faucetAddress,
      kind: 'faucet',
    },
  ]

  let logsIndexed = 0
  let marketEvents = 0
  let faucetEvents = 0
  const fromBlocks: Record<string, string> = {}

  for (const target of targets) {
    const cursorBlock = await getCursorBlock(target, config.indexFromBlock)
    const fromBlock = cursorBlock === BigInt(0) ? config.indexFromBlock : cursorBlock + BigInt(1)
    fromBlocks[target.cursorId] = fromBlock.toString()

    if (fromBlock > latestBlock) {
      await saveCursor(target, latestBlock)
      continue
    }

    const logs = await fetchLogsInChunks({
      client,
      address: target.address,
      fromBlock,
      toBlock: latestBlock,
    })

    for (const log of logs) {
      if (!log.transactionHash || log.blockNumber == null || log.logIndex == null) continue

      if (target.kind === 'manager') {
        const result = await handleManagerLog(target, log)
        marketEvents += result.marketEvents
      } else {
        const result = await handleFaucetLog(target, log)
        faucetEvents += result.faucetEvents
      }
      logsIndexed += 1
    }

    await saveCursor(target, latestBlock)
  }

  return {
    chainId: config.chainId,
    latestBlock: latestBlock.toString(),
    fromBlocks,
    logsIndexed,
    marketEvents,
    faucetEvents,
  }
}
