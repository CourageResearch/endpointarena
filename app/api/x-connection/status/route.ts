import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getXConnectionStatusForUser } from '@/lib/x-status'

export async function GET() {
  const requestId = createRequestId()

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return successResponse({
        authenticated: false,
        connected: false,
        requiresReconnect: false,
        xCheckState: 'ok' as const,
        username: null,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    const status = await getXConnectionStatusForUser(session.user.id)
    if (!status) {
      return successResponse({
        authenticated: false,
        connected: false,
        requiresReconnect: false,
        xCheckState: 'ok' as const,
        username: null,
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    return successResponse({
      authenticated: true,
      connected: status.connected,
      requiresReconnect: status.requiresReconnect,
      xCheckState: status.xCheckState,
      username: status.username,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load X connection status')
  }
}
