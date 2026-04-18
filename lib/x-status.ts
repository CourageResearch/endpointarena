import { and, eq } from 'drizzle-orm'
import { db, accounts, users } from '@/lib/db'
import { getUsableXAccessToken } from '@/lib/x-auth'
import { buildLocalDevXConnectionStatus, canUseLocalDevXConnectionBypass } from '@/lib/local-dev-bypass'
import { userColumns } from '@/lib/users/query-shapes'

export type XCheckState = 'ok' | 'requires_reconnect' | 'temporarily_unavailable'

export type XConnectionStatus = {
  connected: boolean
  requiresReconnect: boolean
  xCheckState: XCheckState
  username: string | null
}

export async function getXConnectionStatusForUser(userId: string): Promise<XConnectionStatus | null> {
  const [user, xAccount] = await Promise.all([
    db.query.users.findFirst({
      columns: userColumns,
      where: eq(users.id, userId),
    }),
    db.query.accounts.findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.provider, 'twitter'),
      ),
    }),
  ])

  if (!user) {
    return null
  }

  if (canUseLocalDevXConnectionBypass(user.email)) {
    return buildLocalDevXConnectionStatus(user.email)
  }

  const resolvedXUserId = user.xUserId ?? xAccount?.providerAccountId ?? null
  if (resolvedXUserId && !user.xUserId) {
    await db.update(users)
      .set({
        xUserId: resolvedXUserId,
        xConnectedAt: user.xConnectedAt ?? new Date(),
      })
      .where(eq(users.id, user.id))
  }

  if (!resolvedXUserId || !xAccount) {
    return {
      connected: false,
      requiresReconnect: false,
      xCheckState: 'ok',
      username: user.xUsername ?? null,
    }
  }

  let requiresReconnect = false
  let xCheckState: XCheckState = 'ok'

  try {
    const tokenResolution = await getUsableXAccessToken(user.id, xAccount)
    requiresReconnect = tokenResolution.requiresReconnect
    if (requiresReconnect) {
      xCheckState = 'requires_reconnect'
    }
  } catch (error) {
    xCheckState = 'temporarily_unavailable'
    console.warn('Failed to resolve X access token while building connection status', { userId: user.id })
  }

  return {
    connected: true,
    requiresReconnect,
    xCheckState,
    username: user.xUsername ?? null,
  }
}
