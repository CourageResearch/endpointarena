import dotenv from 'dotenv'
import { CdpClient } from '@coinbase/cdp-sdk'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type FaucetToken = 'eth' | 'usdc' | 'eurc' | 'cbbtc'

type ParsedArgs = {
  address: string | null
  token: FaucetToken
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAddress(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : null
}

function getFlagValue(argv: string[], name: string): string | null {
  const exact = argv.find((arg) => arg.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)

  const index = argv.findIndex((arg) => arg === name)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

function parseArgs(argv: string[]): ParsedArgs {
  const rawToken = (trimOrNull(getFlagValue(argv, '--token')) ?? 'eth').toLowerCase()
  if (!['eth', 'usdc', 'eurc', 'cbbtc'].includes(rawToken)) {
    throw new Error(`Unsupported faucet token "${rawToken}". Use eth, usdc, eurc, or cbbtc.`)
  }

  return {
    address: normalizeAddress(getFlagValue(argv, '--address')),
    token: rawToken as FaucetToken,
  }
}

function requireEnv(name: string): string {
  const value = trimOrNull(process.env[name])
  if (!value) {
    throw new Error(`${name} is not set`)
  }

  return value
}

function resolveTargetAddress(cliAddress: string | null): string {
  const address = cliAddress ?? normalizeAddress(process.env.SEASON4_DEPLOYER_ADDRESS)
  if (!address) {
    throw new Error('No target address found. Pass --address 0x... or set SEASON4_DEPLOYER_ADDRESS.')
  }

  return address
}

async function main() {
  requireEnv('CDP_API_KEY_ID')
  requireEnv('CDP_API_KEY_SECRET')
  requireEnv('CDP_WALLET_SECRET')

  const args = parseArgs(process.argv.slice(2))
  const address = resolveTargetAddress(args.address)

  const cdp = new CdpClient()
  const faucetResponse = await cdp.evm.requestFaucet({
    address,
    network: 'base-sepolia',
    token: args.token,
  })

  const transactionHash = 'transactionHash' in faucetResponse
    ? faucetResponse.transactionHash
    : String(faucetResponse)

  console.log(JSON.stringify({
    network: 'base-sepolia',
    token: args.token,
    address,
    transactionHash,
    explorerUrl: `https://sepolia.basescan.org/tx/${transactionHash}`,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
