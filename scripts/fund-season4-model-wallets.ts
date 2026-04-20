import dotenv from 'dotenv'
import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { closeDbConnections } from '@/lib/db'
import { SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { getSeason4DeployerPrivateKey, requireSeason4OnchainConfig } from '@/lib/onchain/config'
import {
  DEFAULT_SEASON4_MODEL_ETH_TOP_UP_WEI,
  MIN_SEASON4_MODEL_ETH_BALANCE_WEI,
  SEASON4_CHAIN,
} from '@/lib/onchain/constants'
import { seedSeason4ModelWallets } from '@/lib/season4-ops'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

async function main() {
  const config = requireSeason4OnchainConfig()
  const privateKey = getSeason4DeployerPrivateKey(config.target)
  if (!privateKey) {
    throw new Error(
      config.target === 'toy'
        ? 'SEASON4_TOY_DEPLOYER_PRIVATE_KEY or SEASON4_DEPLOYER_PRIVATE_KEY is not set'
        : 'SEASON4_DEPLOYER_PRIVATE_KEY is not set',
    )
  }

  const deployer = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({
    chain: SEASON4_CHAIN,
    transport: http(config.rpcUrl),
  })
  const walletClient = createWalletClient({
    account: deployer,
    chain: SEASON4_CHAIN,
    transport: http(config.rpcUrl),
  })

  const seeded = await seedSeason4ModelWallets()
  const funded: Array<{
    modelKey: string
    walletAddress: string
    claimTxHash: string | null
    gasTopUpTxHash: string | null
    gasBalanceEth: string
  }> = []

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
    if (gasBalance < MIN_SEASON4_MODEL_ETH_BALANCE_WEI) {
      gasTopUpTxHash = await walletClient.sendTransaction({
        account: deployer,
        to: walletAddress,
        value: DEFAULT_SEASON4_MODEL_ETH_TOP_UP_WEI,
        chain: SEASON4_CHAIN,
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

  console.log(JSON.stringify({
    chainId: config.chainId,
    deployer: deployer.address,
    funded,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}).finally(async () => {
  await closeDbConnections()
})
