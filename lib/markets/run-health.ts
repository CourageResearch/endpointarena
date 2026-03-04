const DEFAULT_STALE_TIMEOUT_MINUTES = 20
const MIN_STALE_TIMEOUT_MINUTES = 2
const MAX_STALE_TIMEOUT_MINUTES = 180
const DEFAULT_MODEL_RESPONSE_TIMEOUT_SECONDS = 180
const MIN_MODEL_RESPONSE_TIMEOUT_SECONDS = 30
const MAX_MODEL_RESPONSE_TIMEOUT_SECONDS = 1800

function parseStaleTimeoutMinutes(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_TIMEOUT_MINUTES
  if (parsed < MIN_STALE_TIMEOUT_MINUTES) return MIN_STALE_TIMEOUT_MINUTES
  if (parsed > MAX_STALE_TIMEOUT_MINUTES) return MAX_STALE_TIMEOUT_MINUTES
  return parsed
}

function parseModelResponseTimeoutSeconds(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_MODEL_RESPONSE_TIMEOUT_SECONDS
  if (parsed < MIN_MODEL_RESPONSE_TIMEOUT_SECONDS) return MIN_MODEL_RESPONSE_TIMEOUT_SECONDS
  if (parsed > MAX_MODEL_RESPONSE_TIMEOUT_SECONDS) return MAX_MODEL_RESPONSE_TIMEOUT_SECONDS
  return parsed
}

export const MARKET_RUN_STALE_TIMEOUT_MINUTES = parseStaleTimeoutMinutes(
  process.env.MARKET_RUN_STALE_TIMEOUT_MINUTES
)

export const MARKET_RUN_STALE_TIMEOUT_SECONDS = MARKET_RUN_STALE_TIMEOUT_MINUTES * 60
export const MARKET_RUN_STALE_TIMEOUT_MS = MARKET_RUN_STALE_TIMEOUT_MINUTES * 60 * 1000

export const MARKET_MODEL_RESPONSE_TIMEOUT_SECONDS = parseModelResponseTimeoutSeconds(
  process.env.MARKET_MODEL_RESPONSE_TIMEOUT_SECONDS
)

export const MARKET_MODEL_RESPONSE_TIMEOUT_MS = MARKET_MODEL_RESPONSE_TIMEOUT_SECONDS * 1000
