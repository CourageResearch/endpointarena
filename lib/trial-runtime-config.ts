import {
  getMarketRuntimeConfig,
  updateMarketRuntimeConfig,
  type MarketRuntimeConfig,
  type MarketRuntimeConfigPatchInput,
} from '@/lib/markets/runtime-config'

export type TrialRuntimeConfig = MarketRuntimeConfig
export type TrialRuntimeConfigPatchInput = MarketRuntimeConfigPatchInput

export const getTrialRuntimeConfig = getMarketRuntimeConfig
export const updateTrialRuntimeConfig = updateMarketRuntimeConfig
