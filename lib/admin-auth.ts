import { redirect } from 'next/navigation'
import type { AppSession } from '@/lib/auth/types'
import { getSession } from '@/lib/auth/session'
import { isConfiguredAdminEmail } from '@/lib/constants'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors'
import { isLocalDevBypassEmail } from '@/lib/local-dev-bypass'

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false

  return isConfiguredAdminEmail(normalized) || isLocalDevBypassEmail(normalized)
}

export async function getAdminSession(): Promise<AppSession | null> {
  const session = await getSession()
  if (!session?.user?.email) return null
  return isAdminEmail(session.user.email) ? session : null
}

export async function requireAdminSession(): Promise<AppSession> {
  const session = await getSession()
  const email = session?.user?.email ?? null

  if (!email) {
    throw new UnauthorizedError('Please sign in with your season 4 admin account')
  }

  if (!isAdminEmail(email)) {
    throw new ForbiddenError('Forbidden - admin access required')
  }

  if (!session) {
    throw new UnauthorizedError('Please sign in with your season 4 admin account')
  }

  return session
}

export async function ensureAdmin(): Promise<void> {
  await requireAdminSession()
}

export async function requireAdminUserId(): Promise<string> {
  const session = await requireAdminSession()
  const userId = session.user.id?.trim()
  if (!userId) {
    throw new UnauthorizedError('Unauthorized - missing user id')
  }

  return userId
}

export async function redirectIfNotAdmin(callbackPath: string): Promise<AppSession> {
  const session = await getSession()
  const email = session?.user?.email ?? null

  if (!email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`)
  }

  if (!isAdminEmail(email)) {
    redirect('/')
  }

  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`)
  }

  return session
}
