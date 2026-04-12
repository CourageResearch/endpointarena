import { and, eq, isNull, sql } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { db, accounts, marketAccounts, users } from '@/lib/db'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import { ensureHumanTradingAccount, getCanonicalHumanStartingCash, getVerificationCashAward } from '@/lib/human-cash'
import { getUsableXAccessToken } from '@/lib/x-auth'
import { userColumns } from '@/lib/users/query-shapes'
import { VERIFICATION_BONUS_CASH } from '@/lib/constants'
import {
  extractVerificationChallengeToken,
  fetchVerificationPostById,
  getVerificationPostMustStayUntil,
  hashChallengeToken,
  parseVerificationPostId,
} from '@/lib/x-verification'

type VerifyBody = {
  postUrl?: string
  postId?: string
  challengeToken?: string
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      throw new UnauthorizedError('Please sign in first')
    }

    const body = await parseJsonBody<VerifyBody>(request)

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

    if (user.xVerifiedAt) {
      const { account } = await ensureHumanTradingAccount({
        userId: user.id,
        displayName: user.name,
        startingCash: getCanonicalHumanStartingCash(true),
      })

      return successResponse({
        verified: true,
        cashAwarded: getVerificationCashAward(true),
        cashBalance: account.cashBalance,
        verifiedAt: user.xVerifiedAt.toISOString(),
        mustStayUntil: user.xMustStayUntil?.toISOString() ?? null,
        postId: user.xVerifiedPostId,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const resolvedXUserId = user.xUserId ?? xAccount?.providerAccountId ?? null

    if (!resolvedXUserId || !xAccount) {
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

    const tokenResolution = await getUsableXAccessToken(session.user.id, xAccount)
    if (!tokenResolution.accessToken) {
      if (tokenResolution.requiresReconnect) {
        throw new ValidationError('Your X connection expired. Reconnect your X account and retry.')
      }
      throw new ValidationError('Connect your X account before verification')
    }

    const source = (body.postId || body.postUrl || '').trim()
    const postId = parseVerificationPostId(source)
    const post = await fetchVerificationPostById(tokenResolution.accessToken, postId)

    if (!post) {
      throw new ValidationError('Could not find that X post from your connected account')
    }

    if (post.authorId !== resolvedXUserId) {
      throw new ValidationError('X post author does not match your connected X account')
    }

    const challengeTokenFromPost = extractVerificationChallengeToken(post.text)
    const submittedChallengeToken = challengeTokenFromPost ?? body.challengeToken?.trim() ?? null

    if (!submittedChallengeToken) {
      throw new ValidationError('X post does not contain a verification code. Generate a new verification post and publish it as written.')
    }

    if (!user.xChallengeTokenHash || !user.xChallengeExpiresAt) {
      throw new ValidationError('Create a new challenge token first')
    }

    if (user.xChallengeExpiresAt.getTime() <= Date.now()) {
      await db.update(users)
        .set({
          xChallengeToken: null,
          xChallengeTokenHash: null,
          xChallengeExpiresAt: null,
        })
        .where(eq(users.id, user.id))
      throw new ValidationError('Challenge token expired. Generate a new one.')
    }

    if (hashChallengeToken(submittedChallengeToken) !== user.xChallengeTokenHash) {
      throw new ValidationError('X post does not match your current verification code. Generate a new verification post and use that new post URL.')
    }

    if (!post.text.includes(submittedChallengeToken)) {
      throw new ValidationError('X post does not contain the required verification tag')
    }

    const now = new Date()
    const mustStayUntil = getVerificationPostMustStayUntil(now)
    const verificationCash = getCanonicalHumanStartingCash(true)

    const verificationResult = await db.transaction(async (tx) => {
      const [updatedUser] = await tx.update(users)
        .set({
          xVerifiedAt: now,
          xVerifiedPostId: post.id,
          xMustStayUntil: mustStayUntil,
          xChallengeToken: null,
          xChallengeTokenHash: null,
          xChallengeExpiresAt: null,
        })
        .where(and(
          eq(users.id, user.id),
          isNull(users.xVerifiedAt),
        ))
        .returning({
          id: users.id,
        })

      if (!updatedUser) {
        const [verifiedUser] = await tx.select({
          verifiedAt: users.xVerifiedAt,
          mustStayUntil: users.xMustStayUntil,
          postId: users.xVerifiedPostId,
        })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)

        const { account } = await ensureHumanTradingAccount({
          userId: user.id,
          dbClient: tx,
          displayName: user.name,
          startingCash: verificationCash,
        })

        return {
          cashAwarded: getVerificationCashAward(true),
          cashBalance: account.cashBalance,
          verifiedAt: verifiedUser?.verifiedAt?.toISOString() ?? now.toISOString(),
          mustStayUntil: verifiedUser?.mustStayUntil?.toISOString() ?? mustStayUntil.toISOString(),
          postId: verifiedUser?.postId ?? post.id,
        }
      }

      const { actor, created, account } = await ensureHumanTradingAccount({
        userId: user.id,
        dbClient: tx,
        displayName: user.name,
        startingCash: verificationCash,
      })

      if (created) {
        return {
          cashAwarded: VERIFICATION_BONUS_CASH,
          cashBalance: account.cashBalance,
          verifiedAt: now.toISOString(),
          mustStayUntil: mustStayUntil.toISOString(),
          postId: post.id,
        }
      }

      const [updatedAccount] = await tx.update(marketAccounts)
        .set({
          startingCash: sql`${marketAccounts.startingCash} + ${VERIFICATION_BONUS_CASH}`,
          cashBalance: sql`${marketAccounts.cashBalance} + ${VERIFICATION_BONUS_CASH}`,
          updatedAt: now,
        })
        .where(eq(marketAccounts.actorId, actor.id))
        .returning({
          cashBalance: marketAccounts.cashBalance,
        })

      if (!updatedAccount) {
        throw new Error(`Failed to award verification cash for user ${user.id}`)
      }

      return {
        cashAwarded: VERIFICATION_BONUS_CASH,
        cashBalance: updatedAccount.cashBalance,
        verifiedAt: now.toISOString(),
        mustStayUntil: mustStayUntil.toISOString(),
        postId: post.id,
      }
    })

    return successResponse({
      verified: true,
      cashAwarded: verificationResult.cashAwarded,
      cashBalance: verificationResult.cashBalance,
      verifiedAt: verificationResult.verifiedAt,
      mustStayUntil: verificationResult.mustStayUntil,
      postId: verificationResult.postId,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to verify X post')
  }
}
