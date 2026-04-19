import {
  DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC,
  MOCK_USDC_DECIMALS,
} from '@/lib/season4-faucet-config'

export const DEFAULT_SEASON4_MODEL_STARTING_BANKROLL_DISPLAY =
  Number(DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC) / MOCK_USDC_DECIMALS

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getSeason4ModelStartingBankrollDisplay(): number {
  const raw = trimOrNull(process.env.SEASON4_MODEL_STARTING_BANKROLL_DISPLAY)
  if (!raw) return DEFAULT_SEASON4_MODEL_STARTING_BANKROLL_DISPLAY

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_SEASON4_MODEL_STARTING_BANKROLL_DISPLAY
}
