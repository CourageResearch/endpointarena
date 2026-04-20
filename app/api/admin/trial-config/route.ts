import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getTrialRuntimeConfig,
  updateTrialRuntimeConfig,
} from '@/lib/trial-runtime-config'
import { ValidationError } from '@/lib/errors'
import { SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { getSeason4DeployerPrivateKey, getSeason4OnchainConfig } from '@/lib/onchain/config'
import { MOCK_USDC_DECIMALS } from '@/lib/season4-faucet-config'
import { getActiveDatabaseTarget, type DatabaseTarget } from '@/lib/database-target'
import { getDbForTarget } from '@/lib/db'

type AdminTrialConfigPatchInput = {
  target?: unknown
  toyTrialCount?: unknown
  openingLmsrB?: unknown
  season4MarketLiquidityBDisplay?: unknown
  season4HumanStartingBankrollDisplay?: unknown
  season4StartingBankrollDisplay?: unknown
}

function toAdminTrialConfigDto(config: Awaited<ReturnType<typeof getTrialRuntimeConfig>>) {
  return {
    toyTrialCount: config.toyTrialCount,
    season4MarketLiquidityBDisplay: config.season4MarketLiquidityBDisplay,
    season4HumanStartingBankrollDisplay: config.season4HumanStartingBankrollDisplay,
    season4StartingBankrollDisplay: config.season4StartingBankrollDisplay,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

function parseDatabaseTarget(value: unknown): DatabaseTarget | null {
  if (value === undefined || value === null || value === '') return null
  if (value === 'main' || value === 'toy') return value
  throw new ValidationError('target must be either main or toy')
}

function assertNoLiveLegacyConfigPatch(body: AdminTrialConfigPatchInput) {
  if (body.openingLmsrB !== undefined) {
    throw new ValidationError('Legacy offchain Opening LMSR b is retired in season 4. Season 4 live market liquidity is configured through the onchain market creation flow.')
  }
}

function toFaucetAmountAtomic(displayAmount: number): bigint {
  return BigInt(Math.round(displayAmount * MOCK_USDC_DECIMALS))
}

async function syncSeason4FaucetClaimAmount(displayAmount: number, target: DatabaseTarget): Promise<{
  txHash: Hex | null
  warning: string | null
}> {
  const config = getSeason4OnchainConfig(target)
  if (!config.enabled || !config.rpcUrl || !config.faucetAddress) {
    return { txHash: null, warning: null }
  }

  const privateKey = getSeason4DeployerPrivateKey(config.target)
  if (!privateKey) {
    return {
      txHash: null,
      warning: 'Saved the bankroll setting, but skipped faucet claim amount sync because the Season 4 deployer key is not configured.',
    }
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
  const nextAmount = toFaucetAmountAtomic(displayAmount)
  const currentAmount = await publicClient.readContract({
    address: config.faucetAddress,
    abi: SEASON4_FAUCET_ABI,
    functionName: 'claimAmount',
  }) as bigint

  if (currentAmount === nextAmount) {
    return { txHash: null, warning: null }
  }

  const txHash = await walletClient.writeContract({
    address: config.faucetAddress,
    abi: SEASON4_FAUCET_ABI,
    functionName: 'setClaimAmount',
    args: [nextAmount],
    account,
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })

  return { txHash, warning: null }
}

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const url = new URL(request.url)
    const target = parseDatabaseTarget(url.searchParams.get('target')) ?? getActiveDatabaseTarget()
    const config = await getTrialRuntimeConfig(getDbForTarget(target))

    return successResponse({ config: toAdminTrialConfigDto(config) }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load runtime settings')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const body = await parseJsonBody<AdminTrialConfigPatchInput>(request)
    assertNoLiveLegacyConfigPatch(body)
    const target = parseDatabaseTarget(body.target) ?? getActiveDatabaseTarget()
    const targetDb = getDbForTarget(target)
    const config = await updateTrialRuntimeConfig({
      toyTrialCount: body.toyTrialCount,
      season4MarketLiquidityBDisplay: body.season4MarketLiquidityBDisplay,
      season4HumanStartingBankrollDisplay: body.season4HumanStartingBankrollDisplay,
      season4StartingBankrollDisplay: body.season4StartingBankrollDisplay,
    }, targetDb)
    let faucetSync: Awaited<ReturnType<typeof syncSeason4FaucetClaimAmount>> = { txHash: null, warning: null }
    if (body.season4HumanStartingBankrollDisplay !== undefined) {
      try {
        faucetSync = await syncSeason4FaucetClaimAmount(config.season4HumanStartingBankrollDisplay, target)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        faucetSync = {
          txHash: null,
          warning: `Saved the bankroll setting, but skipped faucet claim amount sync: ${message}`,
        }
      }
    }

    revalidatePath('/admin/settings')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/base')
    revalidatePath('/leaderboard')
    revalidatePath('/method')
    revalidatePath('/profile')

    return successResponse({
      config: toAdminTrialConfigDto(config),
      faucetSync,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to update runtime settings')
  }
}
