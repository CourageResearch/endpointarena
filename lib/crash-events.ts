import { createHash } from 'crypto'
import { Resend } from 'resend'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { crashEvents, db } from '@/lib/db'

type CrashEventSource = 'app-error' | 'global-error' | 'api' | 'manual'

type LogCrashEventInput = {
  digest?: string | null
  errorName?: string | null
  message: string
  stack?: string | null
  componentStack?: string | null
  url?: string | null
  path?: string | null
  source?: string | null
  requestId?: string | null
  errorCode?: string | null
  statusCode?: number | null
  details?: string | null
  userId?: string | null
  userEmail?: string | null
  userAgent?: string | null
  ipAddress?: string | null
  country?: string | null
  city?: string | null
}

type CrashAlertEmailPayload = {
  id: string
  fingerprint: string
  digest: string | null
  errorName: string | null
  message: string
  source: CrashEventSource
  path: string | null
  url: string | null
  requestId: string | null
  errorCode: string | null
  statusCode: number | null
  userId: string | null
  userEmail: string | null
  userAgent: string | null
  ipAddress: string | null
  country: string | null
  city: string | null
  details: string | null
  stack: string | null
  occurredAt: Date
}

const CRASH_ALERT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || 'Endpoint Arena <noreply@endpointarena.com>'
const CRASH_ALERT_TO_EMAIL = process.env.CONTACT_ADMIN_EMAIL?.trim() || ''
const CRASH_ALERT_BASE_URL = process.env.NEXTAUTH_URL?.trim() || 'https://endpointarena.com'
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

function normalizeText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function normalizeSource(value: string | null | undefined): CrashEventSource {
  if (value === 'global-error') return 'global-error'
  if (value === 'api') return 'api'
  if (value === 'manual') return 'manual'
  return 'app-error'
}

function normalizePath(urlValue: string | null, pathValue: string | null): string | null {
  if (pathValue && pathValue.startsWith('/')) return pathValue
  if (!urlValue) return pathValue
  try {
    const parsed = new URL(urlValue)
    return parsed.pathname || pathValue
  } catch {
    return pathValue
  }
}

function topStackFrame(stack: string | null): string {
  if (!stack) return ''
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''
  if (lines.length === 1) return lines[0]
  return lines[1] || lines[0]
}

function buildCrashFingerprint(input: {
  digest: string | null
  errorName: string | null
  message: string
  path: string | null
  errorCode: string | null
  statusCode: number | null
  stack: string | null
}): string {
  const parts = [
    input.digest ?? '',
    input.errorName ?? '',
    input.message,
    input.path ?? '',
    input.errorCode ?? '',
    input.statusCode == null ? '' : String(input.statusCode),
    topStackFrame(input.stack),
  ]
  return createHash('sha256').update(parts.join('||')).digest('hex')
}

function getAlertCooldownMinutes(): number {
  const parsed = Number.parseInt(process.env.CRASH_ALERT_COOLDOWN_MINUTES ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.min(parsed, 24 * 60)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatUtcDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC')
}

function truncate(value: string | null | undefined, maxLength: number): string {
  if (!value) return '—'
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`
}

function stackPreview(stack: string | null): string {
  if (!stack) return '—'
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return '—'
  return lines.slice(0, 12).join('\n').slice(0, 3000)
}

function buildAdminCrashesUrl(fingerprint: string): string {
  const base = CRASH_ALERT_BASE_URL.replace(/\/+$/, '')
  return `${base}/admin/crashes?days=7&q=${encodeURIComponent(fingerprint)}`
}

function buildCrashAlertText(payload: CrashAlertEmailPayload): string {
  const location = payload.city || payload.country
    ? `${payload.city || '—'}, ${payload.country || '—'}`
    : '—'
  const trackerUrl = buildAdminCrashesUrl(payload.fingerprint)

  return `Endpoint Arena crash alert

Occurred: ${formatUtcDate(payload.occurredAt)}
Crash event ID: ${payload.id}
Fingerprint: ${payload.fingerprint}
Digest: ${payload.digest || '—'}
Error name: ${payload.errorName || '—'}
Message: ${payload.message}
Source: ${payload.source}
Route: ${payload.path || '—'}
URL: ${payload.url || '—'}
Request ID: ${payload.requestId || '—'}
Error code: ${payload.errorCode || '—'}
Status code: ${payload.statusCode ?? '—'}
Top frame: ${topStackFrame(payload.stack) || '—'}
User: ${payload.userEmail || payload.userId || 'anonymous'}
Location: ${location}
IP: ${payload.ipAddress || '—'}
User-Agent: ${truncate(payload.userAgent, 360)}

Details:
${payload.details || '—'}

Stack preview:
${stackPreview(payload.stack)}

Open crash tracker:
${trackerUrl}
`
}

function buildCrashAlertHtml(payload: CrashAlertEmailPayload): string {
  const location = payload.city || payload.country
    ? `${payload.city || '—'}, ${payload.country || '—'}`
    : '—'
  const trackerUrl = buildAdminCrashesUrl(payload.fingerprint)
  const safeMessage = escapeHtml(payload.message)
  const safeDetails = escapeHtml(payload.details || '—').replace(/\n/g, '<br />')
  const safeStack = escapeHtml(stackPreview(payload.stack)).replace(/\n/g, '<br />')

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0;padding:24px;background:#f5f2ed;">
      <tr>
        <td align="center">
          <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;border:1px solid #e8ddd0;background:#fff;">
            <tr>
              <td style="padding:20px 24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 14px;color:#1a1a1a;font-size:22px;line-height:1.2;">Endpoint Arena crash alert</h1>
                <p style="margin:0 0 18px;color:#4b4b4b;font-size:14px;line-height:1.5;"><strong>Message:</strong> ${safeMessage}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Occurred:</strong> ${escapeHtml(formatUtcDate(payload.occurredAt))}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Fingerprint:</strong> <span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(payload.fingerprint)}</span></td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Digest:</strong> ${escapeHtml(payload.digest || '—')}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Error Name:</strong> ${escapeHtml(payload.errorName || '—')}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Source:</strong> ${escapeHtml(payload.source)}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Route:</strong> <span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(payload.path || '—')}</span></td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>URL:</strong> <span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(payload.url || '—')}</span></td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Request ID:</strong> <span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(payload.requestId || '—')}</span></td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Error code / status:</strong> ${escapeHtml(payload.errorCode || '—')} / ${payload.statusCode ?? '—'}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Top frame:</strong> <span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(topStackFrame(payload.stack) || '—')}</span></td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>User:</strong> ${escapeHtml(payload.userEmail || payload.userId || 'anonymous')}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>Location / IP:</strong> ${escapeHtml(location)}${payload.ipAddress ? ` / ${escapeHtml(payload.ipAddress)}` : ''}</td></tr>
                  <tr><td style="padding:4px 0;color:#4b4b4b;font-size:13px;"><strong>User-Agent:</strong> ${escapeHtml(truncate(payload.userAgent, 360))}</td></tr>
                </table>
                <p style="margin:0 0 8px;color:#1a1a1a;font-size:13px;font-weight:600;">Details</p>
                <div style="border:1px solid #e8ddd0;background:#faf7f2;padding:10px;color:#1a1a1a;font-size:12px;line-height:1.5;font-family:Menlo,Consolas,monospace;white-space:normal;word-break:break-word;">
                  ${safeDetails}
                </div>
                <p style="margin:16px 0 8px;color:#1a1a1a;font-size:13px;font-weight:600;">Stack preview</p>
                <div style="border:1px solid #e8ddd0;background:#faf7f2;padding:10px;color:#1a1a1a;font-size:12px;line-height:1.5;font-family:Menlo,Consolas,monospace;white-space:normal;word-break:break-word;">
                  ${safeStack}
                </div>
                <p style="margin:18px 0 0;">
                  <a href="${escapeHtml(trackerUrl)}" style="display:inline-block;padding:10px 14px;background:#1a1a1a;color:#fff;text-decoration:none;font-size:13px;">Open Crash Tracker</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `
}

async function shouldSendCrashAlert(fingerprint: string, occurredAt: Date): Promise<boolean> {
  const cooldownStart = new Date(occurredAt.getTime() - getAlertCooldownMinutes() * 60 * 1000)
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(crashEvents)
    .where(and(eq(crashEvents.fingerprint, fingerprint), gte(crashEvents.createdAt, cooldownStart)))
  const recentCount = rows[0]?.count ?? 0
  return recentCount <= 1
}

async function sendCrashAlertEmail(payload: CrashAlertEmailPayload): Promise<boolean> {
  if (!resend) {
    console.warn('Crash alert email skipped: RESEND_API_KEY is not configured')
    return false
  }

  if (!CRASH_ALERT_TO_EMAIL) {
    console.warn('Crash alert email skipped: recipient email is not configured')
    return false
  }

  try {
    const result = await resend.emails.send({
      from: CRASH_ALERT_FROM_EMAIL,
      to: CRASH_ALERT_TO_EMAIL,
      subject: `[Endpoint Arena] Crash on ${payload.path || 'unknown route'}`,
      text: buildCrashAlertText(payload),
      html: buildCrashAlertHtml(payload),
    })

    if (result.error) {
      console.error('Crash alert email failed:', result.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Crash alert email failed:', error)
    return false
  }
}

export async function logCrashEvent(input: LogCrashEventInput): Promise<{ id: string; fingerprint: string }> {
  const digest = normalizeText(input.digest, 128)
  const errorName = normalizeText(input.errorName, 128)
  const message = normalizeText(input.message, 2000) ?? 'Unknown crash'
  const stack = normalizeText(input.stack, 12000)
  const componentStack = normalizeText(input.componentStack, 12000)
  const url = normalizeText(input.url, 2000)
  const pathCandidate = normalizeText(input.path, 512)
  const path = normalizePath(url, pathCandidate)
  const source = normalizeSource(input.source)
  const requestId = normalizeText(input.requestId, 128)
  const errorCode = normalizeText(input.errorCode, 128)
  const statusCode = Number.isInteger(input.statusCode) ? Number(input.statusCode) : null
  const details = normalizeText(input.details, 4000)
  const userId = normalizeText(input.userId, 128)
  const userEmail = normalizeText(input.userEmail, 320)
  const userAgent = normalizeText(input.userAgent, 1024)
  const ipAddress = normalizeText(input.ipAddress, 128)
  const country = normalizeText(input.country, 100)
  const city = normalizeText(input.city, 100)

  const fingerprint = buildCrashFingerprint({
    digest,
    errorName,
    message,
    path,
    errorCode,
    statusCode,
    stack,
  })

  const [inserted] = await db.insert(crashEvents).values({
    fingerprint,
    digest,
    errorName,
    message,
    stack,
    componentStack,
    url,
    path,
    source,
    requestId,
    errorCode,
    statusCode,
    details,
    userId,
    userEmail,
    userAgent,
    ipAddress,
    country,
    city,
  }).returning({
    id: crashEvents.id,
    createdAt: crashEvents.createdAt,
  })

  const occurredAt = inserted.createdAt ?? new Date()

  try {
    const shouldAlert = await shouldSendCrashAlert(fingerprint, occurredAt)
    if (shouldAlert) {
      await sendCrashAlertEmail({
        id: inserted.id,
        fingerprint,
        digest,
        errorName,
        message,
        source,
        path,
        url,
        requestId,
        errorCode,
        statusCode,
        userId,
        userEmail,
        userAgent,
        ipAddress,
        country,
        city,
        details,
        stack,
        occurredAt,
      })
    }
  } catch (error) {
    console.warn('Crash alert notification skipped due to internal error:', error)
  }

  return {
    id: inserted.id,
    fingerprint,
  }
}

export async function getRecentCrashEvents({
  since,
  limit = 500,
  search,
}: {
  since: Date
  limit?: number
  search?: string
}) {
  const safeLimit = Math.min(Math.max(limit, 1), 2000)
  const query = normalizeText(search, 120)
  const baseFilter = gte(crashEvents.createdAt, since)
  const pattern = query ? `%${query}%` : null
  const searchFilter = pattern
    ? sql`(
      ${crashEvents.fingerprint} ILIKE ${pattern}
      OR
      ${crashEvents.digest} ILIKE ${pattern}
      OR ${crashEvents.message} ILIKE ${pattern}
      OR ${crashEvents.path} ILIKE ${pattern}
      OR ${crashEvents.errorCode} ILIKE ${pattern}
      OR ${crashEvents.requestId} ILIKE ${pattern}
      OR ${crashEvents.userEmail} ILIKE ${pattern}
    )`
    : null

  const whereClause = searchFilter ? and(baseFilter, searchFilter) : baseFilter

  return db
    .select()
    .from(crashEvents)
    .where(whereClause)
    .orderBy(desc(crashEvents.createdAt))
    .limit(safeLimit)
}
