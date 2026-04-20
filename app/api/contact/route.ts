import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { db } from '@/lib/db'
import { contactMessages } from '@/lib/schema'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { parseMarketSuggestionMessage } from '@/lib/market-suggestions'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/
const CONTACT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || 'Endpoint Arena <noreply@endpointarena.com>'
const CONTACT_ADMIN_EMAIL = process.env.CONTACT_ADMIN_EMAIL?.trim() || ''
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null
let hasWarnedMissingXHandleColumn = false

type ContactRequest = {
  kind?: unknown
  name?: unknown
  email?: unknown
  xHandle?: unknown
  message?: unknown
}

type ContactKind = 'contact' | 'market-suggestion'

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''

  if (!name) {
    throw new ValidationError('Name is required')
  }

  if (name.length > 120) {
    throw new ValidationError('Name is too long')
  }

  return name
}

function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (!email) {
    throw new ValidationError('Email is required')
  }

  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError('Email format is invalid')
  }

  if (email.length > 320) {
    throw new ValidationError('Email is too long')
  }

  return email
}

function normalizeMessage(value: unknown): string {
  const message = typeof value === 'string' ? value.trim() : ''

  if (!message) {
    throw new ValidationError('Message is required')
  }

  if (message.length > 5000) {
    throw new ValidationError('Message is too long')
  }

  return message
}

function normalizeMarketSuggestionMessage(value: unknown): string {
  const message = normalizeMessage(value)
  const parsedSuggestion = parseMarketSuggestionMessage(message)

  if (!parsedSuggestion?.nctNumber) {
    throw new ValidationError('Enter an NCT number like NCT12345678')
  }

  return message
}

function normalizeOptionalName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''

  if (name.length > 120) {
    throw new ValidationError('Name is too long')
  }

  return name
}

function normalizeOptionalEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''

  if (email.length > 320) {
    throw new ValidationError('Email is too long')
  }

  return email
}

function normalizeOptionalXHandle(value: unknown): string {
  const rawHandle = typeof value === 'string' ? value.trim() : ''

  if (!rawHandle) {
    return ''
  }

  let handleCandidate = rawHandle.replace(/^@+/, '')

  if (/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(rawHandle)) {
    try {
      const url = new URL(/^https?:\/\//i.test(rawHandle) ? rawHandle : `https://${rawHandle}`)
      handleCandidate = (url.pathname.split('/').filter(Boolean)[0] ?? '').replace(/^@+/, '')
    } catch {
      handleCandidate = ''
    }
  }

  const normalizedHandle = handleCandidate.split(/[/?#\s]/)[0] ?? ''

  if (!normalizedHandle) {
    return ''
  }

  if (!X_HANDLE_PATTERN.test(normalizedHandle)) {
    throw new ValidationError('X handle format is invalid')
  }

  return `@${normalizedHandle}`
}

function normalizeContactKind(value: unknown): ContactKind {
  return value === 'market-suggestion' ? 'market-suggestion' : 'contact'
}

function isMissingContactXHandleColumnError(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { cause?: unknown, code?: unknown, message?: unknown }
    const code = typeof candidate.code === 'string' ? candidate.code : ''
    const message = typeof candidate.message === 'string' ? candidate.message : ''

    if (code === '42703' && message.includes('x_handle') && message.includes('contact_messages')) {
      return true
    }

    current = candidate.cause
  }

  return false
}

function warnMissingXHandleColumn(requestId: string): void {
  if (hasWarnedMissingXHandleColumn) return

  hasWarnedMissingXHandleColumn = true
  console.warn(`[contact:${requestId}] contact_messages.x_handle is missing; saving message without X handle column.`)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatIsoDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC')
}

function buildAdminEmailText({
  subjectLabel,
  name,
  email,
  xHandle,
  message,
  createdAt,
}: {
  subjectLabel: string
  name: string
  email: string
  xHandle: string
  message: string
  createdAt: Date
}): string {
  const displayName = name || 'Anonymous'
  const displayEmail = email || 'No email provided'
  const displayXHandle = xHandle || 'No X handle provided'

  return `New ${subjectLabel}

From: ${displayName} <${displayEmail}>
X handle: ${displayXHandle}
Received: ${formatIsoDate(createdAt)}

Message:
${message}
`
}

function buildAdminEmailHtml({
  subjectLabel,
  name,
  email,
  xHandle,
  message,
  createdAt,
}: {
  subjectLabel: string
  name: string
  email: string
  xHandle: string
  message: string
  createdAt: Date
}): string {
  const safeSubjectLabel = escapeHtml(subjectLabel)
  const safeName = escapeHtml(name || 'Anonymous')
  const safeEmail = escapeHtml(email || 'No email provided')
  const safeXHandle = escapeHtml(xHandle || 'No X handle provided')
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />')
  const safeDate = escapeHtml(formatIsoDate(createdAt))

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0;padding:24px;background:#f5f2ed;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border:1px solid #e8ddd0;background:#fff;">
            <tr>
              <td style="padding:20px 24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 16px;color:#1a1a1a;font-size:22px;line-height:1.2;">New ${safeSubjectLabel}</h1>
                <p style="margin:0 0 8px;color:#4b4b4b;font-size:14px;line-height:1.5;"><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
                <p style="margin:0 0 8px;color:#4b4b4b;font-size:14px;line-height:1.5;"><strong>X handle:</strong> ${safeXHandle}</p>
                <p style="margin:0 0 16px;color:#4b4b4b;font-size:14px;line-height:1.5;"><strong>Received:</strong> ${safeDate}</p>
                <div style="border:1px solid #e8ddd0;background:#faf7f2;padding:14px;color:#1a1a1a;font-size:14px;line-height:1.6;">
                  ${safeMessage}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `
}

async function sendAdminNotification({
  kind,
  name,
  email,
  xHandle,
  message,
  createdAt,
  requestId,
}: {
  kind: ContactKind
  name: string
  email: string
  xHandle: string
  message: string
  createdAt: Date
  requestId: string
}): Promise<boolean> {
  if (!resend) {
    console.warn(`[contact:${requestId}] Contact notification email skipped: RESEND_API_KEY is not configured`)
    return false
  }

  if (!CONTACT_ADMIN_EMAIL) {
    console.warn(`[contact:${requestId}] Contact notification email skipped: CONTACT_ADMIN_EMAIL is not configured`)
    return false
  }

  const subjectLabel = kind === 'market-suggestion' ? 'market suggestion' : 'Contact Us message'
  const replyTo = EMAIL_PATTERN.test(email) ? email : undefined

  try {
    const result = await resend.emails.send({
      from: CONTACT_FROM_EMAIL,
      to: CONTACT_ADMIN_EMAIL,
      replyTo,
      subject: kind === 'market-suggestion'
        ? `New market suggestion${name ? ` from ${name}` : ''}`
        : `New contact message from ${name}`,
      text: buildAdminEmailText({ subjectLabel, name, email, xHandle, message, createdAt }),
      html: buildAdminEmailHtml({ subjectLabel, name, email, xHandle, message, createdAt }),
    })

    if (result.error) {
      console.error(`[contact:${requestId}] Contact notification email failed:`, result.error)
      return false
    }

    return true
  } catch (error) {
    console.error(`[contact:${requestId}] Contact notification email failed:`, error)
    return false
  }
}

async function insertContactMessage({
  name,
  email,
  xHandle,
  message,
  createdAt,
  requestId,
}: {
  name: string
  email: string
  xHandle: string
  message: string
  createdAt: Date
  requestId: string
}): Promise<void> {
  const values = {
    name,
    email,
    message,
    createdAt,
  }

  try {
    await db.insert(contactMessages).values({
      ...values,
      xHandle: xHandle || null,
    })
  } catch (error) {
    if (!isMissingContactXHandleColumnError(error)) {
      throw error
    }

    warnMissingXHandleColumn(requestId)
    await db.insert(contactMessages).values(values)
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const body = await parseJsonBody<ContactRequest>(request)
    const kind = normalizeContactKind(body.kind)
    const name = normalizeOptionalName(body.name)
    const email = kind === 'market-suggestion'
      ? normalizeOptionalEmail(body.email)
      : normalizeEmail(body.email)
    const xHandle = normalizeOptionalXHandle(body.xHandle)
    const message = kind === 'market-suggestion'
      ? normalizeMarketSuggestionMessage(body.message)
      : normalizeMessage(body.message)
    const createdAt = new Date()

    await insertContactMessage({
      name,
      email,
      xHandle,
      message,
      createdAt,
      requestId,
    })

    const adminEmailSent = await sendAdminNotification({
      kind,
      name,
      email,
      xHandle,
      message,
      createdAt,
      requestId,
    })

    return successResponse(
      adminEmailSent ? {
        ok: true,
        adminEmailSent,
      } : {
        ok: true,
        adminEmailSent: false,
        warningCode: 'operator_notification_failed' as const,
        requestId,
      },
      {
        headers: {
          'X-Request-Id': requestId,
        },
      }
    )
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to submit contact request')
  }
}
