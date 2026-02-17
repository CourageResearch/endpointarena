import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyticsEvents } from '@/lib/schema'

const BOT_PATTERN = /bot|crawler|spider|headless|phantom|selenium/i
const PRIVATE_IP_PATTERN = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|localhost|0\.0\.0\.0)/

async function computeSessionHash(userAgent: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const data = new TextEncoder().encode(userAgent + date)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for can be comma-separated; first is the real client
    return forwarded.split(',')[0].trim()
  }
  return null
}

async function geolocateIp(ip: string): Promise<{ country: string; city: string } | null> {
  if (!ip || PRIVATE_IP_PATTERN.test(ip)) {
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
    const body = await request.json()
    const events: unknown[] = body?.events

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'No events provided' }, { status: 400 })
    }

    const userAgent = request.headers.get('user-agent') || ''

    // Skip bots
    if (BOT_PATTERN.test(userAgent)) {
      return NextResponse.json({ ok: true })
    }

    const sessionHash = await computeSessionHash(userAgent)

    // Extract IP and geolocate once per batch
    const clientIp = getClientIp(request)
    const geo = clientIp ? await geolocateIp(clientIp) : null

    // Cap at 50 events, filter valid types
    const validTypes = new Set(['pageview', 'click'])
    const rows = events
      .slice(0, 50)
      .filter((e: any) => validTypes.has(e?.type))
      .map((e: any) => ({
        type: e.type as string,
        url: String(e.url || '').slice(0, 500),
        referrer: e.referrer ? String(e.referrer).slice(0, 500) : null,
        userAgent,
        sessionHash,
        elementId: e.elementId ? String(e.elementId).slice(0, 200) : null,
        ipAddress: clientIp,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
      }))

    if (rows.length > 0) {
      await db.insert(analyticsEvents).values(rows)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Analytics ingestion error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
