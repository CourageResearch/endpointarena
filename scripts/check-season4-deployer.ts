import dotenv from 'dotenv'
import { createPublicClient, formatEther, http } from 'viem'
import { SEASON4_CHAIN } from '@/lib/onchain/constants'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function main() {
  const address = trimOrNull(process.env.SEASON4_DEPLOYER_ADDRESS)
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('SEASON4_DEPLOYER_ADDRESS is not set to a valid EVM address')
  }

  const rpcUrl = trimOrNull(process.env.BASE_SEPOLIA_RPC_URL) ?? 'https://sepolia.base.org'

  const client = createPublicClient({
    chain: SEASON4_CHAIN,
    transport: http(rpcUrl),
  })

  const [balance, blockNumber] = await Promise.all([
    client.getBalance({ address: address as `0x${string}` }),
    client.getBlockNumber(),
  ])

  console.log(JSON.stringify({
    chainId: SEASON4_CHAIN.id,
    chainName: SEASON4_CHAIN.name,
    address,
    balanceWei: balance.toString(),
    balanceEth: formatEther(balance),
    latestBlock: blockNumber.toString(),
    funded: balance > BigInt(0),
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
