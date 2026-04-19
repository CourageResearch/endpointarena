import { InvalidAuthTokenError } from '@privy-io/node'
import { cookies, headers } from 'next/headers'
import { UnauthorizedError } from '@/lib/errors'
import type { AppSession, AppSessionUser } from '@/lib/auth/types'
import {
  extractPrivyAccessToken,
  getPrivyClient,
  readPrivyAppSessionCookie,
  syncPrivyUserToLocalUser,
} from '@/lib/privy'

export function serializeSessionUser(user: {
  id: string
  name: string | null
  email: string | null
  image: string | null
  xUsername?: string | null
  privyUserId?: string | null
  embeddedWalletAddress?: string | null
  walletProvisioningStatus?: string | null
  walletProvisionedAt?: Date | string | null
}): AppSessionUser {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
    xUsername: user.xUsername ?? null,
    privyUserId: user.privyUserId ?? null,
    embeddedWalletAddress: user.embeddedWalletAddress ?? null,
    walletProvisioningStatus: (user.walletProvisioningStatus ?? 'not_started') as AppSessionUser['walletProvisioningStatus'],
    walletProvisionedAt: user.walletProvisionedAt
      ? new Date(user.walletProvisionedAt).toISOString()
      : null,
  }
}

export async function getSession(): Promise<AppSession | null> {
  const privyClient = getPrivyClient()
  if (!privyClient) return null

  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()])
  const accessToken = extractPrivyAccessToken(headerStore, cookieStore)

  if (accessToken) {
    try {
      const verified = await privyClient.utils().auth().verifyAccessToken(accessToken)
      const privyUser = await privyClient.users()._get(verified.user_id)
      const syncedUser = await syncPrivyUserToLocalUser(privyUser)

      return {
        source: 'privy',
        user: serializeSessionUser(syncedUser),
      }
    } catch (error) {
      if (error instanceof InvalidAuthTokenError) {
        return null
      }

      throw error
    }
  }

  const cookieUser = readPrivyAppSessionCookie(cookieStore)
  if (!cookieUser?.id) {
    return null
  }

  return {
    source: 'privy',
    user: cookieUser,
  }
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new UnauthorizedError('Please sign in first')
  }

  return session
}
