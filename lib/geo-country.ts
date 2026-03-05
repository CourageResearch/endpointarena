export type HeaderCollection = Headers | Record<string, string | string[] | undefined> | null | undefined

const PRIVATE_IPV4_PATTERN = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0)/
const PRIVATE_IPV6_PATTERN = /^(::1|fc|fd|fe80:)/i

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeCountryName(value: unknown): string | null {
  const raw = toNonEmptyString(value)
  if (!raw) return null

  if (/^[A-Za-z]{2}$/.test(raw)) {
    const upper = raw.toUpperCase()
    try {
      const displayName = new Intl.DisplayNames(['en'], { type: 'region' }).of(upper)
      return toNonEmptyString(displayName) ?? upper
    } catch {
      return upper
    }
  }

  return raw
}

function getHeader(headers: HeaderCollection, name: string): string | null {
  if (!headers) return null

  if (headers instanceof Headers) {
    return toNonEmptyString(headers.get(name) ?? headers.get(name.toLowerCase()))
  }

  const direct = headers[name] ?? headers[name.toLowerCase()]
  const value = Array.isArray(direct) ? direct[0] : direct
  return toNonEmptyString(value)
}

function normalizeIp(rawValue: string | null): string | null {
  let value = toNonEmptyString(rawValue)
  if (!value) return null

  value = value.replace(/^for=/i, '').replace(/^"|"$/g, '').trim()

  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end > 0) {
      value = value.slice(1, end)
    }
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.split(':')[0]
  }

  if (value.toLowerCase().startsWith('::ffff:')) {
    value = value.slice(7)
  }

  value = value.trim()
  if (!value || value.toLowerCase() === 'unknown') return null

  return value
}

export function isPrivateIp(ip: string): boolean {
  const value = ip.trim().toLowerCase()
  if (!value) return true
  if (value === 'localhost') return true
  if (PRIVATE_IPV4_PATTERN.test(value)) return true
  if (PRIVATE_IPV6_PATTERN.test(value)) return true
  return false
}

function parseForwardedHeader(value: string | null): string | null {
  const raw = toNonEmptyString(value)
  if (!raw) return null

  const firstSegment = raw.split(',')[0]?.trim() ?? ''
  if (!firstSegment) return null

  const match = firstSegment.match(/for=(?:"?\[?)([^;"\],]+)/i)
  if (match?.[1]) {
    return normalizeIp(match[1])
  }

  return normalizeIp(firstSegment)
}

export function extractClientIp(headers: HeaderCollection): string | null {
  const forwarded = getHeader(headers, 'x-forwarded-for')
  let fallbackForwardedIp: string | null = null

  if (forwarded) {
    const candidates = forwarded
      .split(',')
      .map((part) => normalizeIp(part))
      .filter((part): part is string => Boolean(part))

    const publicCandidate = candidates.find((part) => !isPrivateIp(part))
    if (publicCandidate) return publicCandidate
    fallbackForwardedIp = candidates[0] ?? null
  }

  const standardForwarded = parseForwardedHeader(getHeader(headers, 'forwarded'))
  if (standardForwarded && !isPrivateIp(standardForwarded)) return standardForwarded

  const directIp = normalizeIp(
    getHeader(headers, 'x-real-ip') ||
    getHeader(headers, 'cf-connecting-ip')
  )

  if (directIp) return directIp
  if (standardForwarded) return standardForwarded
  return fallbackForwardedIp
}

async function geolocateCountryFromIp(ip: string): Promise<string | null> {
  if (!ip || isPrivateIp(ip)) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (response.ok) {
      const data = await response.json() as { success?: boolean; country?: string }
      if (data.success) {
        const country = normalizeCountryName(data.country)
        if (country) return country
      }
    }
  } finally {
    clearTimeout(timeout)
  }

  try {
    const fallbackResponse = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country`, {
      cache: 'no-store',
    })
    if (!fallbackResponse.ok) return null

    const fallbackData = await fallbackResponse.json() as { status?: string; country?: string }
    if (fallbackData.status !== 'success') return null
    return normalizeCountryName(fallbackData.country)
  } catch {
    return null
  }
}

type InferCountryOptions = {
  fallbackCountry?: unknown
  preferFallbackCountry?: boolean
}

export async function inferCountryFromHeaders(
  headers: HeaderCollection,
  options?: InferCountryOptions,
): Promise<string | null> {
  const countryFromHeaders = normalizeCountryName(
    getHeader(headers, 'x-vercel-ip-country') ||
    getHeader(headers, 'x-geo-country') ||
    getHeader(headers, 'cf-ipcountry')
  )
  if (countryFromHeaders) return countryFromHeaders

  const countryFromFallback = normalizeCountryName(options?.fallbackCountry)
  if (options?.preferFallbackCountry && countryFromFallback) {
    return countryFromFallback
  }

  const ip = extractClientIp(headers)
  if (ip) {
    const geolocatedCountry = await geolocateCountryFromIp(ip)
    if (geolocatedCountry) return geolocatedCountry
  }

  return countryFromFallback
}

export function formatStoredCountry(rawLocation: string | null | undefined): string {
  const raw = toNonEmptyString(rawLocation)
  if (!raw) return 'Unknown'

  if (raw.toLowerCase().startsWith('timezone:')) {
    return 'Unknown'
  }

  const countryWithTimezone = raw.match(/^(.+?)\s*\(([A-Za-z_]+\/[A-Za-z_]+)\)$/)
  if (countryWithTimezone?.[1]) {
    return normalizeCountryName(countryWithTimezone[1]) ?? 'Unknown'
  }

  if (raw.includes(',')) {
    const lastPart = raw.split(',').at(-1)?.trim()
    const normalizedLastPart = normalizeCountryName(lastPart)
    if (normalizedLastPart) return normalizedLastPart
  }

  return normalizeCountryName(raw) ?? 'Unknown'
}
