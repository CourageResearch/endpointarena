import { and, eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { db, accounts, users } from '@/lib/db'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import { getUsableXAccessToken } from '@/lib/x-auth'
import { userColumns } from '@/lib/users/query-shapes'
import {
  buildDefaultVerificationPost,
  generateChallengeToken,
  getActiveXChallenge,
  getChallengeExpiry,
  hashChallengeToken,
} from '@/lib/x-verification'

export async function POST() {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      throw new UnauthorizedError('Please sign in first')
    }

    const [user, xAccount] = await Promise.all([
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

    const resolvedXUserId = user.xUserId ?? xAccount?.providerAccountId ?? null

    if (!resolvedXUserId || !xAccount) {
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

    const tokenResolution = await getUsableXAccessToken(session.user.id, xAccount)
    if (!tokenResolution.accessToken) {
      if (tokenResolution.requiresReconnect) {
        throw new ValidationError('Your X connection expired. Reconnect your X account and retry.')
      }
      throw new ValidationError('Connect your X account before creating a challenge')
    }

    if (user.xVerifiedAt) {
      return successResponse({
        alreadyVerified: true,
        verifiedAt: user.xVerifiedAt.toISOString(),
        mustStayUntil: user.xMustStayUntil?.toISOString() ?? null,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const activeChallenge = getActiveXChallenge(user)
    if (activeChallenge) {
      return successResponse(activeChallenge, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const token = generateChallengeToken()
    const expiresAt = getChallengeExpiry()

    await db.update(users)
      .set({
        xChallengeToken: token,
        xChallengeTokenHash: hashChallengeToken(token),
        xChallengeExpiresAt: expiresAt,
      })
      .where(eq(users.id, user.id))

    return successResponse({
      challengeToken: token,
      expiresAt: expiresAt.toISOString(),
      postTemplate: buildDefaultVerificationPost(token),
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to create verification challenge')
  }
}
