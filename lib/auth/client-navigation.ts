import { detectGeoFromClient } from '@/lib/client-country'

type AuthGeo = {
  country: string
  state: string
}

export function normalizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/markets'
  if (!raw.startsWith('/')) return '/markets'
  if (raw.startsWith('//')) return '/markets'
  return raw
}

export function resolveDestination(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback
  try {
    const parsed = new URL(url, window.location.origin)
    return normalizeCallbackUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`)
  } catch {
    return fallback
  }
}

export function buildProfileCallbackUrl(callbackUrl: string): string {
  return `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`
}

export async function ensureAuthGeo(currentGeo: AuthGeo): Promise<AuthGeo> {
  if (currentGeo.country || currentGeo.state) {
    return currentGeo
  }

  return detectGeoFromClient()
}
