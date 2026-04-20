import dotenv from 'dotenv'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { closeDbConnections, db } from '@/lib/db'
import { syncSeason4OnchainIndex } from '@/lib/onchain/indexer'
import { getSeason4DeployerPrivateKey, requireSeason4OnchainConfig } from '@/lib/onchain/config'
import { MOCK_USDC_ABI, PREDICTION_MARKET_MANAGER_ABI, SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC } from '@/lib/season4-faucet-config'
import {
  onchainBalances,
  onchainFaucetClaims,
  onchainMarkets,
  onchainUserWallets,
  trialQuestions,
  trials,
  users,
} from '@/lib/schema'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const MOCK_USDC_DECIMALS = 6
const DEFAULT_LIQUIDITY_B = BigInt(1_000_000_000)
const DEFAULT_TRADE_AMOUNT = BigInt(10_000_000)
const DEFAULT_CLAIM_AMOUNT = DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC
const DEFAULT_INITIAL_PRICE_YES_E18 = BigInt('500000000000000000')
const SMOKE_USER_EMAIL = 'season4-smoke@local.test'
const SMOKE_USER_NAME = 'season4smoke'
const BUY_TX_GAS_LIMIT = BigInt(500_000)
const RPC_BLOCK_POLL_DELAY_MS = 1_000
const RPC_BLOCK_POLL_ATTEMPTS = 10
const DEFAULT_SMOKE_TRIAL_NCT_NUMBER = 'NCT09990001'
const DEFAULT_SMOKE_TRIAL_QUESTION_SLUG = 'primary_endpoint_met'

const DEFAULT_SMOKE_TRIAL = {
  nctNumber: DEFAULT_SMOKE_TRIAL_NCT_NUMBER,
  shortTitle: 'NVX-214 With Pembrolizumab in Advanced Melanoma',
  sponsorName: 'Northstar Biopharma',
  indication: 'Advanced melanoma after progression on first-line immunotherapy',
  exactPhase: 'Phase 2',
  intervention: 'NVX-214 plus pembrolizumab vs pembrolizumab alone',
  primaryEndpoint: 'Objective response rate at Week 24',
  currentStatus: 'Recruiting',
  estPrimaryCompletionDate: new Date('2027-09-01T00:00:00Z'),
  estStudyCompletionDate: new Date('2028-03-01T00:00:00Z'),
  estEnrollment: 180,
  briefSummary: 'Randomized phase 2 trial evaluating whether NVX-214 combined with pembrolizumab improves tumor response versus pembrolizumab alone in patients with advanced melanoma who progressed after prior checkpoint inhibitor therapy.',
  questionSlug: DEFAULT_SMOKE_TRIAL_QUESTION_SLUG,
  questionPrompt: 'Will this trial meet its primary endpoint?',
} as const

type SmokeTrialQuestion = {
  trialId: string
  trialQuestionId: string
  questionSlug: string
  questionPrompt: string
  shortTitle: string
  sponsorName: string
  nctNumber: string
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveBigInt(value: string | null | undefined, fallback: bigint): bigint {
  const trimmed = trimOrNull(value)
  if (!trimmed) return fallback
  return BigInt(trimmed)
}

async function loadSmokeTrialQuestionByWhere(where: SQL<unknown>): Promise<SmokeTrialQuestion | null> {
  const rows = await db.select({
    trialId: trials.id,
    trialQuestionId: trialQuestions.id,
    questionSlug: trialQuestions.slug,
    questionPrompt: trialQuestions.prompt,
    shortTitle: trials.shortTitle,
    sponsorName: trials.sponsorName,
    nctNumber: trials.nctNumber,
  })
    .from(trialQuestions)
    .innerJoin(trials, eq(trialQuestions.trialId, trials.id))
    .where(where)
    .limit(1)

  return rows[0] ?? null
}

async function findSmokeTrialQuestion(): Promise<SmokeTrialQuestion | null> {
  const requestedTrialQuestionId = trimOrNull(process.env.SEASON4_SMOKE_TRIAL_QUESTION_ID)
  if (requestedTrialQuestionId) {
    return loadSmokeTrialQuestionByWhere(eq(trialQuestions.id, requestedTrialQuestionId))
  }

  const requestedNctNumber = trimOrNull(process.env.SEASON4_SMOKE_TRIAL_NCT_NUMBER)?.toUpperCase() ?? null
  if (requestedNctNumber) {
    return loadSmokeTrialQuestionByWhere(eq(trials.nctNumber, requestedNctNumber))
  }

  const rows = await db.select({
    trialId: trials.id,
    trialQuestionId: trialQuestions.id,
    questionSlug: trialQuestions.slug,
    questionPrompt: trialQuestions.prompt,
    shortTitle: trials.shortTitle,
    sponsorName: trials.sponsorName,
    nctNumber: trials.nctNumber,
  })
    .from(trialQuestions)
    .innerJoin(trials, eq(trialQuestions.trialId, trials.id))
    .where(and(
      eq(trialQuestions.status, 'live'),
      eq(trialQuestions.isBettable, true),
    ))
    .orderBy(desc(trials.createdAt))
    .limit(1)

  return rows[0] ?? null
}

async function ensureDemoSmokeTrialQuestion(): Promise<SmokeTrialQuestion> {
  const demoNctNumber = trimOrNull(process.env.SEASON4_SMOKE_TRIAL_NCT_NUMBER)?.toUpperCase()
    ?? DEFAULT_SMOKE_TRIAL.nctNumber
  const demoQuestionSlug = trimOrNull(process.env.SEASON4_SMOKE_TRIAL_SLUG)
    ?? DEFAULT_SMOKE_TRIAL.questionSlug

  const existingTrial = await db.query.trials.findFirst({
    columns: { id: true },
    where: eq(trials.nctNumber, demoNctNumber),
  })

  const trialId = existingTrial?.id ?? crypto.randomUUID()
  const trialValues = {
    nctNumber: demoNctNumber,
    shortTitle: DEFAULT_SMOKE_TRIAL.shortTitle,
    sponsorName: DEFAULT_SMOKE_TRIAL.sponsorName,
    indication: DEFAULT_SMOKE_TRIAL.indication,
    exactPhase: DEFAULT_SMOKE_TRIAL.exactPhase,
    intervention: DEFAULT_SMOKE_TRIAL.intervention,
    primaryEndpoint: DEFAULT_SMOKE_TRIAL.primaryEndpoint,
    currentStatus: DEFAULT_SMOKE_TRIAL.currentStatus,
    estPrimaryCompletionDate: DEFAULT_SMOKE_TRIAL.estPrimaryCompletionDate,
    estStudyCompletionDate: DEFAULT_SMOKE_TRIAL.estStudyCompletionDate,
    estEnrollment: DEFAULT_SMOKE_TRIAL.estEnrollment,
    briefSummary: DEFAULT_SMOKE_TRIAL.briefSummary,
    updatedAt: new Date(),
  }

  if (existingTrial) {
    await db.update(trials)
      .set(trialValues)
      .where(eq(trials.id, existingTrial.id))
  } else {
    await db.insert(trials).values({
      id: trialId,
      ...trialValues,
    })
  }

  const existingQuestion = await db.query.trialQuestions.findFirst({
    columns: { id: true },
    where: and(
      eq(trialQuestions.trialId, trialId),
      eq(trialQuestions.slug, demoQuestionSlug),
    ),
  })

  const questionId = existingQuestion?.id ?? crypto.randomUUID()
  const questionValues = {
    prompt: DEFAULT_SMOKE_TRIAL.questionPrompt,
    status: 'live' as const,
    isBettable: true,
    sortOrder: 0,
    outcome: 'Pending' as const,
    updatedAt: new Date(),
  }

  if (existingQuestion) {
    await db.update(trialQuestions)
      .set(questionValues)
      .where(eq(trialQuestions.id, existingQuestion.id))
  } else {
    await db.insert(trialQuestions).values({
      id: questionId,
      trialId,
      slug: demoQuestionSlug,
      ...questionValues,
    })
  }

  const smokeTrial = await loadSmokeTrialQuestionByWhere(eq(trialQuestions.id, questionId))
  if (!smokeTrial) {
    throw new Error('Failed to create the demo smoke trial question')
  }

  return smokeTrial
}

async function ensureSmokeTrialQuestion(): Promise<SmokeTrialQuestion> {
  const existing = await findSmokeTrialQuestion()
  if (existing) return existing
  return ensureDemoSmokeTrialQuestion()
}

async function ensureSmokeUser(walletAddress: Address): Promise<{ userId: string }> {
  const normalizedWalletAddress = walletAddress.toLowerCase()
  const existing = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, SMOKE_USER_EMAIL),
  })

  const userId = existing?.id ?? crypto.randomUUID()

  if (existing) {
    await db.update(users)
      .set({
        name: SMOKE_USER_NAME,
        embeddedWalletAddress: normalizedWalletAddress,
        walletProvisioningStatus: 'provisioned',
        walletProvisionedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
  } else {
    await db.insert(users).values({
      id: userId,
      name: SMOKE_USER_NAME,
      email: SMOKE_USER_EMAIL,
      embeddedWalletAddress: normalizedWalletAddress,
      walletProvisioningStatus: 'provisioned',
      walletProvisionedAt: new Date(),
    })
  }

  const existingWallet = await db.query.onchainUserWallets.findFirst({
    columns: { id: true },
    where: eq(onchainUserWallets.userId, userId),
  })

  if (existingWallet) {
    await db.update(onchainUserWallets)
      .set({
        walletAddress: normalizedWalletAddress,
        provisioningStatus: 'ready',
        updatedAt: new Date(),
      })
      .where(eq(onchainUserWallets.id, existingWallet.id))
  } else {
    await db.insert(onchainUserWallets).values({
      userId,
      privyUserId: null,
      chainId: baseSepolia.id,
      walletAddress: normalizedWalletAddress,
      provisioningStatus: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  return { userId }
}

async function upsertFaucetClaim(args: {
  userId: string
  walletAddress: Address
  txHash: Hex
  amountAtomic: bigint
}): Promise<void> {
  const existing = await db.query.onchainFaucetClaims.findFirst({
    columns: { id: true },
    where: and(
      eq(onchainFaucetClaims.walletAddress, args.walletAddress.toLowerCase()),
      eq(onchainFaucetClaims.txHash, args.txHash),
    ),
  })

  const values = {
    userId: args.userId,
    walletAddress: args.walletAddress.toLowerCase(),
    chainId: baseSepolia.id,
    amountAtomic: args.amountAtomic.toString(),
    amountDisplay: Number(formatUnits(args.amountAtomic, MOCK_USDC_DECIMALS)),
    status: 'submitted' as const,
    txHash: args.txHash,
    requestedAt: new Date(),
    updatedAt: new Date(),
  }

  if (existing) {
    await db.update(onchainFaucetClaims)
      .set(values)
      .where(eq(onchainFaucetClaims.id, existing.id))
    return
  }

  await db.insert(onchainFaucetClaims).values(values)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRpcBlock(
  getLatestBlock: () => Promise<bigint>,
  targetBlock: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < RPC_BLOCK_POLL_ATTEMPTS; attempt += 1) {
    const latestBlock = await getLatestBlock()
    if (latestBlock >= targetBlock) return
    await sleep(RPC_BLOCK_POLL_DELAY_MS)
  }
}

async function main() {
  const config = requireSeason4OnchainConfig()
  const deployerPrivateKey = getSeason4DeployerPrivateKey(config.target)
  if (!deployerPrivateKey) {
    throw new Error(
      config.target === 'toy'
        ? 'SEASON4_TOY_DEPLOYER_PRIVATE_KEY or SEASON4_DEPLOYER_PRIVATE_KEY is not set'
        : 'SEASON4_DEPLOYER_PRIVATE_KEY is not set',
    )
  }

  const deployer = privateKeyToAccount(deployerPrivateKey)
  const closeTime = BigInt(Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60))
  const smokeTrial = await ensureSmokeTrialQuestion()
  const marketSlug = trimOrNull(process.env.SEASON4_SMOKE_MARKET_SLUG) ?? 'season4-launch-smoke'
  const title = trimOrNull(process.env.SEASON4_SMOKE_MARKET_TITLE) ?? smokeTrial.shortTitle
  const metadataUri = trimOrNull(process.env.SEASON4_SMOKE_MARKET_METADATA_URI)
    ?? `https://endpointarena.com/season4/markets/${marketSlug}`
  const liquidityB = parsePositiveBigInt(process.env.SEASON4_SMOKE_MARKET_LIQUIDITY_B, DEFAULT_LIQUIDITY_B)
  const initialPriceYesE18 = parsePositiveBigInt(
    process.env.SEASON4_SMOKE_INITIAL_PRICE_YES_E18,
    DEFAULT_INITIAL_PRICE_YES_E18,
  )
  const tradeAmount = parsePositiveBigInt(process.env.SEASON4_SMOKE_TRADE_AMOUNT_ATOMIC, DEFAULT_TRADE_AMOUNT)
  const claimAmount = parsePositiveBigInt(process.env.SEASON4_SMOKE_CLAIM_AMOUNT_ATOMIC, DEFAULT_CLAIM_AMOUNT)

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })
  const walletClient = createWalletClient({
    account: deployer,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })

  const { userId } = await ensureSmokeUser(deployer.address)

  const existingMarket = await db.query.onchainMarkets.findFirst({
    columns: {
      id: true,
      onchainMarketId: true,
      deployTxHash: true,
    },
    where: and(
      eq(onchainMarkets.chainId, config.chainId),
      eq(onchainMarkets.managerAddress, config.managerAddress),
      eq(onchainMarkets.metadataUri, metadataUri),
    ),
  })

  let marketId = existingMarket?.onchainMarketId ?? null
  let marketCreateHash: Hex | null = existingMarket?.deployTxHash as Hex | null

  if (!marketId) {
    marketCreateHash = await walletClient.writeContract({
      address: config.managerAddress,
      abi: PREDICTION_MARKET_MANAGER_ABI,
      functionName: 'createMarket',
      args: [config.collateralTokenAddress, metadataUri, closeTime, liquidityB, initialPriceYesE18],
      account: deployer,
    })
    const marketCreateReceipt = await publicClient.waitForTransactionReceipt({ hash: marketCreateHash })

    for (const log of marketCreateReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: PREDICTION_MARKET_MANAGER_ABI,
          data: log.data,
          topics: log.topics,
        })
        if (decoded.eventName === 'MarketCreated') {
          marketId = decoded.args.marketId.toString()
          break
        }
      } catch {
        continue
      }
    }
  }

  if (!marketId) {
    throw new Error('Failed to resolve smoke market id')
  }

  const canClaim = await publicClient.readContract({
    address: config.faucetAddress,
    abi: SEASON4_FAUCET_ABI,
    functionName: 'canClaim',
    args: [deployer.address],
  }) as boolean

  let faucetClaimHash: Hex | null = null
  if (canClaim) {
    faucetClaimHash = await walletClient.writeContract({
      address: config.faucetAddress,
      abi: SEASON4_FAUCET_ABI,
      functionName: 'claimTo',
      args: [deployer.address],
      account: deployer,
    })
    await upsertFaucetClaim({
      userId,
      walletAddress: deployer.address,
      txHash: faucetClaimHash,
      amountAtomic: claimAmount,
    })
    await publicClient.waitForTransactionReceipt({ hash: faucetClaimHash })
  }

  const collateralBefore = await publicClient.readContract({
    address: config.collateralTokenAddress,
    abi: MOCK_USDC_ABI,
    functionName: 'balanceOf',
    args: [deployer.address],
  }) as bigint

  const allowanceBefore = await publicClient.readContract({
    address: config.collateralTokenAddress,
    abi: MOCK_USDC_ABI,
    functionName: 'allowance',
    args: [deployer.address, config.managerAddress],
  }) as bigint

  let approveHash: Hex | null = null
  if (allowanceBefore < tradeAmount) {
    approveHash = await walletClient.writeContract({
      address: config.collateralTokenAddress,
      abi: MOCK_USDC_ABI,
      functionName: 'approve',
      args: [config.managerAddress, tradeAmount],
      account: deployer,
    })
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash })
    await waitForRpcBlock(() => publicClient.getBlockNumber(), approveReceipt.blockNumber)
  }

  const allowanceReady = await publicClient.readContract({
    address: config.collateralTokenAddress,
    abi: MOCK_USDC_ABI,
    functionName: 'allowance',
    args: [deployer.address, config.managerAddress],
  })

  if (allowanceReady < tradeAmount) {
    throw new Error(`Allowance not ready for trade: ${allowanceReady.toString()}`)
  }

  const priceBefore = await publicClient.readContract({
    address: config.managerAddress,
    abi: PREDICTION_MARKET_MANAGER_ABI,
    functionName: 'priceYesE18',
    args: [BigInt(marketId)],
  }) as bigint

  const buyHash = await walletClient.writeContract({
    address: config.managerAddress,
    abi: PREDICTION_MARKET_MANAGER_ABI,
    functionName: 'buyYes',
    args: [BigInt(marketId), tradeAmount, BigInt(0)],
    account: deployer,
    gas: BUY_TX_GAS_LIMIT,
  })
  const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyHash })
  await waitForRpcBlock(() => publicClient.getBlockNumber(), buyReceipt.blockNumber)

  const priceAfter = await publicClient.readContract({
    address: config.managerAddress,
    abi: PREDICTION_MARKET_MANAGER_ABI,
    functionName: 'priceYesE18',
    args: [BigInt(marketId)],
    blockNumber: buyReceipt.blockNumber,
  }) as bigint

  const collateralAfter = await publicClient.readContract({
    address: config.collateralTokenAddress,
    abi: MOCK_USDC_ABI,
    functionName: 'balanceOf',
    args: [deployer.address],
    blockNumber: buyReceipt.blockNumber,
  }) as bigint

  const indexSummary = await syncSeason4OnchainIndex()

  const existingMarketRow = await db.query.onchainMarkets.findFirst({
    columns: { id: true },
    where: and(
      eq(onchainMarkets.chainId, config.chainId),
      eq(onchainMarkets.managerAddress, config.managerAddress),
      eq(onchainMarkets.onchainMarketId, marketId),
    ),
  })

  if (existingMarketRow) {
    await db.update(onchainMarkets)
      .set({
        marketSlug,
        title,
        metadataUri,
        trialQuestionId: smokeTrial.trialQuestionId,
        updatedAt: new Date(),
      })
      .where(eq(onchainMarkets.id, existingMarketRow.id))
  }

  const balanceRows = await db.select({
    marketRef: onchainBalances.marketRef,
    collateralDisplay: onchainBalances.collateralDisplay,
    yesShares: onchainBalances.yesShares,
    noShares: onchainBalances.noShares,
  })
    .from(onchainBalances)
    .where(eq(onchainBalances.walletAddress, deployer.address.toLowerCase()))

  const marketRow = await db.query.onchainMarkets.findFirst({
    columns: {
      marketSlug: true,
      title: true,
      onchainMarketId: true,
      status: true,
      deployTxHash: true,
    },
    where: and(
      eq(onchainMarkets.chainId, config.chainId),
      eq(onchainMarkets.managerAddress, config.managerAddress),
      eq(onchainMarkets.onchainMarketId, marketId),
    ),
  })

  console.log(JSON.stringify({
    deployer: deployer.address,
    smokeUserId: userId,
    market: {
      marketId,
      marketSlug,
      title,
      metadataUri,
      trialQuestionId: smokeTrial.trialQuestionId,
      createTxHash: marketCreateHash,
      reusedExistingMarket: Boolean(existingMarket),
      row: marketRow,
    },
    smokeTrial,
    faucet: {
      claimTxHash: faucetClaimHash,
      claimSkippedDueToCooldown: !canClaim,
      claimAmountAtomic: claimAmount.toString(),
    },
    trade: {
      approveTxHash: approveHash,
      buyTxHash: buyHash,
      tradeAmountAtomic: tradeAmount.toString(),
      allowanceBefore: allowanceBefore.toString(),
      allowanceReady: allowanceReady.toString(),
      collateralBefore: collateralBefore.toString(),
      collateralAfter: collateralAfter.toString(),
      priceYesBeforeE18: priceBefore.toString(),
      priceYesAfterE18: priceAfter.toString(),
    },
    balances: balanceRows,
    indexSummary,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}).finally(async () => {
  await closeDbConnections()
})
