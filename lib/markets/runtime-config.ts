import { eq } from 'drizzle-orm'
import { db, marketRuntimeConfigs } from '@/lib/db'
import { ConfigurationError, ValidationError } from '@/lib/errors'

const MARKET_RUNTIME_CONFIG_ID = 'default'
const MAX_CONFIG_NUMBER = 10_000_000
export const DEFAULT_TOY_TRIAL_COUNT = 0
export const MIN_TOY_TRIAL_COUNT = 0
export const DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY = 1_000
export const DEFAULT_SEASON4_STARTING_BANKROLL_DISPLAY = 1000
export const DEFAULT_SEASON4_HUMAN_STARTING_BANKROLL_DISPLAY = 100
type MarketRuntimeConfigDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export type MarketRuntimeConfig = {
  openingLmsrB: number
  toyTrialCount: number
  season4MarketLiquidityBDisplay: number
  season4HumanStartingBankrollDisplay: number
  season4StartingBankrollDisplay: number
  createdAt: Date
  updatedAt: Date
}

export type MarketRuntimeConfigPatchInput = Partial<{
  openingLmsrB: unknown
  toyTrialCount: unknown
  season4MarketLiquidityBDisplay: unknown
  season4HumanStartingBankrollDisplay: unknown
  season4StartingBankrollDisplay: unknown
}>

type MarketRuntimeConfigPatch = Partial<{
  openingLmsrB: number
  toyTrialCount: number
  season4MarketLiquidityBDisplay: number
  season4HumanStartingBankrollDisplay: number
  season4StartingBankrollDisplay: number
}>

const marketRuntimeConfigColumns = {
  id: true,
  openingLmsrB: true,
  toyTrialCount: true,
  season4MarketLiquidityBDisplay: true,
  season4HumanStartingBankrollDisplay: true,
  season4StartingBankrollDisplay: true,
  createdAt: true,
  updatedAt: true,
} as const

function coerceNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${fieldName} must be a valid number`)
  }
  return parsed
}

function parsePatch(input: MarketRuntimeConfigPatchInput): MarketRuntimeConfigPatch {
  const patch: MarketRuntimeConfigPatch = {}

  if (input.openingLmsrB !== undefined) {
    const parsed = Math.round(coerceNumber(input.openingLmsrB, 'openingLmsrB'))
    if (parsed <= 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`openingLmsrB must be between 1 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.openingLmsrB = parsed
  }

  if (input.toyTrialCount !== undefined) {
    const parsed = Math.round(coerceNumber(input.toyTrialCount, 'toyTrialCount'))
    if (parsed < MIN_TOY_TRIAL_COUNT) {
      throw new ValidationError(`toyTrialCount must be at least ${MIN_TOY_TRIAL_COUNT}`)
    }
    patch.toyTrialCount = parsed
  }

  if (input.season4MarketLiquidityBDisplay !== undefined) {
    const parsed = coerceNumber(input.season4MarketLiquidityBDisplay, 'season4MarketLiquidityBDisplay')
    if (parsed <= 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`season4MarketLiquidityBDisplay must be greater than 0 and no more than ${MAX_CONFIG_NUMBER}`)
    }
    patch.season4MarketLiquidityBDisplay = parsed
  }

  if (input.season4StartingBankrollDisplay !== undefined) {
    const parsed = coerceNumber(input.season4StartingBankrollDisplay, 'season4StartingBankrollDisplay')
    if (parsed < 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`season4StartingBankrollDisplay must be between 0 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.season4StartingBankrollDisplay = parsed
  }

  if (input.season4HumanStartingBankrollDisplay !== undefined) {
    const parsed = coerceNumber(input.season4HumanStartingBankrollDisplay, 'season4HumanStartingBankrollDisplay')
    if (parsed < 0 || parsed > MAX_CONFIG_NUMBER) {
      throw new ValidationError(`season4HumanStartingBankrollDisplay must be between 0 and ${MAX_CONFIG_NUMBER}`)
    }
    patch.season4HumanStartingBankrollDisplay = parsed
  }

  return patch
}

function mapRow(row: typeof marketRuntimeConfigs.$inferSelect): MarketRuntimeConfig {
  if (!row.createdAt || !row.updatedAt) {
    throw new ConfigurationError('Market runtime config is missing timestamps')
  }

  return {
    openingLmsrB: row.openingLmsrB,
    toyTrialCount: row.toyTrialCount ?? DEFAULT_TOY_TRIAL_COUNT,
    season4MarketLiquidityBDisplay: row.season4MarketLiquidityBDisplay ?? DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY,
    season4HumanStartingBankrollDisplay: row.season4HumanStartingBankrollDisplay ?? DEFAULT_SEASON4_HUMAN_STARTING_BANKROLL_DISPLAY,
    season4StartingBankrollDisplay: row.season4StartingBankrollDisplay ?? DEFAULT_SEASON4_STARTING_BANKROLL_DISPLAY,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getMarketRuntimeConfig(
  dbClient: MarketRuntimeConfigDbClient = db,
): Promise<MarketRuntimeConfig> {
  const row = await dbClient.query.marketRuntimeConfigs.findFirst({
    columns: marketRuntimeConfigColumns,
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
  input: MarketRuntimeConfigPatchInput,
  dbClient: MarketRuntimeConfigDbClient = db,
): Promise<MarketRuntimeConfig> {
  const patch = parsePatch(input)
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Provide at least one market config field to update')
  }

  const [updated] = await dbClient.update(marketRuntimeConfigs)
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
