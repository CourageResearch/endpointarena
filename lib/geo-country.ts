export type HeaderCollection = Headers | Record<string, string | string[] | undefined> | null | undefined

export type InferredGeo = {
  country: string | null
  state: string | null
}

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

export function normalizeStateName(value: unknown): string | null {
  const raw = toNonEmptyString(value)
  if (!raw) return null
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

async function geolocateGeoFromIp(ip: string): Promise<InferredGeo> {
  if (!ip || isPrivateIp(ip)) return { country: null, state: null }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,region,region_code`,
      {
        signal: controller.signal,
        cache: 'no-store',
      }
    )

    if (response.ok) {
      const data = await response.json() as {
        success?: boolean
        country?: string
        region?: string
        region_code?: string
      }

      if (data.success) {
        const country = normalizeCountryName(data.country)
        const state = normalizeStateName(data.region) ?? normalizeStateName(data.region_code)
        if (country || state) {
          return { country, state }
        }
      }
    }
  } catch {
    // Fall through to secondary provider.
  } finally {
    clearTimeout(timeout)
  }

  try {
    const fallbackResponse = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,region`,
      { cache: 'no-store' }
    )
    if (!fallbackResponse.ok) return { country: null, state: null }

    const fallbackData = await fallbackResponse.json() as {
      status?: string
      country?: string
      regionName?: string
      region?: string
    }

    if (fallbackData.status !== 'success') return { country: null, state: null }

    return {
      country: normalizeCountryName(fallbackData.country),
      state: normalizeStateName(fallbackData.regionName) ?? normalizeStateName(fallbackData.region),
    }
  } catch {
    return { country: null, state: null }
  }
}

type InferGeoOptions = {
  fallbackCountry?: unknown
  fallbackState?: unknown
  preferFallbackGeo?: boolean
}

export async function inferGeoFromHeaders(
  headers: HeaderCollection,
  options?: InferGeoOptions,
): Promise<InferredGeo> {
  const countryFromHeaders = normalizeCountryName(
    getHeader(headers, 'x-vercel-ip-country') ||
    getHeader(headers, 'x-geo-country') ||
    getHeader(headers, 'cf-ipcountry')
  )
  const stateFromHeaders = normalizeStateName(
    getHeader(headers, 'x-vercel-ip-country-region') ||
    getHeader(headers, 'x-geo-region') ||
    getHeader(headers, 'cf-region')
  )

  const fallbackCountry = normalizeCountryName(options?.fallbackCountry)
  const fallbackState = normalizeStateName(options?.fallbackState)

  if (countryFromHeaders && stateFromHeaders) {
    return { country: countryFromHeaders, state: stateFromHeaders }
  }

  if (countryFromHeaders && !stateFromHeaders && fallbackState) {
    return { country: countryFromHeaders, state: fallbackState }
  }

  if (options?.preferFallbackGeo && fallbackCountry) {
    return { country: fallbackCountry, state: fallbackState }
  }

  const ip = extractClientIp(headers)
  if (ip) {
    const geolocated = await geolocateGeoFromIp(ip)
    if (countryFromHeaders || geolocated.country || geolocated.state) {
      return {
        country: countryFromHeaders ?? geolocated.country ?? fallbackCountry,
        state: stateFromHeaders ?? geolocated.state ?? fallbackState,
      }
    }
  }

  return {
    country: countryFromHeaders ?? fallbackCountry,
    state: stateFromHeaders ?? fallbackState,
  }
}

export async function inferCountryFromHeaders(
  headers: HeaderCollection,
  options?: { fallbackCountry?: unknown; preferFallbackCountry?: boolean },
): Promise<string | null> {
  const geo = await inferGeoFromHeaders(headers, {
    fallbackCountry: options?.fallbackCountry,
    preferFallbackGeo: options?.preferFallbackCountry,
  })
  return geo.country
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

export function formatStoredState(rawState: string | null | undefined): string {
  const normalized = normalizeStateName(rawState)
  return normalized ?? 'Unknown'
}
