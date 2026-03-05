import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { logCrashEvent } from '@/lib/crash-events'

type CrashEventPayload = {
  digest?: string
  name?: string
  message?: string
  stack?: string
  componentStack?: string
  url?: string
  path?: string
  source?: string
  requestId?: string
  errorCode?: string
  statusCode?: number
  details?: unknown
  userAgent?: string
}

function normalizeText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function parseForwardedIp(value: string | null): string | null {
  if (!value) return null
  const first = value.split(',')[0]?.trim() ?? ''
  if (!first) return null
  return first.slice(0, 128)
}

function normalizeDetails(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, 4000) : null
  }
  try {
    return JSON.stringify(value).slice(0, 4000)
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const body = await parseJsonBody<CrashEventPayload>(request)
    const message = normalizeText(body.message, 2000)
    if (!message) {
      throw new ValidationError('Crash message is required')
    }

    const session = await getServerSession(authOptions).catch(() => null)
    const userId = normalizeText(session?.user?.id ?? null, 128)
    const userEmail = normalizeText(session?.user?.email ?? null, 320)

    const headerUserAgent = normalizeText(request.headers.get('user-agent'), 1024)
    const userAgent = normalizeText(body.userAgent, 1024) ?? headerUserAgent
    const ipAddress = parseForwardedIp(request.headers.get('x-forwarded-for'))
    const country = normalizeText(
      request.headers.get('x-geo-country')
      ?? request.headers.get('x-country')
      ?? request.headers.get('cf-ipcountry'),
      100,
    )
    const city = normalizeText(
      request.headers.get('x-geo-city')
      ?? request.headers.get('x-city')
      ?? request.headers.get('cf-ipcity'),
      100,
    )

    const result = await logCrashEvent({
      digest: normalizeText(body.digest, 128),
      errorName: normalizeText(body.name, 128),
      message,
      stack: normalizeText(body.stack, 12000),
      componentStack: normalizeText(body.componentStack, 12000),
      url: normalizeText(body.url, 2000),
      path: normalizeText(body.path, 512),
      source: normalizeText(body.source, 64),
      requestId: normalizeText(body.requestId, 128),
      errorCode: normalizeText(body.errorCode, 128),
      statusCode: Number.isInteger(body.statusCode) ? Number(body.statusCode) : null,
      details: normalizeDetails(body.details),
      userId,
      userEmail,
      userAgent,
      ipAddress,
      country,
      city,
    })

    return successResponse({
      ok: true,
      crashId: result.id,
      fingerprint: result.fingerprint,
      requestId,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to record crash event')
  }
}
