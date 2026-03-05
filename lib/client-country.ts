export type DetectedClientGeo = {
  country: string
  state: string
}

export async function detectGeoFromClient(timeoutMs = 1500): Promise<DetectedClientGeo> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('/api/geo/country', {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return { country: '', state: '' }

    const payload = await response.json() as { country?: string | null; state?: string | null }
    const country = typeof payload.country === 'string' ? payload.country.trim() : ''
    const state = typeof payload.state === 'string' ? payload.state.trim() : ''

    return {
      country: country.length > 0 ? country : '',
      state: state.length > 0 ? state : '',
    }
  } catch {
    return { country: '', state: '' }
  } finally {
    clearTimeout(timeout)
  }
}

export async function detectCountryFromClient(timeoutMs = 1500): Promise<string> {
  const geo = await detectGeoFromClient(timeoutMs)
  return geo.country
}
