import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contactMessages } from '@/lib/schema'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTACT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || 'Endpoint Arena <noreply@endpointarena.com>'
const CONTACT_ADMIN_EMAIL = process.env.CONTACT_ADMIN_EMAIL?.trim() || ''
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

declare global {
  // eslint-disable-next-line no-var
  var __contactSchemaReadyPromise: Promise<void> | undefined
}

type ContactRequest = {
  name?: string
  email?: string
  message?: string
}

function normalizeName(value: string | undefined): string {
  const name = value?.trim() ?? ''

  if (!name) {
    throw new ValidationError('Name is required')
  }

  if (name.length > 120) {
    throw new ValidationError('Name is too long')
  }

  return name
}

function normalizeEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? ''

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

function normalizeMessage(value: string | undefined): string {
  const message = value?.trim() ?? ''

  if (!message) {
    throw new ValidationError('Message is required')
  }

  if (message.length > 5000) {
    throw new ValidationError('Message is too long')
  }

  return message
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

function buildAdminEmailText({ name, email, message, createdAt }: { name: string; email: string; message: string; createdAt: Date }): string {
  return `New Contact Us message

From: ${name} <${email}>
Received: ${formatIsoDate(createdAt)}

Message:
${message}
`
}

function buildAdminEmailHtml({
  name,
  email,
  message,
  createdAt,
}: {
  name: string
  email: string
  message: string
  createdAt: Date
}): string {
  const safeName = escapeHtml(name)
  const safeEmail = escapeHtml(email)
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />')
  const safeDate = escapeHtml(formatIsoDate(createdAt))

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0;padding:24px;background:#f5f2ed;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border:1px solid #e8ddd0;background:#fff;">
            <tr>
              <td style="padding:20px 24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 16px;color:#1a1a1a;font-size:22px;line-height:1.2;">New Contact Us message</h1>
                <p style="margin:0 0 8px;color:#4b4b4b;font-size:14px;line-height:1.5;"><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
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

async function ensureContactSchema(): Promise<void> {
  if (globalThis.__contactSchemaReadyPromise) {
    return globalThis.__contactSchemaReadyPromise
  }

  globalThis.__contactSchemaReadyPromise = (async () => {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS contact_messages (
          id text PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL,
          message text NOT NULL,
          created_at timestamp DEFAULT now()
        )
      `)

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS contact_messages_created_at_idx
        ON contact_messages (created_at)
      `)
    } catch (error) {
      globalThis.__contactSchemaReadyPromise = undefined
      throw error
    }
  })()

  return globalThis.__contactSchemaReadyPromise
}

async function sendAdminNotification({
  name,
  email,
  message,
  createdAt,
}: {
  name: string
  email: string
  message: string
  createdAt: Date
}): Promise<boolean> {
  if (!resend) {
    console.warn('Contact notification email skipped: RESEND_API_KEY is not configured')
    return false
  }

  if (!CONTACT_ADMIN_EMAIL) {
    console.warn('Contact notification email skipped: CONTACT_ADMIN_EMAIL is not configured')
    return false
  }

  try {
    const result = await resend.emails.send({
      from: CONTACT_FROM_EMAIL,
      to: CONTACT_ADMIN_EMAIL,
      replyTo: email,
      subject: `New contact message from ${name}`,
      text: buildAdminEmailText({ name, email, message, createdAt }),
      html: buildAdminEmailHtml({ name, email, message, createdAt }),
    })

    if (result.error) {
      console.error('Contact notification email failed:', result.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Contact notification email failed:', error)
    return false
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const body = await parseJsonBody<ContactRequest>(request)
    const name = normalizeName(body.name)
    const email = normalizeEmail(body.email)
    const message = normalizeMessage(body.message)
    const createdAt = new Date()

    await ensureContactSchema()

    await db.insert(contactMessages).values({
      name,
      email,
      message,
      createdAt,
    })

    const adminEmailSent = await sendAdminNotification({
      name,
      email,
      message,
      createdAt,
    })

    return successResponse(
      {
        ok: true,
        adminEmailSent,
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
