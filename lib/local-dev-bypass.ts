import { ADMIN_EMAIL, STARTER_POINTS } from '@/lib/constants'

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
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
  return isLocalDevBypassEmail(email) || (isLocalDevTwitterBypassEnabled() && Boolean(normalizeEmail(email)))
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
      lastPointsRefillAt: null,
      refillAwarded: 0,
    },
  }
}
