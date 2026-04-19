import { ConfigurationError } from '@/lib/errors'

export const DEFAULT_SEASON4_MODEL_TRADE_AMOUNT_DISPLAY = 5

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getSeason4ModelTradeAmountDisplay(): number {
  const raw = trimOrNull(process.env.SEASON4_MODEL_TRADE_AMOUNT_DISPLAY)
  if (!raw) return DEFAULT_SEASON4_MODEL_TRADE_AMOUNT_DISPLAY

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigurationError('SEASON4_MODEL_TRADE_AMOUNT_DISPLAY must be a positive number')
  }

  return parsed
}
