export async function detectCountryFromClient(timeoutMs = 1500): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('/api/geo/country', {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return ''

    const payload = await response.json() as { country?: string | null }
    if (typeof payload.country !== 'string') return ''

    const country = payload.country.trim()
    return country.length > 0 ? country : ''
  } catch {
    return ''
  } finally {
    clearTimeout(timeout)
  }
}
