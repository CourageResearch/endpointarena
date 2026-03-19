import { and, eq } from 'drizzle-orm'
import { db, accounts, users } from '@/lib/db'
import { applyDailyRefillIfEligible, getVerifiedHumansRank } from '@/lib/humans'
import { getUsableTwitterAccessToken } from '@/lib/twitter-auth'
import { fetchTweetById, isXConnectionExpiredError } from '@/lib/twitter-verification'
import { buildLocalDevVerificationStatus, canUseLocalDevVerificationBypass } from '@/lib/local-dev-bypass'

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
    pointsBalance: number
    rank: number
    lastPointsRefillAt: string | null
    refillAwarded: number
  } | null
}

export async function getTwitterVerificationStatusForUser(userId: string): Promise<TwitterVerificationStatus | null> {
  const [user, twitterAccount] = await Promise.all([
    db.query.users.findFirst({
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
    const canCheckLiveTweet = Boolean(
      tokenResolution.accessToken &&
      resolvedXUserId &&
      user.tweetVerifiedTweetId
    )

    let keepVerified = true

    if (canCheckLiveTweet && tokenResolution.accessToken && user.tweetVerifiedTweetId && resolvedXUserId) {
      try {
        const tweet = await fetchTweetById(tokenResolution.accessToken, user.tweetVerifiedTweetId)
        keepVerified = Boolean(tweet && tweet.authorId === resolvedXUserId)
      } catch (error) {
        if (isXConnectionExpiredError(error)) {
          requiresReconnect = true
          xCheckState = 'requires_reconnect'
          console.warn('X token expired while checking verification tweet', { userId: user.id })
        } else {
          xCheckState = 'temporarily_unavailable'
          console.warn('Skipping live tweet check because X API is temporarily unavailable', { userId: user.id })
        }
      }
    } else if (tokenResolution.requiresReconnect) {
      requiresReconnect = true
      xCheckState = 'requires_reconnect'
      console.warn('Skipping live tweet check because X reconnect is required', { userId: user.id })
    } else if (!resolvedXUserId || !user.tweetVerifiedTweetId) {
      xCheckState = 'temporarily_unavailable'
      console.warn('Skipping live tweet check because verification metadata is incomplete', { userId: user.id })
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
    pointsBalance: number
    rank: number
    lastPointsRefillAt: string | null
    refillAwarded: number
  } | null = null
  if (verified) {
    const pointsState = await applyDailyRefillIfEligible(user.id)
    const rank = await getVerifiedHumansRank(pointsState.pointsBalance)
    profile = {
      pointsBalance: pointsState.pointsBalance,
      rank,
      lastPointsRefillAt: pointsState.lastPointsRefillAt?.toISOString() ?? null,
      refillAwarded: pointsState.refillAwarded,
    }
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
