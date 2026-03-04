import { and, eq, sql } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { db, accounts, users } from '@/lib/db'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import {
  fetchTweetById,
  getTweetMustStayUntil,
  hashChallengeToken,
  parseTweetId,
} from '@/lib/twitter-verification'

type VerifyBody = {
  tweetUrl?: string
  tweetId?: string
  challengeToken?: string
}

const UNLOCK_BONUS_POINTS = 100

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      throw new UnauthorizedError('Please sign in first')
    }

    const body = await parseJsonBody<VerifyBody>(request)
    const challengeToken = body.challengeToken?.trim()
    if (!challengeToken) {
      throw new ValidationError('Challenge token is required')
    }

    const [user, twitterAccount] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, session.user.id),
      }),
      db.query.accounts.findFirst({
        where: and(
          eq(accounts.userId, session.user.id),
          eq(accounts.provider, 'twitter'),
        ),
      }),
    ])

    if (!user) {
      throw new UnauthorizedError('User account not found')
    }

    if (user.tweetVerifiedAt) {
      return successResponse({
        verified: true,
        verifiedAt: user.tweetVerifiedAt.toISOString(),
        mustStayUntil: user.tweetMustStayUntil?.toISOString() ?? null,
        tweetId: user.tweetVerifiedTweetId,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const resolvedXUserId = user.xUserId ?? twitterAccount?.providerAccountId ?? null

    if (!resolvedXUserId || !twitterAccount?.access_token) {
      throw new ValidationError('Connect your X account before verification')
    }

    if (!user.xUserId) {
      await db.update(users)
        .set({
          xUserId: resolvedXUserId,
          xConnectedAt: user.xConnectedAt ?? new Date(),
        })
        .where(eq(users.id, user.id))
    }

    if (!user.tweetChallengeTokenHash || !user.tweetChallengeExpiresAt) {
      throw new ValidationError('Create a new challenge token first')
    }

    if (user.tweetChallengeExpiresAt.getTime() <= Date.now()) {
      throw new ValidationError('Challenge token expired. Generate a new one.')
    }

    if (hashChallengeToken(challengeToken) !== user.tweetChallengeTokenHash) {
      throw new ValidationError('Challenge token does not match the active challenge')
    }

    const source = (body.tweetId || body.tweetUrl || '').trim()
    const tweetId = parseTweetId(source)
    const tweet = await fetchTweetById(twitterAccount.access_token, tweetId)

    if (!tweet) {
      throw new ValidationError('Could not find that tweet from your connected account')
    }

    if (tweet.authorId !== resolvedXUserId) {
      throw new ValidationError('Tweet author does not match your connected X account')
    }

    if (!tweet.text.includes(challengeToken)) {
      throw new ValidationError('Tweet does not contain the required verification tag')
    }

    const now = new Date()
    const mustStayUntil = getTweetMustStayUntil(now)

    await db.update(users)
      .set({
        tweetVerifiedAt: now,
        tweetVerifiedTweetId: tweet.id,
        tweetMustStayUntil: mustStayUntil,
        tweetChallengeTokenHash: null,
        tweetChallengeExpiresAt: null,
        // One-time unlock bonus; set refill marker so +1000 daily refill starts next UTC day.
        pointsBalance: sql`${users.pointsBalance} + ${UNLOCK_BONUS_POINTS}`,
        lastPointsRefillAt: now,
      })
      .where(eq(users.id, user.id))

    return successResponse({
      verified: true,
      pointsAwarded: UNLOCK_BONUS_POINTS,
      verifiedAt: now.toISOString(),
      mustStayUntil: mustStayUntil.toISOString(),
      tweetId: tweet.id,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to verify tweet')
  }
}
