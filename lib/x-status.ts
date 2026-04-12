import { and, eq } from 'drizzle-orm'
import { db, accounts, users } from '@/lib/db'
import { getUsableXAccessToken } from '@/lib/x-auth'
import { getActiveXChallenge, type ActiveXChallenge } from '@/lib/x-verification'
import { buildLocalDevVerificationStatus, canUseLocalDevVerificationBypass } from '@/lib/local-dev-bypass'
import { userColumns } from '@/lib/users/query-shapes'
import { ensureHumanTradingAccount, getCanonicalHumanStartingCash, getVerifiedHumanCashProfile } from '@/lib/human-cash'

type XCheckState = 'ok' | 'requires_reconnect' | 'temporarily_unavailable'

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type XVerificationStatus = {
  connected: boolean
  verified: boolean
  requiresReconnect: boolean
  xCheckState: XCheckState
  username: string | null
  verifiedAt: string | null
  challenge: ActiveXChallenge | null
  profile: {
    cashBalance: number
    rank: number
  } | null
}

export async function getXVerificationStatusForUser(userId: string): Promise<XVerificationStatus | null> {
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

  if (canUseLocalDevVerificationBypass(user.email)) {
    return buildLocalDevVerificationStatus(user.email)
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

  let tokenResolution = {
    account: xAccount ?? null,
    accessToken: trimOrNull(xAccount?.access_token),
    requiresReconnect: false,
  }
  let xCheckState: XCheckState = 'ok'

  try {
    tokenResolution = await getUsableXAccessToken(user.id, xAccount)
  } catch (error) {
    xCheckState = 'temporarily_unavailable'
    console.warn('Failed to resolve X access token while building verification status', { userId: user.id })
  }

  const connected = Boolean(resolvedXUserId && tokenResolution.account)
  let verified = Boolean(user.xVerifiedAt)
  let verifiedAt = user.xVerifiedAt
  let requiresReconnect = tokenResolution.requiresReconnect

  let profile: {
    cashBalance: number
    rank: number
  } | null = null
  const challenge = (!verified && connected) ? getActiveXChallenge(user) : null
  if (verified) {
    await ensureHumanTradingAccount({
      userId: user.id,
      displayName: user.name,
      startingCash: getCanonicalHumanStartingCash(true),
    })
    profile = await getVerifiedHumanCashProfile(user.id)
  }

  return {
    connected,
    verified,
    requiresReconnect,
    xCheckState,
    username: user.xUsername ?? null,
    verifiedAt: verifiedAt?.toISOString() ?? null,
    challenge,
    profile,
  }
}
