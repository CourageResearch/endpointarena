import { ADMIN_EMAIL, STARTER_POINTS } from '@/lib/constants'

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function isLocalDevBypassEnabled(): boolean {
  return process.env.LOCAL_DEV_ADMIN_BYPASS === '1'
}

export function isLocalDevBypassEmail(email: string | null | undefined): boolean {
  if (!isLocalDevBypassEnabled()) return false
  return normalizeEmail(email) === normalizeEmail(ADMIN_EMAIL)
}

export function buildLocalDevVerificationStatus() {
  const now = new Date()

  return {
    connected: true,
    verified: true,
    requiresReconnect: false,
    xCheckState: 'ok' as const,
    username: 'local-admin',
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
