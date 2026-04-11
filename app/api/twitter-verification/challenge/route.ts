import { and, eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { db, accounts, users } from '@/lib/db'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import { getUsableTwitterAccessToken } from '@/lib/twitter-auth'
import { userColumns } from '@/lib/users/query-shapes'
import {
  buildDefaultVerificationTweet,
  generateChallengeToken,
  getChallengeExpiry,
  hashChallengeToken,
} from '@/lib/twitter-verification'

export async function POST() {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      throw new UnauthorizedError('Please sign in first')
    }

    const [user, twitterAccount] = await Promise.all([
      db.query.users.findFirst({
        columns: userColumns,
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

    const resolvedXUserId = user.xUserId ?? twitterAccount?.providerAccountId ?? null

    if (!resolvedXUserId || !twitterAccount) {
      throw new ValidationError('Connect your X account before creating a challenge')
    }

    if (!user.xUserId) {
      await db.update(users)
        .set({
          xUserId: resolvedXUserId,
          xConnectedAt: user.xConnectedAt ?? new Date(),
        })
        .where(eq(users.id, user.id))
    }

    const tokenResolution = await getUsableTwitterAccessToken(session.user.id, twitterAccount)
    if (!tokenResolution.accessToken) {
      if (tokenResolution.requiresReconnect) {
        throw new ValidationError('Your X connection expired. Reconnect your X account and retry.')
      }
      throw new ValidationError('Connect your X account before creating a challenge')
    }

    if (user.tweetVerifiedAt) {
      return successResponse({
        alreadyVerified: true,
        verifiedAt: user.tweetVerifiedAt.toISOString(),
        mustStayUntil: user.tweetMustStayUntil?.toISOString() ?? null,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const token = generateChallengeToken()
    const expiresAt = getChallengeExpiry()

    await db.update(users)
      .set({
        tweetChallengeTokenHash: hashChallengeToken(token),
        tweetChallengeExpiresAt: expiresAt,
      })
      .where(eq(users.id, user.id))

    return successResponse({
      challengeToken: token,
      expiresAt: expiresAt.toISOString(),
      tweetTemplate: buildDefaultVerificationTweet(token),
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to create verification challenge')
  }
}
