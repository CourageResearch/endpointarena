import type { Address } from 'viem'
import { getActiveDatabaseTarget, type DatabaseTarget } from '@/lib/database-target'
import { ConfigurationError } from '@/lib/errors'
import { SEASON4_CHAIN_ID, SEASON4_CHAIN_NAME } from '@/lib/onchain/constants'

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAddress(value: string | null | undefined): `0x${string}` | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new ConfigurationError(`Invalid Ethereum address: ${trimmed}`)
  }

  return trimmed as `0x${string}`
}

function normalizePrivateKey(value: string | null | undefined): `0x${string}` | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    throw new ConfigurationError('Invalid Season 4 deployer private key')
  }

  return trimmed as `0x${string}`
}

function parsePositiveInteger(value: string | null | undefined, fallback: number): number {
  const trimmed = trimOrNull(value)
  if (!trimmed) return fallback
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigurationError(`Expected a positive integer but received "${trimmed}"`)
  }

  return parsed
}

function parseNonNegativeInteger(value: string | null | undefined, fallback: number): number {
  const trimmed = trimOrNull(value)
  if (!trimmed) return fallback
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ConfigurationError(`Expected a non-negative integer but received "${trimmed}"`)
  }

  return parsed
}

function getImplicitOnchainTarget(): DatabaseTarget {
  try {
    return getActiveDatabaseTarget()
  } catch {
    return 'main'
  }
}

function readTargetEnv(target: DatabaseTarget, key: string): string | null {
  if (target === 'toy') {
    return trimOrNull(process.env[`SEASON4_TOY_${key}`])
  }

  return trimOrNull(process.env[`SEASON4_${key}`])
}

function readRpcUrl(target: DatabaseTarget): string | null {
  if (target === 'toy') {
    return readTargetEnv('toy', 'RPC_URL')
      ?? trimOrNull(process.env.BASE_SEPOLIA_RPC_URL)
      ?? trimOrNull(process.env.SEASON4_RPC_URL)
  }

  return trimOrNull(process.env.BASE_SEPOLIA_RPC_URL)
    ?? trimOrNull(process.env.SEASON4_RPC_URL)
}

export type Season4OnchainConfig = {
  target: DatabaseTarget
  enabled: boolean
  chainId: number
  chainName: string
  rpcUrl: string | null
  managerAddress: Address | null
  faucetAddress: Address | null
  collateralTokenAddress: Address | null
  indexFromBlock: bigint
}

export type ResolvedSeason4OnchainConfig = {
  target: DatabaseTarget
  enabled: true
  chainId: number
  chainName: string
  rpcUrl: string
  managerAddress: Address
  faucetAddress: Address
  collateralTokenAddress: Address
  indexFromBlock: bigint
}

export function getSeason4OnchainConfig(target: DatabaseTarget = getImplicitOnchainTarget()): Season4OnchainConfig {
  const chainId = parsePositiveInteger(
    target === 'toy'
      ? readTargetEnv('toy', 'CHAIN_ID') ?? process.env.SEASON4_CHAIN_ID
      : process.env.SEASON4_CHAIN_ID,
    SEASON4_CHAIN_ID,
  )
  const rpcUrl = readRpcUrl(target)
  const managerAddress = normalizeAddress(readTargetEnv(target, 'MARKET_MANAGER_ADDRESS'))
  const faucetAddress = normalizeAddress(readTargetEnv(target, 'FAUCET_ADDRESS'))
  const collateralTokenAddress = normalizeAddress(readTargetEnv(target, 'COLLATERAL_TOKEN_ADDRESS'))
  const indexFromBlock = BigInt(parseNonNegativeInteger(
    target === 'toy'
      ? readTargetEnv('toy', 'INDEX_FROM_BLOCK')
      : process.env.SEASON4_INDEX_FROM_BLOCK,
    0,
  ))
  const enabled = Boolean(rpcUrl && managerAddress && faucetAddress && collateralTokenAddress)

  return {
    target,
    enabled,
    chainId,
    chainName: chainId === SEASON4_CHAIN_ID ? SEASON4_CHAIN_NAME : `Chain ${chainId}`,
    rpcUrl,
    managerAddress,
    faucetAddress,
    collateralTokenAddress,
    indexFromBlock,
  }
}

export function requireSeason4OnchainConfig(target: DatabaseTarget = getImplicitOnchainTarget()): ResolvedSeason4OnchainConfig {
  const config = getSeason4OnchainConfig(target)
  if (!config.rpcUrl || !config.managerAddress || !config.faucetAddress || !config.collateralTokenAddress) {
    if (config.target === 'toy') {
      throw new ConfigurationError(
        'Toy DB Season 4 onchain config is incomplete. Set SEASON4_TOY_MARKET_MANAGER_ADDRESS, SEASON4_TOY_FAUCET_ADDRESS, SEASON4_TOY_COLLATERAL_TOKEN_ADDRESS, and BASE_SEPOLIA_RPC_URL or SEASON4_TOY_RPC_URL.',
      )
    }

    throw new ConfigurationError(
      'Season 4 onchain config is incomplete. Set BASE_SEPOLIA_RPC_URL, SEASON4_MARKET_MANAGER_ADDRESS, SEASON4_FAUCET_ADDRESS, and SEASON4_COLLATERAL_TOKEN_ADDRESS.',
    )
  }

  return {
    target: config.target,
    enabled: true,
    chainId: config.chainId,
    chainName: config.chainName,
    rpcUrl: config.rpcUrl,
    managerAddress: config.managerAddress,
    faucetAddress: config.faucetAddress,
    collateralTokenAddress: config.collateralTokenAddress,
    indexFromBlock: config.indexFromBlock,
  }
}

export function getSeason4DeployerPrivateKey(target: DatabaseTarget = getImplicitOnchainTarget()): `0x${string}` | null {
  if (target === 'toy') {
    return normalizePrivateKey(process.env.SEASON4_TOY_DEPLOYER_PRIVATE_KEY)
      ?? normalizePrivateKey(process.env.SEASON4_DEPLOYER_PRIVATE_KEY)
  }

  return normalizePrivateKey(process.env.SEASON4_DEPLOYER_PRIVATE_KEY)
}
