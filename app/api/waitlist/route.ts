import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { db } from '@/lib/db'
import { waitlistEntries } from '@/lib/schema'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WAITLIST_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || 'EndpointArena <onboarding@resend.dev>'
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
      subject: 'Welcome to the EndpointArena waitlist',
      text: `${greeting}

Thanks for joining the EndpointArena waitlist.

You are on the list for early access to new benchmarking and market features. We will email you when your invite is ready.

- EndpointArena`,
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: sans-serif;">
          <h1 style="color: #1a1a1a; margin-bottom: 24px;">EndpointArena</h1>
          <p style="color: #374151; font-size: 16px; line-height: 24px; margin: 0 0 12px;">
            ${safeGreeting}
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 24px; margin: 0 0 12px;">
            Thanks for joining the EndpointArena waitlist.
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 24px; margin: 0;">
            You are on the list for early access to new benchmarking and market features.
            We will email you when your invite is ready.
          </p>
        </div>
      `,
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
