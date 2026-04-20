import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  http,
  maxUint256,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { db } from '@/lib/db'
import { MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { ConfigurationError, ExternalServiceError, ValidationError } from '@/lib/errors'
import { MOCK_USDC_ABI, PREDICTION_MARKET_MANAGER_ABI, SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import {
  getSeason4DeployerPrivateKey,
  requireSeason4OnchainConfig,
  getSeason4OnchainConfig,
} from '@/lib/onchain/config'
import { syncSeason4OnchainIndex, type Season4IndexerSummary } from '@/lib/onchain/indexer'
import { getModelDecisionGeneratorDisabledReason, MODEL_DECISION_GENERATORS } from '@/lib/predictions/model-decision-generators'
import { getSeason4ModelStartingBankrollDisplay } from '@/lib/season4-bankroll-config'
import { MOCK_USDC_DECIMALS } from '@/lib/season4-faucet-config'
import { getSeason4ModelName } from '@/lib/season4-model-labels'
import {
  DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY,
  getMarketRuntimeConfig,
} from '@/lib/markets/runtime-config'
import {
  applySeason4TradeToState,
  buildSeason4ModelDecisionInput,
  buildSeason4TradeExecution,
  buildSeason4TrialFacts,
  capSeason4TradeDecision,
  calculateSeason4PriceYes,
  generateSeason4ModelDecision,
  season4AtomicToDisplay,
  type Season4DecisionTrialFacts,
} from '@/lib/season4-model-decisions'
import type { ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'
import {
  onchainBalances,
  onchainEvents,
  onchainIndexerCursors,
  onchainMarkets,
  onchainModelWallets,
  trialQuestions,
  trials,
} from '@/lib/schema'
import { getSeason4ModelTradeAmountDisplay } from '@/lib/season4-model-trade-config'

const DEFAULT_MARKET_LIQUIDITY_B = season4LiquidityBDisplayToAtomic(DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY)
const DEFAULT_MAX_MARKETS_PER_CYCLE = 1
const DEFAULT_MODEL_ETH_TOP_UP_WEI = BigInt(20_000_000_000_000)
const MIN_MODEL_ETH_BALANCE_WEI = BigInt(10_000_000_000_000)
const PRICE_E18 = BigInt('1000000000000000000')
const PRICE_INPUT_SCALE = BigInt(1_000_000)
const DEFAULT_INITIAL_PRICE_YES_E18 = PRICE_E18 / BigInt(2)
const RPC_BLOCK_POLL_ATTEMPTS = 10
const RPC_BLOCK_POLL_DELAY_MS = 1_000
const CONTRACT_OWNER_ABI = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export type Season4OpsMarketRow = {
  id: string
  marketSlug: string
  title: string
  onchainMarketId: string | null
  status: string
  closeTime: string | null
  resolvedOutcome: 'YES' | 'NO' | null
  metadataUri: string | null
  deployTxHash: string | null
  resolveTxHash: string | null
  totalTrades: number
  updatedAt: string
}

export type Season4OpsModelWalletRow = {
  id: string
  modelKey: ModelId
  displayName: string
  walletAddress: string | null
  fundingStatus: string
  bankrollDisplay: number
  collateralBalanceDisplay: number
  openPositionsCount: number
  hasPrivateKeyConfigured: boolean
}

export type Season4OpsDashboardData = {
  chain: {
    target: 'main' | 'toy'
    enabled: boolean
    chainId: number
    chainName: string
    managerAddress: string | null
    faucetAddress: string | null
    collateralTokenAddress: string | null
    indexFromBlock: string
  }
  credentials: {
    deployerConfigured: boolean
    configuredModelWallets: number
    configuredModelPrivateKeys: number
  }
  automation: {
    indexerIntervalSeconds: number
    tradeAmountDisplay: number
    maxMarketsPerCycle: number
  }
  counts: {
    markets: number
    openMarkets: number
    resolvedMarkets: number
    indexedEvents: number
    indexedBalances: number
    fundedModelWallets: number
  }
  cursors: Array<{
    id: string
    contractAddress: string
    lastSyncedBlock: string
    latestSeenBlock: string
    updatedAt: string
  }>
  markets: Season4OpsMarketRow[]
  modelWallets: Season4OpsModelWalletRow[]
}

export type Season4MarketCreateInput = {
  marketSlug: string
  title: string
  metadataUri?: string | null
  closeTime: string
  liquidityB?: string | number | bigint | null
  trialQuestionId?: string | null
  openingProbability?: number | null
}

export type Season4MarketResolveInput = {
  identifier: string
  outcome: 'YES' | 'NO'
}

export type Season4SeedModelWalletInput = {
  bankrollDisplay?: number | null
  walletMap?: Record<string, string | null | undefined> | null
}

export type Season4SeedModelWalletSummary = {
  chainId: number
  bankrollDisplay: number
  seededModels: Array<{
    modelKey: ModelId
    walletAddress: string | null
    fundingStatus: string
  }>
}

export type Season4ModelWalletFundingSummary = {
  chainId: number
  deployer: string
  funded: Array<{
    modelKey: ModelId
    walletAddress: string
    claimTxHash: string | null
    gasTopUpTxHash: string | null
    gasBalanceEth: string
  }>
}

export type Season4ModelCycleSummary = {
  chainId: number
  tradeAmountDisplay: number
  maxMarketsPerCycle: number
  configuredModels: number
  configuredMarkets: number
  tradesExecuted: number
  trades: Array<{
    modelKey: ModelId
    walletAddress: string
    marketId: string
    marketSlug: string
    action: 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO'
    requestedAction: 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO' | 'HOLD'
    requestedAmountDisplay: number
    executedAmountDisplay: number
    shareAmountDisplay: number
    binaryCall: 'yes' | 'no'
    confidencePercent: number
    explanation: string
    reasoning: string
    priceYes: number
    txHash: string
    approvedTxHash: string | null
  }>
  skipped: Array<{
    modelKey: string
    marketSlug?: string | null
    reason: string
  }>
  indexSummary: Season4IndexerSummary | null
}

export type RunSeason4ModelCycleOptions = {
  modelKeys?: ModelId[]
  marketSlugs?: string[]
  decisions?: Array<{
    modelKey: ModelId
    marketSlug: string
    decision: ModelDecisionResult
  }>
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getSafeErrorMessage(error: unknown): string {
  const candidates: unknown[] = []
  const current = error as {
    shortMessage?: unknown
    details?: unknown
    message?: unknown
    cause?: {
      shortMessage?: unknown
      details?: unknown
      message?: unknown
    }
  } | null

  candidates.push(current?.shortMessage, current?.details, current?.message)
  candidates.push(current?.cause?.shortMessage, current?.cause?.details, current?.cause?.message)

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const message = candidate.replace(/\s+/g, ' ').trim()
    if (message) return message
  }

  return 'Unknown error'
}

function createExposedOnchainError(prefix: string, error: unknown): ExternalServiceError {
  return new ExternalServiceError(`${prefix}: ${getSafeErrorMessage(error)}`, {
    cause: error,
    expose: true,
  })
}

function normalizeAddress(value: string | null | undefined): Address | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() as Address : null
}

function normalizePrivateKey(value: string | null | undefined): Hex | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  return /^0x[a-fA-F0-9]{64}$/.test(trimmed) ? trimmed as Hex : null
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parsePositiveBigInt(value: string | number | bigint | null | undefined, fallback: bigint): bigint {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = typeof value === 'bigint' ? value : BigInt(value)
  if (parsed <= BigInt(0)) {
    throw new ValidationError('Liquidity B must be greater than zero')
  }
  return parsed
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRpcBlock(getLatestBlock: () => Promise<bigint>, targetBlock: bigint): Promise<void> {
  for (let attempt = 0; attempt < RPC_BLOCK_POLL_ATTEMPTS; attempt += 1) {
    const latestBlock = await getLatestBlock()
    if (latestBlock >= targetBlock) return
    await sleep(RPC_BLOCK_POLL_DELAY_MS)
  }
}

function season4LiquidityBDisplayToAtomic(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError('Season 4 liquidity B must be greater than zero')
  }

  const atomic = Math.round(value * MOCK_USDC_DECIMALS)
  if (!Number.isSafeInteger(atomic) || atomic <= 0) {
    throw new ValidationError('Season 4 liquidity B is outside the supported mock USDC range')
  }

  return BigInt(atomic)
}

async function getDefaultMarketLiquidityB(): Promise<bigint> {
  const runtimeConfig = await getMarketRuntimeConfig()
  return season4LiquidityBDisplayToAtomic(runtimeConfig.season4MarketLiquidityBDisplay)
}

export function toSeason4InitialPriceYesE18(openingProbability: number | null | undefined): bigint {
  if (openingProbability === null || openingProbability === undefined) {
    return DEFAULT_INITIAL_PRICE_YES_E18
  }

  if (!Number.isFinite(openingProbability) || openingProbability <= 0 || openingProbability >= 1) {
    throw new ValidationError('Opening probability must be greater than 0 and less than 1')
  }

  const scaled = BigInt(Math.round(openingProbability * Number(PRICE_INPUT_SCALE)))
  if (scaled <= BigInt(0) || scaled >= PRICE_INPUT_SCALE) {
    throw new ValidationError('Opening probability must be greater than 0 and less than 1')
  }

  return (scaled * PRICE_E18) / PRICE_INPUT_SCALE
}

function parseOptionalWalletMap(rawMap: Record<string, string | null | undefined> | null | undefined): Partial<Record<ModelId, Address>> {
  const normalized = new Map<ModelId, Address>()
  for (const [modelKey, walletAddress] of Object.entries(rawMap ?? {})) {
    if (!isModelId(modelKey)) continue
    const address = normalizeAddress(walletAddress)
    if (address) {
      normalized.set(modelKey, address)
    }
  }
  return Object.fromEntries(normalized)
}

function parseEnvWalletMap(): Partial<Record<ModelId, Address>> {
  const raw = trimOrNull(process.env.SEASON4_MODEL_WALLETS_JSON)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, string | null | undefined>
    return parseOptionalWalletMap(parsed)
  } catch {
    throw new ConfigurationError('SEASON4_MODEL_WALLETS_JSON must be valid JSON')
  }
}

function parseEnvModelPrivateKeys(): Partial<Record<ModelId, Hex>> {
  const raw = trimOrNull(process.env.SEASON4_MODEL_PRIVATE_KEYS_JSON)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, string | null | undefined>
    const normalized: Partial<Record<ModelId, Hex>> = {}
    for (const [modelKey, privateKey] of Object.entries(parsed)) {
      if (!isModelId(modelKey)) continue
      const key = normalizePrivateKey(privateKey)
      if (key) {
        normalized[modelKey] = key
      }
    }
    return normalized
  } catch {
    throw new ConfigurationError('SEASON4_MODEL_PRIVATE_KEYS_JSON must be valid JSON')
  }
}

export function parseModelTradeAmountDisplay(): number {
  return getSeason4ModelTradeAmountDisplay()
}

function parseMaxMarketsPerCycle(): number {
  const raw = trimOrNull(process.env.SEASON4_MODEL_MAX_MARKETS_PER_CYCLE)
  if (!raw) return DEFAULT_MAX_MARKETS_PER_CYCLE
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigurationError('SEASON4_MODEL_MAX_MARKETS_PER_CYCLE must be a positive integer')
  }
  return parsed
}

export function parseIndexerIntervalSeconds(): number {
  const raw = trimOrNull(process.env.SEASON4_INDEXER_INTERVAL_SECONDS)
  if (!raw) return 30
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigurationError('SEASON4_INDEXER_INTERVAL_SECONDS must be a positive integer')
  }
  return parsed
}

function getSiteUrl(): string {
  return trimOrNull(process.env.SITE_URL)
    ?? trimOrNull(process.env.NEXT_PUBLIC_SITE_URL)
    ?? 'https://endpointarena.com'
}

function createOpsClients() {
  const config = requireSeason4OnchainConfig()
  const privateKey = getSeason4DeployerPrivateKey(config.target)
  if (!privateKey) {
    throw new ConfigurationError(
      config.target === 'toy'
        ? 'SEASON4_TOY_DEPLOYER_PRIVATE_KEY or SEASON4_DEPLOYER_PRIVATE_KEY is not configured'
        : 'SEASON4_DEPLOYER_PRIVATE_KEY is not configured',
    )
  }

  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })

  return { config, account, publicClient, walletClient }
}

async function assertSeason4MarketDeploymentReady(input: {
  metadataUri: string
  closeTime: Date
  liquidityB: bigint
  initialPriceYesE18: bigint
}) {
  const clients = createOpsClients()
  const { config, account, publicClient } = clients
  const issues: string[] = []

  try {
    const actualChainId = await publicClient.getChainId()
    if (actualChainId !== config.chainId) {
      issues.push(`RPC returned chain ${actualChainId}, expected ${config.chainId}`)
    }
  } catch (error) {
    issues.push(`RPC chain check failed: ${getSafeErrorMessage(error)}`)
  }

  const contractChecks = [
    ['market manager', config.managerAddress],
    ['faucet', config.faucetAddress],
    ['collateral token', config.collateralTokenAddress],
  ] as const
  for (const [label, address] of contractChecks) {
    try {
      const code = await publicClient.getCode({ address })
      if (!code || code === '0x') {
        issues.push(`${label} ${address} has no contract code`)
      }
    } catch (error) {
      issues.push(`${label} code check failed: ${getSafeErrorMessage(error)}`)
    }
  }

  try {
    const owner = await publicClient.readContract({
      address: config.managerAddress,
      abi: CONTRACT_OWNER_ABI,
      functionName: 'owner',
    })
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      issues.push(`deployer ${account.address} is not the market manager owner (${owner})`)
    }
  } catch (error) {
    issues.push(`market manager owner check failed: ${getSafeErrorMessage(error)}`)
  }

  try {
    const [balance, gasPrice, estimatedGas] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.getGasPrice(),
      publicClient.estimateContractGas({
        address: config.managerAddress,
        abi: PREDICTION_MARKET_MANAGER_ABI,
        functionName: 'createMarket',
        args: [
          config.collateralTokenAddress,
          input.metadataUri,
          BigInt(Math.floor(input.closeTime.getTime() / 1000)),
          input.liquidityB,
          input.initialPriceYesE18,
        ],
        account: account.address,
      }),
    ])
    const estimatedCost = estimatedGas * gasPrice
    if (balance <= estimatedCost) {
      issues.push(`deployer has ${formatEther(balance)} ETH, estimated createMarket gas needs about ${formatEther(estimatedCost)} ETH`)
    }
  } catch (error) {
    issues.push(
      `createMarket gas simulation failed: ${getSafeErrorMessage(error)}; verify the Season 4 manager address points to the current initial-price-aware contract`
    )
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `${config.target === 'toy' ? 'Toy DB ' : ''}Season 4 Base Sepolia preflight failed: ${issues.join('; ')}`
    )
  }

  return clients
}

async function loadTradeCounts(): Promise<Map<string, number>> {
  const rows = await db.select({
    marketRef: onchainEvents.marketRef,
    count: sql<number>`count(*)::int`,
  })
    .from(onchainEvents)
    .where(eq(onchainEvents.eventName, 'TradeExecuted'))
    .groupBy(onchainEvents.marketRef)

  return new Map(rows.flatMap((row) => {
    const marketId = trimOrNull(row.marketRef)
    return marketId ? [[marketId, row.count ?? 0] as const] : []
  }))
}

async function loadModelBalanceRows() {
  return db.select({
    modelKey: onchainBalances.modelKey,
    marketRef: onchainBalances.marketRef,
    collateralDisplay: onchainBalances.collateralDisplay,
    yesShares: onchainBalances.yesShares,
    noShares: onchainBalances.noShares,
  })
    .from(onchainBalances)
    .where(sql`${onchainBalances.modelKey} is not null`)
}

async function loadLiveModelWalletCollateralBalances(walletAddresses: string[]): Promise<Map<string, number>> {
  const config = getSeason4OnchainConfig()
  const balances = new Map<string, number>()
  if (!config.enabled || !config.collateralTokenAddress || walletAddresses.length === 0) {
    return balances
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl ?? undefined),
  })

  await Promise.all(walletAddresses.map(async (walletAddress) => {
    try {
      const rawBalance = await publicClient.readContract({
        address: config.collateralTokenAddress!,
        abi: MOCK_USDC_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
      }) as bigint
      balances.set(walletAddress.toLowerCase(), season4AtomicToDisplay(rawBalance))
    } catch {
      // Fall back to mirrored balances if a live chain read fails.
    }
  }))

  return balances
}

export async function loadLiveModelWalletPortfolioBalances(input: {
  modelKeys: ModelId[]
  marketIds?: string[]
}): Promise<Map<ModelId, {
  walletAddress: string
  collateralBalanceDisplay: number
  positionsByMarketId: Map<string, {
    yesSharesHeld: number
    noSharesHeld: number
  }>
}>> {
  const modelKeys = Array.from(new Set(input.modelKeys))
  const marketIds = Array.from(new Set(input.marketIds ?? []))
    .map((marketId) => marketId.trim())
    .filter((marketId) => marketId.length > 0)
  const balances = new Map<ModelId, {
    walletAddress: string
    collateralBalanceDisplay: number
    positionsByMarketId: Map<string, {
      yesSharesHeld: number
      noSharesHeld: number
    }>
  }>()
  if (modelKeys.length === 0) return balances

  const config = getSeason4OnchainConfig()
  if (!config.enabled || !config.collateralTokenAddress || !config.managerAddress) {
    return balances
  }

  const walletRows = await db.select({
    modelKey: onchainModelWallets.modelKey,
    walletAddress: onchainModelWallets.walletAddress,
  })
    .from(onchainModelWallets)
    .where(inArray(onchainModelWallets.modelKey, modelKeys))

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl ?? undefined),
  })

  await Promise.all(walletRows.map(async (row) => {
    if (!isModelId(row.modelKey) || !row.walletAddress) return

    const walletAddress = row.walletAddress.toLowerCase()
    try {
      const collateralBalance = await publicClient.readContract({
        address: config.collateralTokenAddress!,
        abi: MOCK_USDC_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
      }) as bigint

      const positionsByMarketId = new Map<string, {
        yesSharesHeld: number
        noSharesHeld: number
      }>()

      await Promise.all(marketIds.map(async (marketId) => {
        try {
          const [yesBalance, noBalance] = await Promise.all([
            publicClient.readContract({
              address: config.managerAddress!,
              abi: PREDICTION_MARKET_MANAGER_ABI,
              functionName: 'yesBalances',
              args: [BigInt(marketId), walletAddress as Address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: config.managerAddress!,
              abi: PREDICTION_MARKET_MANAGER_ABI,
              functionName: 'noBalances',
              args: [BigInt(marketId), walletAddress as Address],
            }) as Promise<bigint>,
          ])
          positionsByMarketId.set(marketId, {
            yesSharesHeld: season4AtomicToDisplay(yesBalance),
            noSharesHeld: season4AtomicToDisplay(noBalance),
          })
        } catch {
          // Fall back to mirrored position rows for this market if the direct read fails.
        }
      }))

      balances.set(row.modelKey, {
        walletAddress,
        collateralBalanceDisplay: season4AtomicToDisplay(collateralBalance),
        positionsByMarketId,
      })
    } catch {
      // Fall back to mirrored collateral rows for this wallet if the direct read fails.
    }
  }))

  return balances
}

export async function loadContractMarketStates(marketIds: string[]): Promise<Map<string, {
  qYesDisplay: number
  qNoDisplay: number
  liquidityBDisplay: number
  priceYes: number
}>> {
  const config = getSeason4OnchainConfig()
  const states = new Map<string, {
    qYesDisplay: number
    qNoDisplay: number
    liquidityBDisplay: number
    priceYes: number
  }>()
  if (!config.enabled || !config.managerAddress || marketIds.length === 0) return states

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl ?? undefined),
  })

  await Promise.all(marketIds.map(async (marketId) => {
    try {
      const marketState = await publicClient.readContract({
        address: config.managerAddress!,
        abi: PREDICTION_MARKET_MANAGER_ABI,
        functionName: 'markets',
        args: [BigInt(marketId)],
      }) as readonly [`0x${string}`, string, bigint, bigint, bigint, bigint, number, boolean, boolean]

      const liquidityB = marketState[3]
      const qYes = marketState[4]
      const qNo = marketState[5]
      const exists = marketState[8]
      if (!exists) return

      const qYesDisplay = season4AtomicToDisplay(qYes)
      const qNoDisplay = season4AtomicToDisplay(qNo)
      const liquidityBDisplay = season4AtomicToDisplay(liquidityB)
      states.set(marketId, {
        qYesDisplay,
        qNoDisplay,
        liquidityBDisplay,
        priceYes: calculateSeason4PriceYes({
          qYesDisplay,
          qNoDisplay,
          liquidityBDisplay,
        }),
      })
    } catch {
      // Leave state missing when public chain reads fail.
    }
  }))

  return states
}

export async function getSeason4OpsDashboardData(options: { sync?: boolean } = {}): Promise<Season4OpsDashboardData> {
  if (options.sync && getSeason4OnchainConfig().enabled) {
    await syncSeason4OnchainIndex()
  }

  const config = getSeason4OnchainConfig()
  const modelPrivateKeys = parseEnvModelPrivateKeys()
  const modelWalletMap = parseEnvWalletMap()

  const [marketRows, tradeCounts, modelWalletRows, balanceRows, cursorRows, countRows] = await Promise.all([
    db.select({
      id: onchainMarkets.id,
      marketSlug: onchainMarkets.marketSlug,
      title: onchainMarkets.title,
      onchainMarketId: onchainMarkets.onchainMarketId,
      status: onchainMarkets.status,
      closeTime: onchainMarkets.closeTime,
      resolvedOutcome: onchainMarkets.resolvedOutcome,
      metadataUri: onchainMarkets.metadataUri,
      deployTxHash: onchainMarkets.deployTxHash,
      resolveTxHash: onchainMarkets.resolveTxHash,
      updatedAt: onchainMarkets.updatedAt,
    })
      .from(onchainMarkets)
      .orderBy(desc(onchainMarkets.updatedAt), desc(onchainMarkets.createdAt)),
    loadTradeCounts(),
    db.select({
      id: onchainModelWallets.id,
      modelKey: onchainModelWallets.modelKey,
      displayName: onchainModelWallets.displayName,
      walletAddress: onchainModelWallets.walletAddress,
      fundingStatus: onchainModelWallets.fundingStatus,
      bankrollDisplay: onchainModelWallets.bankrollDisplay,
    })
      .from(onchainModelWallets)
      .orderBy(onchainModelWallets.displayName),
    loadModelBalanceRows(),
    db.select({
      id: onchainIndexerCursors.id,
      contractAddress: onchainIndexerCursors.contractAddress,
      lastSyncedBlock: onchainIndexerCursors.lastSyncedBlock,
      latestSeenBlock: onchainIndexerCursors.latestSeenBlock,
      updatedAt: onchainIndexerCursors.updatedAt,
    })
      .from(onchainIndexerCursors)
      .orderBy(onchainIndexerCursors.id),
    Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(onchainMarkets),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainEvents),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainBalances),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainModelWallets).where(eq(onchainModelWallets.fundingStatus, 'funded')),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainMarkets).where(inArray(onchainMarkets.status, ['deployed', 'closed'])),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainMarkets).where(eq(onchainMarkets.status, 'resolved')),
    ]),
  ])

  const liveCollateralByWallet = await loadLiveModelWalletCollateralBalances(
    modelWalletRows
      .flatMap((row) => row.walletAddress ? [row.walletAddress] : []),
  )

  const balancesByModel = new Map<string, Array<{ marketRef: string; collateralDisplay: number; yesShares: number; noShares: number }>>()
  for (const row of balanceRows) {
    if (!row.modelKey) continue
    const current = balancesByModel.get(row.modelKey) ?? []
    current.push({
      marketRef: row.marketRef,
      collateralDisplay: row.collateralDisplay ?? 0,
      yesShares: row.yesShares ?? 0,
      noShares: row.noShares ?? 0,
    })
    balancesByModel.set(row.modelKey, current)
  }

  const modelWallets: Season4OpsModelWalletRow[] = modelWalletRows.flatMap((row) => (
    isModelId(row.modelKey)
      ? [{
          id: row.id,
          modelKey: row.modelKey,
          displayName: row.displayName,
          walletAddress: row.walletAddress,
          fundingStatus: row.fundingStatus,
          bankrollDisplay: row.bankrollDisplay ?? 0,
          collateralBalanceDisplay: row.walletAddress
            ? (
                liveCollateralByWallet.get(row.walletAddress.toLowerCase())
                ?? (balancesByModel.get(row.modelKey) ?? [])
                  .filter((entry) => entry.marketRef === 'collateral')
                  .reduce((sum, entry) => sum + entry.collateralDisplay, 0)
              )
            : (balancesByModel.get(row.modelKey) ?? [])
              .filter((entry) => entry.marketRef === 'collateral')
              .reduce((sum, entry) => sum + entry.collateralDisplay, 0),
          openPositionsCount: (balancesByModel.get(row.modelKey) ?? [])
            .filter((entry) => entry.marketRef !== 'collateral' && (entry.yesShares > 0 || entry.noShares > 0))
            .length,
          hasPrivateKeyConfigured: Boolean(modelPrivateKeys[row.modelKey]),
        }]
      : []
  ))

  const markets: Season4OpsMarketRow[] = marketRows.map((row) => ({
    id: row.id,
    marketSlug: row.marketSlug,
    title: row.title,
    onchainMarketId: row.onchainMarketId,
    status: row.status,
    closeTime: row.closeTime ? row.closeTime.toISOString() : null,
    resolvedOutcome: row.resolvedOutcome as 'YES' | 'NO' | null,
    metadataUri: row.metadataUri,
    deployTxHash: row.deployTxHash,
    resolveTxHash: row.resolveTxHash,
    totalTrades: row.onchainMarketId ? (tradeCounts.get(row.onchainMarketId) ?? 0) : 0,
    updatedAt: row.updatedAt.toISOString(),
  }))

  const [marketCount, eventCount, balanceCount, fundedModelCount, openMarketCount, resolvedMarketCount] = countRows

  return {
    chain: {
      target: config.target,
      enabled: config.enabled,
      chainId: config.chainId,
      chainName: config.chainName,
      managerAddress: config.managerAddress,
      faucetAddress: config.faucetAddress,
      collateralTokenAddress: config.collateralTokenAddress,
      indexFromBlock: config.indexFromBlock.toString(),
    },
    credentials: {
      deployerConfigured: Boolean(getSeason4DeployerPrivateKey(config.target)),
      configuredModelWallets: Object.keys(modelWalletMap).length,
      configuredModelPrivateKeys: Object.keys(modelPrivateKeys).length,
    },
    automation: {
      indexerIntervalSeconds: parseIndexerIntervalSeconds(),
      tradeAmountDisplay: parseModelTradeAmountDisplay(),
      maxMarketsPerCycle: parseMaxMarketsPerCycle(),
    },
    counts: {
      markets: marketCount[0]?.count ?? 0,
      openMarkets: openMarketCount[0]?.count ?? 0,
      resolvedMarkets: resolvedMarketCount[0]?.count ?? 0,
      indexedEvents: eventCount[0]?.count ?? 0,
      indexedBalances: balanceCount[0]?.count ?? 0,
      fundedModelWallets: fundedModelCount[0]?.count ?? 0,
    },
    cursors: cursorRows.map((row) => ({
      id: row.id,
      contractAddress: row.contractAddress,
      lastSyncedBlock: row.lastSyncedBlock,
      latestSeenBlock: row.latestSeenBlock,
      updatedAt: row.updatedAt.toISOString(),
    })),
    markets,
    modelWallets,
  }
}

export async function createSeason4Market(input: Season4MarketCreateInput) {
  const slug = normalizeSlug(input.marketSlug)
  if (!slug) {
    throw new ValidationError('Market slug is required')
  }
  const title = trimOrNull(input.title)
  if (!title) {
    throw new ValidationError('Market title is required')
  }

  const closeTime = new Date(input.closeTime)
  if (Number.isNaN(closeTime.getTime()) || closeTime.getTime() <= Date.now()) {
    throw new ValidationError('Close time must be a valid future date')
  }

  const metadataUri = trimOrNull(input.metadataUri) ?? `${getSiteUrl().replace(/\/$/, '')}/season4/markets/${slug}`
  const defaultLiquidityB = input.liquidityB == null || input.liquidityB === ''
    ? await getDefaultMarketLiquidityB()
    : DEFAULT_MARKET_LIQUIDITY_B
  const liquidityB = parsePositiveBigInt(input.liquidityB, defaultLiquidityB)
  const initialPriceYesE18 = toSeason4InitialPriceYesE18(input.openingProbability)
  const trialQuestionId = trimOrNull(input.trialQuestionId)
  if (!trialQuestionId) {
    throw new ValidationError('Season 4 market creation requires a linked trial question')
  }

  const linkedQuestion = await db.query.trialQuestions.findFirst({
    columns: {
      id: true,
      status: true,
      isBettable: true,
      outcome: true,
    },
    where: eq(trialQuestions.id, trialQuestionId),
  })
  if (!linkedQuestion) {
    throw new ValidationError('Linked trial question was not found')
  }
  if (linkedQuestion.status !== 'live' || !linkedQuestion.isBettable || linkedQuestion.outcome !== 'Pending') {
    throw new ValidationError('Season 4 markets can only be created for live, bettable, unresolved trial questions')
  }

  const existing = await db.query.onchainMarkets.findFirst({
    columns: { id: true, onchainMarketId: true },
    where: eq(onchainMarkets.marketSlug, slug),
  })

  if (existing?.onchainMarketId) {
    throw new ValidationError('That season 4 slug is already in use')
  }

  const { config, account, publicClient, walletClient } = await assertSeason4MarketDeploymentReady({
    metadataUri,
    closeTime,
    liquidityB,
    initialPriceYesE18,
  })
  let createTxHash: Hex
  let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>
  try {
    createTxHash = await walletClient.writeContract({
      address: config.managerAddress,
      abi: PREDICTION_MARKET_MANAGER_ABI,
      functionName: 'createMarket',
      args: [
        config.collateralTokenAddress,
        metadataUri,
        BigInt(Math.floor(closeTime.getTime() / 1000)),
        liquidityB,
        initialPriceYesE18,
      ],
      account,
    })

    receipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash })
  } catch (error) {
    throw createExposedOnchainError('Base Sepolia market deployment failed', error)
  }

  let onchainMarketId: string | null = null
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: PREDICTION_MARKET_MANAGER_ABI,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'MarketCreated') {
        onchainMarketId = decoded.args.marketId.toString()
        break
      }
    } catch {
      continue
    }
  }

  if (!onchainMarketId) {
    throw new ValidationError('Unable to determine the onchain market id from the creation transaction')
  }

  try {
    await syncSeason4OnchainIndex()
  } catch (error) {
    console.warn(`[season4] Onchain index sync failed after market creation ${onchainMarketId}: ${getSafeErrorMessage(error)}`)
  }

  const existingRow = await db.query.onchainMarkets.findFirst({
    columns: { id: true },
    where: and(
      eq(onchainMarkets.chainId, config.chainId),
      eq(onchainMarkets.managerAddress, config.managerAddress),
      eq(onchainMarkets.onchainMarketId, onchainMarketId),
    ),
  })

  const values = {
    trialQuestionId,
    marketSlug: slug,
    title,
    metadataUri,
    closeTime,
    status: 'deployed' as const,
    deployTxHash: createTxHash,
    updatedAt: new Date(),
  }

  if (existingRow) {
    await db.update(onchainMarkets)
      .set(values)
      .where(eq(onchainMarkets.id, existingRow.id))
  } else {
    await db.insert(onchainMarkets).values({
      trialQuestionId,
      chainId: config.chainId,
      managerAddress: config.managerAddress,
      collateralTokenAddress: config.collateralTokenAddress,
      marketSlug: slug,
      title,
      metadataUri,
      onchainMarketId,
      executionMode: 'onchain_lmsr',
      positionModel: 'onchain_app_restricted',
      status: 'deployed',
      closeTime,
      deployTxHash: createTxHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  return {
    marketSlug: slug,
    title,
    metadataUri,
    onchainMarketId,
    createTxHash,
    openingProbability: Number(initialPriceYesE18) / Number(PRICE_E18),
  }
}

export async function resolveSeason4Market(input: Season4MarketResolveInput) {
  const identifier = trimOrNull(input.identifier)
  if (!identifier) {
    throw new ValidationError('Market identifier is required')
  }

  const market = await db.query.onchainMarkets.findFirst({
    columns: {
      id: true,
      marketSlug: true,
      onchainMarketId: true,
      status: true,
    },
    where: or(
      eq(onchainMarkets.marketSlug, identifier),
      eq(onchainMarkets.onchainMarketId, identifier),
    ),
  })

  if (!market?.onchainMarketId) {
    throw new ValidationError('Season 4 market not found or not deployed onchain')
  }
  if (market.status === 'resolved') {
    throw new ValidationError('That market is already resolved')
  }

  const { config, account, publicClient, walletClient } = createOpsClients()
  const resolveTxHash = await walletClient.writeContract({
    address: config.managerAddress,
    abi: PREDICTION_MARKET_MANAGER_ABI,
    functionName: 'resolveMarket',
    args: [BigInt(market.onchainMarketId), input.outcome === 'YES'],
    account,
  })
  await publicClient.waitForTransactionReceipt({ hash: resolveTxHash })
  await syncSeason4OnchainIndex()

  return {
    marketSlug: market.marketSlug,
    onchainMarketId: market.onchainMarketId,
    resolveTxHash,
    outcome: input.outcome,
  }
}

export async function syncSeason4IndexerNow() {
  return syncSeason4OnchainIndex()
}

export async function seedSeason4ModelWallets(input: Season4SeedModelWalletInput = {}): Promise<Season4SeedModelWalletSummary> {
  const walletMap = Object.keys(input.walletMap ?? {}).length > 0
    ? parseOptionalWalletMap(input.walletMap)
    : parseEnvWalletMap()
  const runtimeConfig = await getMarketRuntimeConfig().catch(() => null)
  const bankrollDisplay = typeof input.bankrollDisplay === 'number' && Number.isFinite(input.bankrollDisplay) && input.bankrollDisplay >= 0
    ? input.bankrollDisplay
    : runtimeConfig?.season4StartingBankrollDisplay ?? getSeason4ModelStartingBankrollDisplay()

  const { chainId } = getSeason4OnchainConfig()
  const summary: Season4SeedModelWalletSummary['seededModels'] = []

  for (const modelKey of MODEL_IDS) {
    const walletAddress = walletMap[modelKey] ?? null
    const existing = await db.query.onchainModelWallets.findFirst({
      columns: { id: true },
      where: eq(onchainModelWallets.modelKey, modelKey),
    })

    const values = {
      modelKey,
      displayName: getSeason4ModelName(modelKey),
      chainId,
      walletAddress,
      fundingStatus: walletAddress ? 'funded' : 'pending',
      bankrollDisplay,
      fundedAt: walletAddress ? new Date() : null,
      updatedAt: new Date(),
    } as const

    if (existing) {
      await db.update(onchainModelWallets)
        .set(values)
        .where(eq(onchainModelWallets.id, existing.id))
    } else {
      await db.insert(onchainModelWallets).values(values)
    }

    summary.push({
      modelKey,
      walletAddress,
      fundingStatus: walletAddress ? 'funded' : 'pending',
    })
  }

  return {
    chainId,
    bankrollDisplay,
    seededModels: summary,
  }
}

export async function fundSeason4ModelWallets(): Promise<Season4ModelWalletFundingSummary> {
  const seeded = await seedSeason4ModelWallets()
  const configuredWallets = seeded.seededModels.filter((model) => model.walletAddress)
  if (configuredWallets.length === 0) {
    throw new ValidationError(
      'No model wallet addresses are configured. Set SEASON4_MODEL_WALLETS_JSON and SEASON4_MODEL_PRIVATE_KEYS_JSON, then run Seed model wallets before funding.',
    )
  }

  const { config, account: deployer, publicClient, walletClient } = createOpsClients()

  const funded: Season4ModelWalletFundingSummary['funded'] = []

  for (const model of seeded.seededModels) {
    if (!model.walletAddress) continue

    const walletAddress = model.walletAddress as Address
    let claimTxHash: Hex | null = null
    let gasTopUpTxHash: Hex | null = null

    const canClaim = await publicClient.readContract({
      address: config.faucetAddress,
      abi: SEASON4_FAUCET_ABI,
      functionName: 'canClaim',
      args: [walletAddress],
    }) as boolean

    if (canClaim) {
      claimTxHash = await walletClient.writeContract({
        address: config.faucetAddress,
        abi: SEASON4_FAUCET_ABI,
        functionName: 'claimTo',
        args: [walletAddress],
        account: deployer,
      })
      await publicClient.waitForTransactionReceipt({ hash: claimTxHash })
    }

    const gasBalance = await publicClient.getBalance({ address: walletAddress })
    if (gasBalance < MIN_MODEL_ETH_BALANCE_WEI) {
      const deployerBalance = await publicClient.getBalance({ address: deployer.address })
      if (deployerBalance < DEFAULT_MODEL_ETH_TOP_UP_WEI) {
        throw new ValidationError(
          `Deployer ${deployer.address} is out of Base Sepolia ETH for model-wallet gas top-ups. It has ${formatEther(deployerBalance)} ETH and needs at least ${formatEther(DEFAULT_MODEL_ETH_TOP_UP_WEI)} ETH to top up ${walletAddress}. Fund the deployer, then retry "Fund model wallets".`,
        )
      }

      gasTopUpTxHash = await walletClient.sendTransaction({
        account: deployer,
        to: walletAddress,
        value: DEFAULT_MODEL_ETH_TOP_UP_WEI,
        chain: baseSepolia,
      })
      await publicClient.waitForTransactionReceipt({ hash: gasTopUpTxHash })
    }

    const nextGasBalance = await publicClient.getBalance({ address: walletAddress })
    funded.push({
      modelKey: model.modelKey,
      walletAddress,
      claimTxHash,
      gasTopUpTxHash,
      gasBalanceEth: formatEther(nextGasBalance),
    })
  }

  await syncSeason4OnchainIndex()

  return {
    chainId: config.chainId,
    deployer: deployer.address,
    funded,
  }
}

export async function runSeason4ModelCycle(options: RunSeason4ModelCycleOptions = {}): Promise<Season4ModelCycleSummary> {
  const config = requireSeason4OnchainConfig()
  const privateKeys = parseEnvModelPrivateKeys()
  const tradeAmountDisplay = parseModelTradeAmountDisplay()
  const maxMarketsPerCycle = parseMaxMarketsPerCycle()
  const scopedModelKeys = new Set(options.modelKeys ?? [])
  const scopedMarketSlugs = new Set(options.marketSlugs ?? [])
  const providedDecisionByModelMarket = new Map<string, ModelDecisionResult>(
    (options.decisions ?? []).map((entry) => [`${entry.modelKey}:${entry.marketSlug}`, entry.decision] as const),
  )

  const [marketRows, modelWalletRows] = await Promise.all([
    db.select({
      id: onchainMarkets.id,
      marketSlug: onchainMarkets.marketSlug,
      title: onchainMarkets.title,
      onchainMarketId: onchainMarkets.onchainMarketId,
      status: onchainMarkets.status,
      closeTime: onchainMarkets.closeTime,
      metadataUri: onchainMarkets.metadataUri,
      trialQuestionId: onchainMarkets.trialQuestionId,
      questionPrompt: trialQuestions.prompt,
      trialShortTitle: trials.shortTitle,
      sponsorName: trials.sponsorName,
      sponsorTicker: trials.sponsorTicker,
      exactPhase: trials.exactPhase,
      estPrimaryCompletionDate: trials.estPrimaryCompletionDate,
      indication: trials.indication,
      intervention: trials.intervention,
      primaryEndpoint: trials.primaryEndpoint,
      currentStatus: trials.currentStatus,
      briefSummary: trials.briefSummary,
      nctNumber: trials.nctNumber,
      createdAt: onchainMarkets.createdAt,
    })
      .from(onchainMarkets)
      .leftJoin(trialQuestions, eq(onchainMarkets.trialQuestionId, trialQuestions.id))
      .leftJoin(trials, eq(trialQuestions.trialId, trials.id))
      .where(eq(onchainMarkets.status, 'deployed'))
      .orderBy(desc(onchainMarkets.createdAt)),
    db.select({
      modelKey: onchainModelWallets.modelKey,
      walletAddress: onchainModelWallets.walletAddress,
      fundingStatus: onchainModelWallets.fundingStatus,
      displayName: onchainModelWallets.displayName,
    })
      .from(onchainModelWallets)
      .where(eq(onchainModelWallets.fundingStatus, 'funded'))
      .orderBy(onchainModelWallets.displayName),
  ])

  const scopedMarketRows = scopedMarketSlugs.size > 0
    ? marketRows.filter((row) => scopedMarketSlugs.has(row.marketSlug))
    : marketRows
  const scopedModelWalletRows = scopedModelKeys.size > 0
    ? modelWalletRows.filter((row): row is typeof row & { modelKey: ModelId } => isModelId(row.modelKey) && scopedModelKeys.has(row.modelKey))
    : modelWalletRows

  const marketIds = scopedMarketRows
    .map((row) => trimOrNull(row.onchainMarketId))
    .filter((value): value is string => Boolean(value))
  const contractStateMap = await loadContractMarketStates(marketIds)

  const preflightSkipped: Season4ModelCycleSummary['skipped'] = []
  const activeMarkets: Array<{
    id: string
    onchainMarketId: string
    marketSlug: string
    title: string
    metadataUri: string | null
    closeTime: Date | null
    qYesDisplay: number
    qNoDisplay: number
    liquidityBDisplay: number
    priceYes: number
    trial: Season4DecisionTrialFacts
  }> = []

  for (const row of scopedMarketRows) {
    if (activeMarkets.length >= maxMarketsPerCycle) {
      break
    }

    const marketId = trimOrNull(row.onchainMarketId)
    const contractState = marketId ? contractStateMap.get(marketId) : null
    if (!marketId) continue
    if (!contractState) continue
    if (row.closeTime && row.closeTime.getTime() <= Date.now()) continue

    const trial = buildSeason4TrialFacts({
      marketSlug: row.marketSlug,
      marketTitle: row.title,
      metadataUri: row.metadataUri,
      closeTime: row.closeTime,
      linkedTrialQuestionId: row.trialQuestionId,
      linkedQuestionPrompt: row.questionPrompt,
      linkedTrialShortTitle: row.trialShortTitle,
      linkedSponsorName: row.sponsorName,
      linkedSponsorTicker: row.sponsorTicker,
      linkedExactPhase: row.exactPhase,
      linkedEstPrimaryCompletionDate: row.estPrimaryCompletionDate,
      linkedIndication: row.indication,
      linkedIntervention: row.intervention,
      linkedPrimaryEndpoint: row.primaryEndpoint,
      linkedCurrentStatus: row.currentStatus,
      linkedBriefSummary: row.briefSummary,
      linkedNctNumber: row.nctNumber,
    })

    if (!trial.ok) {
      preflightSkipped.push({
        modelKey: 'all',
        marketSlug: row.marketSlug,
        reason: `Missing linked trial data: ${trial.missingFields.join(', ')}`,
      })
      continue
    }

    activeMarkets.push({
      id: row.id,
      onchainMarketId: marketId,
      marketSlug: row.marketSlug,
      title: row.title,
      metadataUri: row.metadataUri,
      closeTime: row.closeTime,
      qYesDisplay: contractState.qYesDisplay,
      qNoDisplay: contractState.qNoDisplay,
      liquidityBDisplay: contractState.liquidityBDisplay,
      priceYes: contractState.priceYes,
      trial: trial.trial,
    })
  }

  const summary: Season4ModelCycleSummary = {
    chainId: config.chainId,
    tradeAmountDisplay,
    maxMarketsPerCycle,
    configuredModels: 0,
    configuredMarkets: activeMarkets.length,
    tradesExecuted: 0,
    trades: [],
    skipped: preflightSkipped,
    indexSummary: null,
  }

  if (activeMarkets.length === 0) {
    if (summary.skipped.length === 0) {
      summary.skipped.push({ modelKey: 'all', reason: 'No active season 4 markets are ready for a model cycle.' })
    }
    return summary
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })
  const marketStateById = new Map(activeMarkets.map((market) => [market.onchainMarketId, {
    ...market,
  }]))

  for (const row of scopedModelWalletRows) {
    if (!isModelId(row.modelKey)) continue
    const hasProvidedDecisionForModel = activeMarkets.some((market) => providedDecisionByModelMarket.has(`${row.modelKey}:${market.marketSlug}`))
    const canGenerateDecision = Boolean(MODEL_DECISION_GENERATORS[row.modelKey]?.enabled())
    if (!canGenerateDecision && !hasProvidedDecisionForModel) {
      summary.skipped.push({
        modelKey: row.modelKey,
        reason: getModelDecisionGeneratorDisabledReason(row.modelKey),
      })
      continue
    }

    const privateKey = privateKeys[row.modelKey]
    const walletAddress = normalizeAddress(row.walletAddress)
    if (!privateKey) {
      summary.skipped.push({ modelKey: row.modelKey, reason: 'No private key configured for this model wallet.' })
      continue
    }

    const account = privateKeyToAccount(privateKey)
    if (walletAddress && walletAddress !== account.address.toLowerCase()) {
      summary.skipped.push({ modelKey: row.modelKey, reason: 'Configured private key does not match the stored model wallet address.' })
      continue
    }

    summary.configuredModels += 1

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    })

    const collateralBalance = await publicClient.readContract({
      address: config.collateralTokenAddress,
      abi: MOCK_USDC_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint
    let collateralBalanceDisplay = season4AtomicToDisplay(collateralBalance)

    let approveTxHash: Hex | null = null
    let collateralApproved = false
    const positionStateByMarketId = new Map<string, {
      yesSharesHeld: number
      noSharesHeld: number
    }>()

    await Promise.all(activeMarkets.map(async (market) => {
      try {
        const [yesBalance, noBalance] = await Promise.all([
          publicClient.readContract({
            address: config.managerAddress,
            abi: PREDICTION_MARKET_MANAGER_ABI,
            functionName: 'yesBalances',
            args: [BigInt(market.onchainMarketId), account.address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: config.managerAddress,
            abi: PREDICTION_MARKET_MANAGER_ABI,
            functionName: 'noBalances',
            args: [BigInt(market.onchainMarketId), account.address],
          }) as Promise<bigint>,
        ])

        positionStateByMarketId.set(market.onchainMarketId, {
          yesSharesHeld: season4AtomicToDisplay(yesBalance),
          noSharesHeld: season4AtomicToDisplay(noBalance),
        })
      } catch {
        positionStateByMarketId.set(market.onchainMarketId, {
          yesSharesHeld: 0,
          noSharesHeld: 0,
        })
      }
    }))

    for (const market of activeMarkets) {
      const liveMarket = marketStateById.get(market.onchainMarketId)
      if (!liveMarket) continue

      const currentPosition = positionStateByMarketId.get(market.onchainMarketId) ?? {
        yesSharesHeld: 0,
        noSharesHeld: 0,
      }

      const context = {
        marketId: liveMarket.id,
        marketSlug: liveMarket.marketSlug,
        onchainMarketId: liveMarket.onchainMarketId,
        title: liveMarket.title,
        metadataUri: liveMarket.metadataUri,
        closeTime: liveMarket.closeTime,
        qYesDisplay: liveMarket.qYesDisplay,
        qNoDisplay: liveMarket.qNoDisplay,
        liquidityBDisplay: liveMarket.liquidityBDisplay,
        priceYes: liveMarket.priceYes,
        portfolio: {
          collateralBalanceDisplay,
          yesSharesHeld: currentPosition.yesSharesHeld,
          noSharesHeld: currentPosition.noSharesHeld,
        },
        maxTradeUsd: tradeAmountDisplay,
        asOf: new Date(),
        trial: liveMarket.trial,
      } as const

      const preview = buildSeason4ModelDecisionInput(context)
      if (preview.tradeCaps.allowedActions.length === 1 && preview.tradeCaps.allowedActions[0] === 'HOLD') {
        summary.skipped.push({
          modelKey: row.modelKey,
          marketSlug: liveMarket.marketSlug,
          reason: 'No executable trade is available for this model wallet on the current market state.',
        })
        continue
      }

      const providedDecision = providedDecisionByModelMarket.get(`${row.modelKey}:${liveMarket.marketSlug}`)
      let cappedDecision: ReturnType<typeof capSeason4TradeDecision>
      if (providedDecision) {
        cappedDecision = capSeason4TradeDecision({
          decision: providedDecision,
          tradeCaps: preview.tradeCaps,
        })
      } else {
        if (!canGenerateDecision) {
          summary.skipped.push({
            modelKey: row.modelKey,
            marketSlug: liveMarket.marketSlug,
            reason: 'No stored batch decision is available for this model and market.',
          })
          continue
        }

        let generated: Awaited<ReturnType<typeof generateSeason4ModelDecision>>
        try {
          generated = await generateSeason4ModelDecision({
            modelId: row.modelKey,
            context,
          })
        } catch (error) {
          summary.skipped.push({
            modelKey: row.modelKey,
            marketSlug: liveMarket.marketSlug,
            reason: error instanceof Error ? error.message : 'Season 4 model decision failed.',
          })
          continue
        }

        cappedDecision = capSeason4TradeDecision({
          decision: generated.generation.result,
          tradeCaps: generated.tradeCaps,
        })
      }
      if (cappedDecision.actionType === 'HOLD' || cappedDecision.executedAmountUsd <= 0) {
        summary.skipped.push({
          modelKey: row.modelKey,
          marketSlug: liveMarket.marketSlug,
          reason: cappedDecision.requestedActionType === 'HOLD'
            ? 'The model chose HOLD for this market.'
            : 'The model trade was capped to zero by season 4 portfolio limits.',
        })
        continue
      }

      const tradeExecution = buildSeason4TradeExecution({
        actionType: cappedDecision.actionType,
        executedAmountUsd: cappedDecision.executedAmountUsd,
        priceYes: liveMarket.priceYes,
      })
      if (!tradeExecution || tradeExecution.amountAtomic <= BigInt(0)) {
        summary.skipped.push({
          modelKey: row.modelKey,
          marketSlug: liveMarket.marketSlug,
          reason: 'The computed trade amount was too small to submit onchain.',
        })
        continue
      }

      try {
        if (tradeExecution.contractFunctionName === 'buyYes' || tradeExecution.contractFunctionName === 'buyNo') {
          if (!collateralApproved) {
            const allowance = await publicClient.readContract({
              address: config.collateralTokenAddress,
              abi: MOCK_USDC_ABI,
              functionName: 'allowance',
              args: [account.address, config.managerAddress],
            }) as bigint

            if (allowance < tradeExecution.amountAtomic) {
              approveTxHash = await walletClient.writeContract({
                address: config.collateralTokenAddress,
                abi: MOCK_USDC_ABI,
                functionName: 'approve',
                args: [config.managerAddress, maxUint256],
                account,
              })
              const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
              await waitForRpcBlock(() => publicClient.getBlockNumber(), approveReceipt.blockNumber)

              const nextAllowance = await publicClient.readContract({
                address: config.collateralTokenAddress,
                abi: MOCK_USDC_ABI,
                functionName: 'allowance',
                args: [account.address, config.managerAddress],
              }) as bigint

              if (nextAllowance < tradeExecution.amountAtomic) {
                throw new Error(`Allowance not ready for model trade: ${nextAllowance.toString()}`)
              }
            }

            collateralApproved = true
          }
        }

        const txHash = await walletClient.writeContract({
          address: config.managerAddress,
          abi: PREDICTION_MARKET_MANAGER_ABI,
          functionName: tradeExecution.contractFunctionName,
          args: [BigInt(liveMarket.onchainMarketId), tradeExecution.amountAtomic, BigInt(0)],
          account,
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        const nextState = applySeason4TradeToState({
          qYesDisplay: liveMarket.qYesDisplay,
          qNoDisplay: liveMarket.qNoDisplay,
          liquidityBDisplay: liveMarket.liquidityBDisplay,
          collateralBalanceDisplay,
          yesSharesHeld: currentPosition.yesSharesHeld,
          noSharesHeld: currentPosition.noSharesHeld,
          actionType: cappedDecision.actionType,
          executedAmountUsd: cappedDecision.executedAmountUsd,
          shareAmountDisplay: tradeExecution.shareAmountDisplay,
        })

        collateralBalanceDisplay = nextState.collateralBalanceDisplay
        positionStateByMarketId.set(liveMarket.onchainMarketId, {
          yesSharesHeld: nextState.yesSharesHeld,
          noSharesHeld: nextState.noSharesHeld,
        })
        marketStateById.set(liveMarket.onchainMarketId, {
          ...liveMarket,
          qYesDisplay: nextState.qYesDisplay,
          qNoDisplay: nextState.qNoDisplay,
          priceYes: nextState.priceYes,
        })

        summary.trades.push({
          modelKey: row.modelKey,
          walletAddress: account.address.toLowerCase(),
          marketId: liveMarket.onchainMarketId,
          marketSlug: liveMarket.marketSlug,
          action: cappedDecision.actionType,
          requestedAction: cappedDecision.requestedActionType,
          requestedAmountDisplay: cappedDecision.requestedAmountUsd,
          executedAmountDisplay: cappedDecision.executedAmountUsd,
          shareAmountDisplay: tradeExecution.shareAmountDisplay,
          binaryCall: cappedDecision.binaryCall,
          confidencePercent: cappedDecision.confidencePercent,
          explanation: cappedDecision.explanation,
          reasoning: cappedDecision.reasoning,
          priceYes: liveMarket.priceYes,
          txHash,
          approvedTxHash: approveTxHash,
        })
        summary.tradesExecuted += 1
      } catch (error) {
        summary.skipped.push({
          modelKey: row.modelKey,
          marketSlug: liveMarket.marketSlug,
          reason: error instanceof Error ? error.message : 'Failed to submit the season 4 onchain trade.',
        })
      }
    }
  }

  summary.indexSummary = await syncSeason4OnchainIndex()
  return summary
}
