import { eq } from 'drizzle-orm'
import { createPublicClient, createWalletClient, formatUnits, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { db } from '@/lib/db'
import { ConfigurationError, ConflictError, ValidationError } from '@/lib/errors'
import { SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { MOCK_USDC_DECIMAL_PLACES, SEASON4_CHAIN } from '@/lib/onchain/constants'
import { getSeason4FaucetClaimState } from '@/lib/season4-faucet-eligibility'
import { formatSeason4FaucetUsdcAmount } from '@/lib/season4-faucet-config'
import { getSeason4DeployerPrivateKey, requireSeason4OnchainConfig } from '@/lib/onchain/config'
import { syncSeason4OnchainIndex } from '@/lib/onchain/indexer'
import { requireSession } from '@/lib/auth/session'
import { ensureOnchainUserWalletLink, normalizeWalletAddress } from '@/lib/onchain/wallet-link'
import { onchainFaucetClaims, users } from '@/lib/schema'
import { getSeason4MarketDetail } from '@/lib/season4-market-data'

function getDeployerPrivateKey(target: 'main' | 'toy'): Hex {
  const privateKey = getSeason4DeployerPrivateKey(target)
  if (!privateKey) {
    throw new ConfigurationError(
      target === 'toy'
        ? 'SEASON4_TOY_DEPLOYER_PRIVATE_KEY or SEASON4_DEPLOYER_PRIVATE_KEY is not set'
        : 'SEASON4_DEPLOYER_PRIVATE_KEY is not set',
    )
  }

  return privateKey as Hex
}

async function upsertSubmittedClaim(args: {
  userId: string
  walletAddress: string
  txHash: Hex
  amountAtomic: bigint
  chainId: number
}) {
  const [existing] = await db.select({
    id: onchainFaucetClaims.id,
  })
    .from(onchainFaucetClaims)
    .where(eq(onchainFaucetClaims.txHash, args.txHash))
    .limit(1)

  const values = {
    userId: args.userId,
    walletAddress: args.walletAddress,
    chainId: args.chainId,
    amountAtomic: args.amountAtomic.toString(),
    amountDisplay: Number(formatUnits(args.amountAtomic, MOCK_USDC_DECIMAL_PLACES)),
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

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const session = await requireSession()
    const config = requireSeason4OnchainConfig()
    const { marketId } = await request.json().catch(() => ({ marketId: null })) as {
      marketId?: string | null
    }

    const [user] = await db.select({
      id: users.id,
      privyUserId: users.privyUserId,
      embeddedWalletAddress: users.embeddedWalletAddress,
      walletProvisioningStatus: users.walletProvisioningStatus,
    })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)
    if (!user) {
      throw new ValidationError('User account not found')
    }

    const walletAddress = normalizeWalletAddress(user.embeddedWalletAddress)
    if (!walletAddress) {
      throw new ValidationError('No embedded wallet is linked to this account yet')
    }

    await ensureOnchainUserWalletLink({
      userId: user.id,
      privyUserId: user.privyUserId,
      walletAddress,
    })

    const claimState = await getSeason4FaucetClaimState({
      userId: user.id,
      walletAddress,
    })
    if (config.target !== 'toy' && claimState.hasClaimed) {
      throw new ConflictError('This account has already claimed the Season 4 faucet')
    }

    const deployer = privateKeyToAccount(getDeployerPrivateKey(config.target))
    const publicClient = createPublicClient({
      chain: SEASON4_CHAIN,
      transport: http(config.rpcUrl),
    })
    const walletClient = createWalletClient({
      account: deployer,
      chain: SEASON4_CHAIN,
      transport: http(config.rpcUrl),
    })

    const [lastClaimedAt, canClaim] = await Promise.all([
      publicClient.readContract({
        address: config.faucetAddress,
        abi: SEASON4_FAUCET_ABI,
        functionName: 'lastClaimedAt',
        args: [walletAddress as `0x${string}`],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: config.faucetAddress,
        abi: SEASON4_FAUCET_ABI,
        functionName: 'canClaim',
        args: [walletAddress as `0x${string}`],
      }) as Promise<boolean>,
    ])
    if (config.target !== 'toy' && lastClaimedAt > BigInt(0)) {
      throw new ConflictError('That wallet has already claimed the Season 4 faucet')
    }
    if (!canClaim) {
      throw new ConflictError('That wallet is not eligible for the Season 4 faucet')
    }

    const claimedAmountAtomic = await publicClient.readContract({
      address: config.faucetAddress,
      abi: SEASON4_FAUCET_ABI,
      functionName: 'claimAmount',
    }) as bigint

    const claimTxHash = await walletClient.writeContract({
      address: config.faucetAddress,
      abi: SEASON4_FAUCET_ABI,
      functionName: 'claimTo',
      args: [walletAddress as `0x${string}`],
      account: deployer,
    })
    await publicClient.waitForTransactionReceipt({ hash: claimTxHash })

    await upsertSubmittedClaim({
      userId: user.id,
      walletAddress,
      txHash: claimTxHash,
      amountAtomic: claimedAmountAtomic,
      chainId: config.chainId,
    })

    await ensureOnchainUserWalletLink({
      userId: user.id,
      privyUserId: user.privyUserId,
      walletAddress,
      firstClaimedAt: new Date(),
    })
    await db.update(users)
      .set({
        walletProvisioningStatus: user.walletProvisioningStatus === 'error'
          ? 'provisioned'
          : user.walletProvisioningStatus,
      })
      .where(eq(users.id, user.id))

    await syncSeason4OnchainIndex()

    const detail = marketId
      ? await getSeason4MarketDetail(marketId, { viewerUserId: user.id })
      : null

    return successResponse({
      success: true,
      walletAddress,
      claimTxHash,
      claimAmountAtomic: claimedAmountAtomic.toString(),
      claimAmountDisplay: Number(formatUnits(claimedAmountAtomic, MOCK_USDC_DECIMAL_PLACES)),
      claimAmountLabel: formatSeason4FaucetUsdcAmount(claimedAmountAtomic),
      viewer: detail?.viewer ?? null,
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to claim the season 4 faucet')
  }
}
