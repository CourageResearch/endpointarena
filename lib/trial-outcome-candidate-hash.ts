import crypto from 'node:crypto'

export type TrialOutcomeCandidateHashOutcome = 'YES' | 'NO' | 'NO_DECISION'

export function normalizeTrialOutcomeEvidenceUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    url.hash = ''
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.protocol}//${hostname}${pathname}${url.search}`.toLowerCase()
  } catch {
    return trimmed.replace(/[),.;]+$/g, '').replace(/\/+$/, '').toLowerCase()
  }
}

export function buildTrialOutcomeEvidenceHash(
  outcome: TrialOutcomeCandidateHashOutcome,
  evidenceUrls: string[],
): string {
  const normalized = Array.from(new Set(
    evidenceUrls
      .map((url) => normalizeTrialOutcomeEvidenceUrl(url))
      .filter((url) => url.length > 0),
  )).sort()

  return crypto.createHash('sha256')
    .update(JSON.stringify({ outcome, urls: normalized }))
    .digest('hex')
}
