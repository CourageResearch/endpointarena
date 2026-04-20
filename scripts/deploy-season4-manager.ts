import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import solc from 'solc'
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const CONTRACTS_DIR = path.resolve(process.cwd(), 'contracts/src')

type DeploymentTarget = 'main' | 'toy'

type ManagerArtifact = {
  abi: Abi
  bytecode: Hex
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

function parseExplicitInitialNextMarketId(argv: string[], target: DeploymentTarget): bigint | null {
  const flagPrefix = '--initial-next-market-id='
  const flag = argv.find((arg) => arg.startsWith(flagPrefix))
  const rawValue = flag
    ? flag.slice(flagPrefix.length)
    : target === 'toy'
      ? trimOrNull(process.env.SEASON4_TOY_MANAGER_INITIAL_NEXT_MARKET_ID)
        ?? trimOrNull(process.env.SEASON4_MANAGER_INITIAL_NEXT_MARKET_ID)
      : trimOrNull(process.env.SEASON4_MANAGER_INITIAL_NEXT_MARKET_ID)

  if (!rawValue) return null
  if (!/^[1-9][0-9]*$/.test(rawValue)) {
    throw new Error(`Invalid initial next market id: ${rawValue}`)
  }

  return BigInt(rawValue)
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

  return requireValue(target === 'toy' ? 'SEASON4_TOY_RPC_URL or BASE_SEPOLIA_RPC_URL' : 'BASE_SEPOLIA_RPC_URL or SEASON4_RPC_URL', value)
}

function getCurrentManagerAddress(target: DeploymentTarget): Address | null {
  const value = target === 'toy'
    ? trimOrNull(process.env.SEASON4_TOY_MARKET_MANAGER_ADDRESS)
    : trimOrNull(process.env.SEASON4_MARKET_MANAGER_ADDRESS)

  if (!value) return null
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid current manager address: ${value}`)
  }

  return value as Address
}

async function compileManager(): Promise<ManagerArtifact> {
  const sourcePath = path.join(CONTRACTS_DIR, 'PredictionMarketManager.sol')
  const source = await fs.readFile(sourcePath, 'utf8')
  const input = {
    language: 'Solidity',
    sources: {
      'PredictionMarketManager.sol': {
        content: source,
      },
    },
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

  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors ?? []) as Array<{ severity: string; formattedMessage: string }>
  const fatalErrors = errors.filter((error) => error.severity === 'error')
  if (fatalErrors.length > 0) {
    throw new Error(fatalErrors.map((error) => error.formattedMessage).join('\n'))
  }

  const manager = output.contracts?.['PredictionMarketManager.sol']?.PredictionMarketManager
  if (!manager?.abi || !manager?.evm?.bytecode?.object) {
    throw new Error('PredictionMarketManager artifact was not emitted by solc')
  }

  return {
    abi: manager.abi,
    bytecode: `0x${manager.evm.bytecode.object}` as Hex,
  }
}

async function main() {
  const target = parseDeploymentTarget(process.argv.slice(2))
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
  const artifact = await compileManager()
  const currentManagerAddress = getCurrentManagerAddress(target)
  const explicitInitialNextMarketId = parseExplicitInitialNextMarketId(process.argv.slice(2), target)
  const currentNextMarketId = currentManagerAddress
    ? await publicClient.readContract({
        address: currentManagerAddress,
        abi: artifact.abi,
        functionName: 'nextMarketId',
      }) as bigint
    : null
  const initialNextMarketId = explicitInitialNextMarketId ?? currentNextMarketId ?? BigInt(1)
  const startBlock = await publicClient.getBlockNumber()

  const deployHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    account,
    args: [initialNextMarketId],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
  if (!receipt.contractAddress) {
    throw new Error('PredictionMarketManager deployment returned no contract address')
  }

  const code = await publicClient.getCode({ address: receipt.contractAddress })
  const summary = {
    target,
    deployer: account.address,
    previousManagerAddress: currentManagerAddress,
    previousNextMarketId: currentNextMarketId?.toString() ?? null,
    initialNextMarketId: initialNextMarketId.toString(),
    marketManagerAddress: receipt.contractAddress,
    deployTxHash: deployHash,
    startBlock: startBlock.toString(),
    deployBlock: receipt.blockNumber.toString(),
    runtimeCodeHash: code ? keccak256(code) : null,
    explorerUrl: `https://sepolia.basescan.org/address/${receipt.contractAddress}`,
    railwayVariables: {
      [target === 'toy' ? 'SEASON4_TOY_MARKET_MANAGER_ADDRESS' : 'SEASON4_MARKET_MANAGER_ADDRESS']: receipt.contractAddress,
      [target === 'toy' ? 'SEASON4_TOY_INDEX_FROM_BLOCK' : 'SEASON4_INDEX_FROM_BLOCK']: startBlock.toString(),
    },
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
