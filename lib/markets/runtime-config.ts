import { eq } from 'drizzle-orm'
import { db, marketRuntimeConfigs } from '@/lib/db'
import { ConfigurationError, ValidationError } from '@/lib/errors'

const MARKET_RUNTIME_CONFIG_ID = 'default'
const MAX_CONFIG_NUMBER = 10_000_000
export const DEFAULT_SIGNUP_USER_LIMIT = 56

export type MarketRuntimeConfig = {
  warmupRunCount: number
  warmupMaxTradeUsd: number
  warmupBuyCashFraction: number
  steadyMaxTradeUsd: number
  steadyBuyCashFraction: number
  maxPositionPerSideShares: number
  openingLmsrB: number
  signupUserLimit: number
  createdAt: Date
  updatedAt: Date
}

export type MarketRuntimeConfigPatchInput = Partial<{
  warmupRunCount: unknown
  warmupMaxTradeUsd: unknown
  warmupBuyCashFraction: unknown
  steadyMaxTradeUsd: unknown
  steadyBuyCashFraction: unknown
  maxPositionPerSideShares: unknown
  openingLmsrB: unknown
  signupUserLimit: unknown
}>

type MarketRuntimeConfigPatch = Partial<{
  warmupRunCount: number
  warmupMaxTradeUsd: number
  warmupBuyCashFraction: number
  steadyMaxTradeUsd: number
  steadyBuyCashFraction: number
  maxPositionPerSideShares: number
  openingLmsrB: number
  signupUserLimit: number
}>

function coerceNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${fieldName} must be a valid number`)
  }
  return parsed
}

function parsePatch(input: MarketRuntimeConfigPatchInput): MarketRuntimeConfigPatch {
  const patch: MarketRuntimeConfigPatch = {}

  if (input.warmupRunCount !== undefined) {
    const parsed = Math.round(coerceNumber(input.warmupRunCount, 'warmupRunCount'))
    if (parsed < 0 || parsed > 365) {
      throw new ValidationError('warmupRunCount must be between 0 and 365')
    }
    patch.warmupRunCount = parsed
  }

  if (input.warmupMaxTradeUsd !== undefined) {
    const parsed = coerceNumber(input.warmupMaxTradeUsd, 'warmupMaxTradeUsd')
    if (parsed < 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`warmupMaxTradeUsd must be between 0 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.warmupMaxTradeUsd = parsed
  }

  if (input.warmupBuyCashFraction !== undefined) {
    const parsed = coerceNumber(input.warmupBuyCashFraction, 'warmupBuyCashFraction')
    if (parsed < 0 || parsed > 1) {
      throw new ValidationError('warmupBuyCashFraction must be between 0 and 1')
    }
    patch.warmupBuyCashFraction = parsed
  }

  if (input.steadyMaxTradeUsd !== undefined) {
    const parsed = coerceNumber(input.steadyMaxTradeUsd, 'steadyMaxTradeUsd')
    if (parsed < 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`steadyMaxTradeUsd must be between 0 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.steadyMaxTradeUsd = parsed
  }

  if (input.steadyBuyCashFraction !== undefined) {
    const parsed = coerceNumber(input.steadyBuyCashFraction, 'steadyBuyCashFraction')
    if (parsed < 0 || parsed > 1) {
      throw new ValidationError('steadyBuyCashFraction must be between 0 and 1')
    }
    patch.steadyBuyCashFraction = parsed
  }

  if (input.maxPositionPerSideShares !== undefined) {
    const parsed = coerceNumber(input.maxPositionPerSideShares, 'maxPositionPerSideShares')
    if (parsed < 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`maxPositionPerSideShares must be between 0 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.maxPositionPerSideShares = parsed
  }

  if (input.openingLmsrB !== undefined) {
    const parsed = Math.round(coerceNumber(input.openingLmsrB, 'openingLmsrB'))
    if (parsed <= 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`openingLmsrB must be between 1 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.openingLmsrB = parsed
  }

  if (input.signupUserLimit !== undefined) {
    const parsed = Math.round(coerceNumber(input.signupUserLimit, 'signupUserLimit'))
    if (parsed < 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`signupUserLimit must be between 0 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.signupUserLimit = parsed
  }

  return patch
}

function mapRow(row: typeof marketRuntimeConfigs.$inferSelect): MarketRuntimeConfig {
  if (!row.createdAt || !row.updatedAt) {
    throw new ConfigurationError('Market runtime config is missing timestamps')
  }

  return {
    warmupRunCount: row.warmupRunCount,
    warmupMaxTradeUsd: row.warmupMaxTradeUsd,
    warmupBuyCashFraction: row.warmupBuyCashFraction,
    steadyMaxTradeUsd: row.steadyMaxTradeUsd,
    steadyBuyCashFraction: row.steadyBuyCashFraction,
    maxPositionPerSideShares: row.maxPositionPerSideShares,
    openingLmsrB: row.openingLmsrB,
    signupUserLimit: row.signupUserLimit ?? DEFAULT_SIGNUP_USER_LIMIT,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getMarketRuntimeConfig(): Promise<MarketRuntimeConfig> {
  const row = await db.query.marketRuntimeConfigs.findFirst({
    where: eq(marketRuntimeConfigs.id, MARKET_RUNTIME_CONFIG_ID),
  })

  if (!row) {
    throw new ConfigurationError(
      `Market runtime config row "${MARKET_RUNTIME_CONFIG_ID}" is missing. Run db:add-market-runtime-config.`
    )
  }

  return mapRow(row)
}

export async function updateMarketRuntimeConfig(
  input: MarketRuntimeConfigPatchInput
): Promise<MarketRuntimeConfig> {
  const patch = parsePatch(input)
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Provide at least one market config field to update')
  }

  const [updated] = await db.update(marketRuntimeConfigs)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(marketRuntimeConfigs.id, MARKET_RUNTIME_CONFIG_ID))
    .returning()

  if (!updated) {
    throw new ConfigurationError(
      `Market runtime config row "${MARKET_RUNTIME_CONFIG_ID}" is missing. Run db:add-market-runtime-config.`
    )
  }

  return mapRow(updated)
}
