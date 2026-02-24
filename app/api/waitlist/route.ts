import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { db } from '@/lib/db'
import { waitlistEntries } from '@/lib/schema'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WAITLIST_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || 'Endpoint Arena <noreply@endpointarena.com>'
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

type WaitlistRequest = {
  email?: string
  name?: string
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

function normalizeName(value: string | undefined): string | null {
  const name = value?.trim() ?? ''
  if (!name) return null

  if (name.length > 120) {
    throw new ValidationError('Name is too long')
  }

  return name
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildWelcomeEmailText(greeting: string): string {
  return `${greeting}

Welcome to Endpoint Arena.

You are on the waitlist for first-wave access and key model updates.
We will email you when your invite is ready.

- Endpoint Arena`
}

function buildWelcomeEmailHtml(safeGreeting: string): string {
  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      You're on the waitlist for first-wave invites, model alpha updates, and optional contribution points.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0;padding:0;background:#f5f2ed;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;border:1px solid #e8ddd0;background:#f9f5ef;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="height:3px;width:25%;background:#EF6F67;"></td>
                    <td style="height:3px;width:25%;background:#5DBB63;"></td>
                    <td style="height:3px;width:25%;background:#D39D2E;"></td>
                    <td style="height:3px;width:25%;background:#5BA5ED;"></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 26px 6px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle" style="padding-right:10px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:3px;">
                        <tr>
                          <td style="width:8px;height:8px;"></td>
                          <td style="width:8px;height:8px;"></td>
                          <td style="width:8px;height:8px;"></td>
                          <td style="width:8px;height:8px;background:#5BA5ED;border-radius:2px;"></td>
                        </tr>
                        <tr>
                          <td style="width:8px;height:8px;background:#EF6F67;border-radius:2px;"></td>
                          <td style="width:8px;height:8px;"></td>
                          <td style="width:8px;height:8px;background:#D39D2E;border-radius:2px;"></td>
                          <td style="width:8px;height:8px;"></td>
                        </tr>
                        <tr>
                          <td style="width:8px;height:8px;"></td>
                          <td style="width:8px;height:8px;background:#5DBB63;border-radius:2px;"></td>
                          <td style="width:8px;height:8px;"></td>
                          <td style="width:8px;height:8px;"></td>
                        </tr>
                      </table>
                    </td>
                    <td valign="middle" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:44px;line-height:1;color:#1a1a1a;font-weight:700;">
                      Endpoint Arena
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 26px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                <h1 style="margin:0;color:#1a1a1a;font-family:'Iowan Old Style','Times New Roman',serif;font-size:44px;line-height:1.08;font-weight:500;">
                  Be first to know.
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                <p style="margin:0 0 12px;color:#1a1a1a;font-size:18px;line-height:1.5;font-weight:500;">
                  ${safeGreeting}
                </p>
                <p style="margin:0;color:#8a8075;font-size:18px;line-height:1.6;">
                  You are on the waitlist for first-wave access and key model updates.
                  We will email you when your invite is ready.
                </p>
              </td>
            </tr>
            <tr>
              <td style="height:24px;"></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `
}

async function sendWelcomeEmail({
  email,
  name,
}: {
  email: string
  name: string | null
}): Promise<boolean> {
  if (!resend) {
    console.warn('Waitlist welcome email skipped: RESEND_API_KEY is not configured')
    return false
  }

  const firstName = name?.split(/\s+/)[0] ?? ''
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'
  const safeGreeting = escapeHtml(greeting)

  try {
    const result = await resend.emails.send({
      from: WAITLIST_FROM_EMAIL,
      to: email,
      subject: 'Welcome to the Endpoint Arena waitlist',
      text: buildWelcomeEmailText(greeting),
      html: buildWelcomeEmailHtml(safeGreeting),
    })

    if (result.error) {
      console.error('Waitlist welcome email failed:', result.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Waitlist welcome email failed:', error)
    return false
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const body = await parseJsonBody<WaitlistRequest>(request)
    const email = normalizeEmail(body.email)
    const name = normalizeName(body.name)

    const inserted = await db
      .insert(waitlistEntries)
      .values({
        email,
        name,
      })
      .onConflictDoNothing({ target: waitlistEntries.email })
      .returning({ id: waitlistEntries.id })

    const isNewSignup = inserted.length > 0
    const welcomeEmailSent = isNewSignup
      ? await sendWelcomeEmail({ email, name })
      : false

    return successResponse(
      {
        ok: true,
        alreadyJoined: !isNewSignup,
        welcomeEmailSent,
      },
      {
        headers: {
          'X-Request-Id': requestId,
        },
      }
    )
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to join waitlist')
  }
}
