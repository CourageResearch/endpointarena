const ANALYTICS_ENDPOINT = '/api/analytics'
const ANALYTICS_ANONYMOUS_ID_STORAGE_KEY = 'endpointarena:analytics:anonymous-id'
const ANALYTICS_EVENT_TYPES = ['pageview', 'click', 'trial_search'] as const
const NORMALIZED_ANONYMOUS_ID_PATTERN = /^[A-Za-z0-9._-]{16,200}$/

export type CanonicalAnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number]
export type AcceptedAnalyticsEventType = CanonicalAnalyticsEventType | 'market_search'

export type AnalyticsEventPayload = {
  type: AcceptedAnalyticsEventType
  url: string
  referrer?: string
  elementId?: string
  searchQuery?: string
  resultCount?: number | string
}

export type AnalyticsBatchPayload = {
  anonymousId?: string | null
  events: AnalyticsEventPayload[]
}

function createAnalyticsAnonymousId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
}

export function normalizeAnalyticsAnonymousId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (!NORMALIZED_ANONYMOUS_ID_PATTERN.test(normalized)) {
    return null
  }

  return normalized
}

export function normalizeAnalyticsEventType(value: unknown): CanonicalAnalyticsEventType | null {
  if (value === 'market_search') {
    return 'trial_search'
  }

  return typeof value === 'string' && ANALYTICS_EVENT_TYPES.includes(value as CanonicalAnalyticsEventType)
    ? value as CanonicalAnalyticsEventType
    : null
}

function getAnalyticsAnonymousId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const existingId = normalizeAnalyticsAnonymousId(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_STORAGE_KEY))
    if (existingId) {
      return existingId
    }

    const createdId = createAnalyticsAnonymousId()
    window.localStorage.setItem(ANALYTICS_ANONYMOUS_ID_STORAGE_KEY, createdId)
    return createdId
  } catch {
    return null
  }
}

function createAnalyticsBatchPayload(events: AnalyticsEventPayload[]): AnalyticsBatchPayload {
  return {
    anonymousId: getAnalyticsAnonymousId(),
    events,
  }
}

export function sendAnalyticsEvents(events: AnalyticsEventPayload[]): void {
  if (events.length === 0) {
    return
  }

  const payload = JSON.stringify(createAnalyticsBatchPayload(events))

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const body = typeof Blob === 'function'
      ? new Blob([payload], { type: 'application/json' })
      : payload
    navigator.sendBeacon(ANALYTICS_ENDPOINT, body)
    return
  }

  fetch(ANALYTICS_ENDPOINT, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {})
}

async function hashAnalyticsAnonymousId(anonymousId: string): Promise<string> {
  const data = new TextEncoder().encode(anonymousId)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export async function getAnalyticsSessionHash(anonymousId: unknown): Promise<string | null> {
  const normalizedAnonymousId = normalizeAnalyticsAnonymousId(anonymousId)
  if (!normalizedAnonymousId) {
    return null
  }

  return hashAnalyticsAnonymousId(normalizedAnonymousId)
}

export function countApproxUniqueVisitors(
  events: Array<{ sessionHash: string | null | undefined }>
): number {
  return new Set(
    events
      .map((event) => event.sessionHash?.trim() ?? null)
      .filter((sessionHash): sessionHash is string => Boolean(sessionHash))
  ).size
}
