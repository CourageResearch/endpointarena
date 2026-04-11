import { eq } from 'drizzle-orm'
import { db, marketRuntimeConfigs } from '@/lib/db'
import { ConfigurationError, ValidationError } from '@/lib/errors'

const MARKET_RUNTIME_CONFIG_ID = 'default'
const MAX_CONFIG_NUMBER = 10_000_000
export const DEFAULT_TOY_TRIAL_COUNT = 0
export const MIN_TOY_TRIAL_COUNT = 0
type MarketRuntimeConfigDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export type MarketRuntimeConfig = {
  openingLmsrB: number
  toyTrialCount: number
  createdAt: Date
  updatedAt: Date
}

export type MarketRuntimeConfigPatchInput = Partial<{
  openingLmsrB: unknown
  toyTrialCount: unknown
}>

type MarketRuntimeConfigPatch = Partial<{
  openingLmsrB: number
  toyTrialCount: number
}>

const marketRuntimeConfigColumns = {
  id: true,
  openingLmsrB: true,
  toyTrialCount: true,
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

  return patch
}

function mapRow(row: typeof marketRuntimeConfigs.$inferSelect): MarketRuntimeConfig {
  if (!row.createdAt || !row.updatedAt) {
    throw new ConfigurationError('Market runtime config is missing timestamps')
  }

  return {
    openingLmsrB: row.openingLmsrB,
    toyTrialCount: row.toyTrialCount ?? DEFAULT_TOY_TRIAL_COUNT,
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
