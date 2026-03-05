import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getTwitterVerificationStatusForUser } from '@/lib/twitter-status'

export async function GET() {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return successResponse({
        authenticated: false,
        connected: false,
        verified: false,
        requiresReconnect: false,
        xCheckState: 'ok' as const,
        username: null,
        mustStayUntil: null,
        verifiedAt: null,
        profile: null,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const status = await getTwitterVerificationStatusForUser(session.user.id)
    if (!status) {
      return successResponse({
        authenticated: false,
        connected: false,
        verified: false,
        requiresReconnect: false,
        xCheckState: 'ok' as const,
        username: null,
        mustStayUntil: null,
        verifiedAt: null,
        profile: null,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    return successResponse({
      authenticated: true,
      connected: status.connected,
      verified: status.verified,
      requiresReconnect: status.requiresReconnect,
      xCheckState: status.xCheckState,
      username: status.username,
      mustStayUntil: status.mustStayUntil,
      verifiedAt: status.verifiedAt,
      profile: status.profile,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load verification status')
  }
}
