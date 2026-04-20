import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import solc from 'solc'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC } from '@/lib/season4-faucet-config'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const CONTRACTS_DIR = path.resolve(process.cwd(), 'contracts/src')
const LOCAL_ENV_PATH = path.resolve(process.cwd(), '.env.local')
const FAUCET_CLAIM_AMOUNT = DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC
const MAIN_FAUCET_COOLDOWN_SECONDS = BigInt(24 * 60 * 60)
const TOY_FAUCET_COOLDOWN_SECONDS = BigInt(0)
const FAUCET_RESERVE = BigInt(1_000_000_000_000) // 1,000,000 mock USDC

type ContractArtifact = {
  abi: Abi
  bytecode: Hex
}

type DeploymentTarget = 'main' | 'toy'

type DeploymentSummary = {
  target: DeploymentTarget
  deployer: Address
  balanceEth: string
  blockNumber: string
  collateralTokenAddress: Address
  faucetAddress: Address
  marketManagerAddress: Address
  mintTxHash: Hex
  collateralExplorerUrl: string
  faucetExplorerUrl: string
  marketManagerExplorerUrl: string
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requireValue(name: string, value: string | null): string {
  if (!value) {
    throw new Error(`${name} is not set`)
  }

  return value
}

function parseDeploymentTarget(argv: string[]): DeploymentTarget {
  for (const arg of argv) {
    if (arg === '--toy' || arg === '--target=toy') return 'toy'
    if (arg === '--main' || arg === '--target=main') return 'main'
  }

  return 'main'
}

function getTargetPrivateKey(target: DeploymentTarget): Hex {
  const value = target === 'toy'
    ? trimOrNull(process.env.SEASON4_TOY_DEPLOYER_PRIVATE_KEY)
      ?? trimOrNull(process.env.SEASON4_DEPLOYER_PRIVATE_KEY)
    : trimOrNull(process.env.SEASON4_DEPLOYER_PRIVATE_KEY)

  return requireValue(
    target === 'toy' ? 'SEASON4_TOY_DEPLOYER_PRIVATE_KEY or SEASON4_DEPLOYER_PRIVATE_KEY' : 'SEASON4_DEPLOYER_PRIVATE_KEY',
    value,
  ) as Hex
}

function getTargetRpcUrl(target: DeploymentTarget): string {
  const value = target === 'toy'
    ? trimOrNull(process.env.SEASON4_TOY_RPC_URL)
      ?? trimOrNull(process.env.BASE_SEPOLIA_RPC_URL)
      ?? trimOrNull(process.env.SEASON4_RPC_URL)
    : trimOrNull(process.env.BASE_SEPOLIA_RPC_URL)
      ?? trimOrNull(process.env.SEASON4_RPC_URL)

  return requireValue(
    target === 'toy' ? 'SEASON4_TOY_RPC_URL or BASE_SEPOLIA_RPC_URL or SEASON4_RPC_URL' : 'BASE_SEPOLIA_RPC_URL or SEASON4_RPC_URL',
    value,
  )
}

function getFaucetCooldownSeconds(target: DeploymentTarget): bigint {
  return target === 'toy' ? TOY_FAUCET_COOLDOWN_SECONDS : MAIN_FAUCET_COOLDOWN_SECONDS
}

async function readContractSources(): Promise<Record<string, { content: string }>> {
  const files = [
    'MockUSDC.sol',
    'Season4Faucet.sol',
    'PredictionMarketManager.sol',
  ]

  const sources = await Promise.all(files.map(async (filename) => {
    const filePath = path.join(CONTRACTS_DIR, filename)
    return [filename, { content: await fs.readFile(filePath, 'utf8') }] as const
  }))

  return Object.fromEntries(sources)
}

function compileContracts(inputSources: Record<string, { content: string }>): Record<string, ContractArtifact> {
  const input = {
    language: 'Solidity',
    sources: inputSources,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    contracts?: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>
    errors?: Array<{ severity: string; formattedMessage: string }>
  }

  const errors = output.errors?.filter((entry) => entry.severity === 'error') ?? []
  if (errors.length > 0) {
    throw new Error(errors.map((entry) => entry.formattedMessage).join('\n\n'))
  }

  const mockUsdc = output.contracts?.['MockUSDC.sol']?.MockUSDC
  const faucet = output.contracts?.['Season4Faucet.sol']?.Season4Faucet
  const manager = output.contracts?.['PredictionMarketManager.sol']?.PredictionMarketManager
  if (!mockUsdc || !faucet || !manager) {
    throw new Error('Failed to compile all Season 4 contracts')
  }

  return {
    MockUSDC: {
      abi: mockUsdc.abi,
      bytecode: `0x${mockUsdc.evm.bytecode.object}` as Hex,
    },
    Season4Faucet: {
      abi: faucet.abi,
      bytecode: `0x${faucet.evm.bytecode.object}` as Hex,
    },
    PredictionMarketManager: {
      abi: manager.abi,
      bytecode: `0x${manager.evm.bytecode.object}` as Hex,
    },
  }
}

async function deployContracts(target: DeploymentTarget): Promise<DeploymentSummary> {
  const privateKey = getTargetPrivateKey(target)
  const rpcUrl = getTargetRpcUrl(target)
  const account = privateKeyToAccount(privateKey)

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  })

  const [balance, startBlock, sources] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getBlockNumber(),
    readContractSources(),
  ])

  if (balance <= BigInt(0)) {
    throw new Error('The Season 4 deployer wallet has no Base Sepolia ETH')
  }

  const artifacts = compileContracts(sources)

  const collateralDeployHash = await walletClient.deployContract({
    abi: artifacts.MockUSDC.abi,
    bytecode: artifacts.MockUSDC.bytecode,
    account,
    args: [],
  })
  const collateralReceipt = await publicClient.waitForTransactionReceipt({ hash: collateralDeployHash })
  const collateralTokenAddress = collateralReceipt.contractAddress
  if (!collateralTokenAddress) {
    throw new Error('MockUSDC deployment returned no contract address')
  }

  const faucetDeployHash = await walletClient.deployContract({
    abi: artifacts.Season4Faucet.abi,
    bytecode: artifacts.Season4Faucet.bytecode,
    account,
    args: [collateralTokenAddress, FAUCET_CLAIM_AMOUNT, getFaucetCooldownSeconds(target)],
  })
  const faucetReceipt = await publicClient.waitForTransactionReceipt({ hash: faucetDeployHash })
  const faucetAddress = faucetReceipt.contractAddress
  if (!faucetAddress) {
    throw new Error('Season4Faucet deployment returned no contract address')
  }

  const managerDeployHash = await walletClient.deployContract({
    abi: artifacts.PredictionMarketManager.abi,
    bytecode: artifacts.PredictionMarketManager.bytecode,
    account,
    args: [BigInt(1)],
  })
  const managerReceipt = await publicClient.waitForTransactionReceipt({ hash: managerDeployHash })
  const marketManagerAddress = managerReceipt.contractAddress
  if (!marketManagerAddress) {
    throw new Error('PredictionMarketManager deployment returned no contract address')
  }

  const mintTxHash = await walletClient.writeContract({
    address: collateralTokenAddress,
    abi: artifacts.MockUSDC.abi,
    functionName: 'mint',
    args: [faucetAddress, FAUCET_RESERVE],
    account,
  })
  await publicClient.waitForTransactionReceipt({ hash: mintTxHash })

  return {
    target,
    deployer: account.address,
    balanceEth: formatEther(balance),
    blockNumber: startBlock.toString(),
    collateralTokenAddress,
    faucetAddress,
    marketManagerAddress,
    mintTxHash,
    collateralExplorerUrl: `https://sepolia.basescan.org/address/${collateralTokenAddress}`,
    faucetExplorerUrl: `https://sepolia.basescan.org/address/${faucetAddress}`,
    marketManagerExplorerUrl: `https://sepolia.basescan.org/address/${marketManagerAddress}`,
  }
}

async function updateLocalEnv(summary: DeploymentSummary): Promise<void> {
  const current = await fs.readFile(LOCAL_ENV_PATH, 'utf8')

  const updates: Record<string, string> = summary.target === 'toy'
    ? {
        SEASON4_TOY_COLLATERAL_TOKEN_ADDRESS: summary.collateralTokenAddress,
        SEASON4_TOY_FAUCET_ADDRESS: summary.faucetAddress,
        SEASON4_TOY_MARKET_MANAGER_ADDRESS: summary.marketManagerAddress,
        SEASON4_TOY_INDEX_FROM_BLOCK: summary.blockNumber,
      }
    : {
        SEASON4_COLLATERAL_TOKEN_ADDRESS: summary.collateralTokenAddress,
        SEASON4_FAUCET_ADDRESS: summary.faucetAddress,
        SEASON4_MARKET_MANAGER_ADDRESS: summary.marketManagerAddress,
        SEASON4_INDEX_FROM_BLOCK: summary.blockNumber,
      }

  let next = current
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    const replacement = `${key}="${value}"`
    if (pattern.test(next)) {
      next = next.replace(pattern, replacement)
    } else {
      next = `${next.trimEnd()}\n${replacement}\n`
    }
  }

  await fs.writeFile(LOCAL_ENV_PATH, next, 'utf8')
}

async function main() {
  const target = parseDeploymentTarget(process.argv.slice(2))
  const summary = await deployContracts(target)
  await updateLocalEnv(summary)
  console.log(JSON.stringify(summary, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
