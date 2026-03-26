const MOCK_VALIDATION_MARKERS = [
  'mock validator trade to verify local action persistence',
  'mock validator hold due to zero allowed buy capacity',
  'local validator mock forecast',
  'action linkage, and cycle idempotency without external provider dependencies',
]

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isMockMarketExplanation(value: string | null | undefined): boolean {
  const text = normalize(value)
  if (!text) return false
  return MOCK_VALIDATION_MARKERS.some((marker) => text.includes(marker))
}

export function isMockMarketInferenceGeo(value: string | null | undefined): boolean {
  return normalize(value) === 'local-mock'
}

export function isMockMarketActionLike(action: {
  explanation?: string | null
  error?: string | null
  errorDetails?: string | null
}): boolean {
  return (
    isMockMarketExplanation(action.explanation) ||
    isMockMarketExplanation(action.error) ||
    isMockMarketExplanation(action.errorDetails)
  )
}

export function isMockMarketSnapshotLike(snapshot: {
  reasoning?: string | null
  proposedExplanation?: string | null
  inferenceGeo?: string | null
}): boolean {
  return (
    isMockMarketExplanation(snapshot.reasoning) ||
    isMockMarketExplanation(snapshot.proposedExplanation) ||
    isMockMarketInferenceGeo(snapshot.inferenceGeo)
  )
}
