import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyticsEvents } from '@/lib/schema'
import { extractClientIp, isPrivateIp } from '@/lib/geo-country'
import {
  getAnalyticsSessionHash,
  normalizeAnalyticsPathname,
  normalizeAnalyticsEventType,
  type AnalyticsBatchPayload,
  type AnalyticsEventPayload,
} from '@/lib/analytics-events'

const BOT_PATTERN = /bot|crawler|spider|headless|phantom|selenium/i

function normalizeSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length < 2) return null
  return trimmed.slice(0, 160)
}

function normalizeResultCount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(100000, Math.round(parsed)))
}

async function geolocateIp(ip: string): Promise<{ country: string; city: string } | null> {
  if (!ip || isPrivateIp(ip)) {
    return null
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const data = await res.json()
    if (data.status !== 'success') return null

    return {
      country: data.country || null,
      city: data.city || null,
    }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as AnalyticsBatchPayload
    const events: unknown[] = body?.events

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'No events provided' }, { status: 400 })
    }

    const userAgent = request.headers.get('user-agent') || ''

    // Skip bots
    if (BOT_PATTERN.test(userAgent)) {
      return NextResponse.json({ ok: true })
    }

    const sessionHash = await getAnalyticsSessionHash(body?.anonymousId)

    // Extract IP and geolocate once per batch
    const clientIp = extractClientIp(request.headers)
    const geo = clientIp ? await geolocateIp(clientIp) : null

    const rows: Array<{
      type: 'pageview' | 'click' | 'trial_search' | 'not_found'
      url: string
      referrer: string | null
      userAgent: string
      sessionHash: string | null
      elementId: string | null
      ipAddress: string | null
      country: string | null
      city: string | null
      searchQuery: string | null
      resultCount: number | null
    }> = events
      .slice(0, 50)
      .flatMap((event) => {
        const typedEvent = event as AnalyticsEventPayload
        const type = normalizeAnalyticsEventType(typedEvent?.type)
        if (!type) return []

        const isSearchEvent = type === 'trial_search'
        const url = type === 'not_found'
          ? normalizeAnalyticsPathname(typedEvent.url)
          : String(typedEvent.url || '').slice(0, 500)
        const searchQuery = isSearchEvent
          ? normalizeSearchQuery(typedEvent.searchQuery)
          : null

        if (!url) return []
        if (isSearchEvent && !searchQuery) return []

        return [{
          type,
          url,
          referrer: typedEvent.referrer ? String(typedEvent.referrer).slice(0, 500) : null,
          userAgent,
          sessionHash,
          elementId: typedEvent.elementId ? String(typedEvent.elementId).slice(0, 200) : null,
          ipAddress: clientIp,
          country: geo?.country ?? null,
          city: geo?.city ?? null,
          searchQuery,
          resultCount: isSearchEvent ? normalizeResultCount(typedEvent.resultCount) : null,
        }]
      })

    if (rows.length > 0) {
      await db.insert(analyticsEvents).values(rows)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Analytics ingestion error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
