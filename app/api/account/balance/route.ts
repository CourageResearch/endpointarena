import { eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { db, users } from '@/lib/db'
import { UnauthorizedError } from '@/lib/errors'
import { ensureHumanTradingAccount, getCanonicalHumanStartingCash } from '@/lib/human-cash'

export async function GET() {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      throw new UnauthorizedError('Please sign in first')
    }

    const user = await db.query.users.findFirst({
      columns: {
        id: true,
        name: true,
        xVerifiedAt: true,
      },
      where: eq(users.id, session.user.id),
    })

    if (!user) {
      throw new UnauthorizedError('User account not found')
    }

    const { account } = await ensureHumanTradingAccount({
      userId: user.id,
      displayName: user.name,
      startingCash: getCanonicalHumanStartingCash(Boolean(user.xVerifiedAt)),
    })

    return successResponse({
      cashBalance: account.cashBalance,
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load account balance')
  }
}
