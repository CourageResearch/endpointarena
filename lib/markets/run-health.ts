const DEFAULT_STALE_TIMEOUT_MINUTES = 20
const MIN_STALE_TIMEOUT_MINUTES = 2
const MAX_STALE_TIMEOUT_MINUTES = 180

function parseStaleTimeoutMinutes(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_TIMEOUT_MINUTES
  if (parsed < MIN_STALE_TIMEOUT_MINUTES) return MIN_STALE_TIMEOUT_MINUTES
  if (parsed > MAX_STALE_TIMEOUT_MINUTES) return MAX_STALE_TIMEOUT_MINUTES
  return parsed
}

export const MARKET_RUN_STALE_TIMEOUT_MINUTES = parseStaleTimeoutMinutes(
  process.env.MARKET_RUN_STALE_TIMEOUT_MINUTES
)

export const MARKET_RUN_STALE_TIMEOUT_MS = MARKET_RUN_STALE_TIMEOUT_MINUTES * 60 * 1000
