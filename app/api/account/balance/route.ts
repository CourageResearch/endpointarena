import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/auth/session'
import { db, users } from '@/lib/db'
import { getSeason4NavbarBalance } from '@/lib/season4-market-data'
import { eq } from 'drizzle-orm'
import { UnauthorizedError } from '@/lib/errors'

export function buildSeason4AccountBalancePayload(season4Balance: number | null) {
  return {
    cashBalance: season4Balance ?? 0,
  }
}

export async function GET() {
  const requestId = createRequestId()

  try {
    const session = await requireSession()

    const user = await db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: eq(users.id, session.user.id),
    })

    if (!user) {
      throw new UnauthorizedError('User account not found')
    }

    const season4Balance = await getSeason4NavbarBalance(user.id)
    return successResponse(buildSeason4AccountBalancePayload(season4Balance), {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load account balance')
  }
}
