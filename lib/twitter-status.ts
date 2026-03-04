import { and, eq } from 'drizzle-orm'
import { db, accounts, users } from '@/lib/db'
import { applyDailyRefillIfEligible, getVerifiedHumansRank } from '@/lib/humans'
import { fetchTweetById } from '@/lib/twitter-verification'

export type TwitterVerificationStatus = {
  connected: boolean
  verified: boolean
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

  const resolvedXUserId = user.xUserId ?? twitterAccount?.providerAccountId ?? null
  if (resolvedXUserId && !user.xUserId) {
    await db.update(users)
      .set({
        xUserId: resolvedXUserId,
        xConnectedAt: user.xConnectedAt ?? new Date(),
      })
      .where(eq(users.id, user.id))
  }

  const connected = Boolean(resolvedXUserId && twitterAccount?.access_token)
  let verified = Boolean(user.tweetVerifiedAt)
  let mustStayUntil = user.tweetMustStayUntil
  let verifiedAt = user.tweetVerifiedAt

  if (
    verified &&
    mustStayUntil &&
    mustStayUntil.getTime() > Date.now()
  ) {
    const canCheckLiveTweet = Boolean(
      twitterAccount?.access_token &&
      resolvedXUserId &&
      user.tweetVerifiedTweetId
    )

    let keepVerified = canCheckLiveTweet
    if (keepVerified && twitterAccount?.access_token && user.tweetVerifiedTweetId && resolvedXUserId) {
      const tweet = await fetchTweetById(twitterAccount.access_token, user.tweetVerifiedTweetId)
      keepVerified = Boolean(tweet && tweet.authorId === resolvedXUserId)
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
    username: user.xUsername ?? null,
    mustStayUntil: mustStayUntil?.toISOString() ?? null,
    verifiedAt: verifiedAt?.toISOString() ?? null,
    profile,
  }
}
