import { ADMIN_EMAIL, STARTER_POINTS } from '@/lib/constants'

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function parseEmailList(value: string | null | undefined): Set<string> {
  const emails = new Set<string>()
  if (typeof value !== 'string') return emails

  for (const entry of value.split(',')) {
    const normalized = normalizeEmail(entry)
    if (normalized) {
      emails.add(normalized)
    }
  }

  return emails
}

function isLocalDevBypassEnabled(): boolean {
  return process.env.LOCAL_DEV_ADMIN_BYPASS === '1'
}

function isLocalDevTwitterBypassEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEV_TWITTER_BYPASS === '1'
}

export function isLocalDevBypassEmail(email: string | null | undefined): boolean {
  if (!isLocalDevBypassEnabled()) return false
  return normalizeEmail(email) === normalizeEmail(ADMIN_EMAIL)
}

export function canUseLocalDevVerificationBypass(email: string | null | undefined): boolean {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return false

  if (isLocalDevBypassEmail(normalizedEmail)) {
    return true
  }

  if (!isLocalDevTwitterBypassEnabled()) {
    return false
  }

  const allowedEmails = parseEmailList(process.env.LOCAL_DEV_TWITTER_BYPASS_EMAILS)
  return allowedEmails.has(normalizedEmail)
}

export function buildLocalDevVerificationStatus(email?: string | null) {
  const now = new Date()
  const normalizedEmail = normalizeEmail(email)
  const username = normalizedEmail?.split('@')[0] || 'local-user'

  return {
    connected: true,
    verified: true,
    requiresReconnect: false,
    xCheckState: 'ok' as const,
    username,
    mustStayUntil: null,
    verifiedAt: now.toISOString(),
    profile: {
      pointsBalance: STARTER_POINTS,
      rank: 1,
    },
  }
}
