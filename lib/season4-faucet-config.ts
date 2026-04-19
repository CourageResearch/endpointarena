export const MOCK_USDC_DECIMALS = 1_000_000

export const DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC = BigInt(1_000_000_000)

export function getSeason4FaucetClaimAmountAtomic(): bigint {
  return DEFAULT_SEASON4_FAUCET_CLAIM_AMOUNT_ATOMIC
}

export function formatSeason4FaucetUsdcAmount(amountAtomic: bigint = getSeason4FaucetClaimAmountAtomic()): string {
  const display = Number(amountAtomic) / MOCK_USDC_DECIMALS
  return Number.isInteger(display) ? display.toLocaleString('en-US') : display.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function formatSeason4FaucetEthAmount(wei: bigint): string {
  const display = Number(wei) / 1e18
  return display.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}
