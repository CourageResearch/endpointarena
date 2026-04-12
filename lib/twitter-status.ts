import { and, eq } from 'drizzle-orm'
import { db, accounts, users } from '@/lib/db'
import { getUsableTwitterAccessToken } from '@/lib/twitter-auth'
import { fetchVerificationPostById, isXConnectionExpiredError } from '@/lib/twitter-verification'
import { buildLocalDevVerificationStatus, canUseLocalDevVerificationBypass } from '@/lib/local-dev-bypass'
import { userColumns } from '@/lib/users/query-shapes'
import { ensureHumanTradingAccount, getCanonicalHumanStartingCash, getVerifiedHumanCashProfile } from '@/lib/human-cash'

type XCheckState = 'ok' | 'requires_reconnect' | 'temporarily_unavailable'

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type TwitterVerificationStatus = {
  connected: boolean
  verified: boolean
  requiresReconnect: boolean
  xCheckState: XCheckState
  username: string | null
  mustStayUntil: string | null
  verifiedAt: string | null
  profile: {
    cashBalance: number
    rank: number
  } | null
}

export async function getTwitterVerificationStatusForUser(userId: string): Promise<TwitterVerificationStatus | null> {
  const [user, twitterAccount] = await Promise.all([
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

  const resolvedXUserId = user.xUserId ?? twitterAccount?.providerAccountId ?? null
  if (resolvedXUserId && !user.xUserId) {
    await db.update(users)
      .set({
        xUserId: resolvedXUserId,
        xConnectedAt: user.xConnectedAt ?? new Date(),
      })
      .where(eq(users.id, user.id))
  }

  let tokenResolution = {
    account: twitterAccount ?? null,
    accessToken: trimOrNull(twitterAccount?.access_token),
    requiresReconnect: false,
  }
  let xCheckState: XCheckState = 'ok'

  try {
    tokenResolution = await getUsableTwitterAccessToken(user.id, twitterAccount)
  } catch (error) {
    xCheckState = 'temporarily_unavailable'
    console.warn('Failed to resolve X access token while building verification status', { userId: user.id })
  }

  const connected = Boolean(resolvedXUserId && tokenResolution.account)
  let verified = Boolean(user.tweetVerifiedAt)
  let mustStayUntil = user.tweetMustStayUntil
  let verifiedAt = user.tweetVerifiedAt
  let requiresReconnect = tokenResolution.requiresReconnect

  if (
    verified &&
    mustStayUntil &&
    mustStayUntil.getTime() > Date.now()
  ) {
    const canCheckLivePost = Boolean(
      tokenResolution.accessToken &&
      resolvedXUserId &&
      user.tweetVerifiedTweetId
    )

    let keepVerified = true

    if (canCheckLivePost && tokenResolution.accessToken && user.tweetVerifiedTweetId && resolvedXUserId) {
      try {
        const post = await fetchVerificationPostById(tokenResolution.accessToken, user.tweetVerifiedTweetId)
        keepVerified = Boolean(post && post.authorId === resolvedXUserId)
      } catch (error) {
        if (isXConnectionExpiredError(error)) {
          requiresReconnect = true
          xCheckState = 'requires_reconnect'
          console.warn('X token expired while checking verification post', { userId: user.id })
        } else {
          xCheckState = 'temporarily_unavailable'
          console.warn('Skipping live verification post check because X API is temporarily unavailable', { userId: user.id })
        }
      }
    } else if (tokenResolution.requiresReconnect) {
      requiresReconnect = true
      xCheckState = 'requires_reconnect'
      console.warn('Skipping live verification post check because X reconnect is required', { userId: user.id })
    } else if (!resolvedXUserId || !user.tweetVerifiedTweetId) {
      xCheckState = 'temporarily_unavailable'
      console.warn('Skipping live verification post check because verification metadata is incomplete', { userId: user.id })
    }

    if (!keepVerified) {
      await db.update(users)
        .set({
          tweetVerifiedAt: null,
          tweetVerifiedTweetId: null,
          tweetMustStayUntil: null,
        })
        .where(eq(users.id, user.id))

      verified = false
      mustStayUntil = null
      verifiedAt = null
      requiresReconnect = false
      xCheckState = 'ok'
    }
  }

  let profile: {
    cashBalance: number
    rank: number
  } | null = null
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
    mustStayUntil: mustStayUntil?.toISOString() ?? null,
    verifiedAt: verifiedAt?.toISOString() ?? null,
    profile,
  }
}
