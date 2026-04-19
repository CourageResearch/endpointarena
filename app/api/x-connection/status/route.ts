import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSession } from '@/lib/auth/session'
import { getXConnectionStatusForUser } from '@/lib/x-status'
import { getXClientCredentials } from '@/lib/x-env'

export async function GET() {
  const requestId = createRequestId()
  const { clientId, clientSecret } = getXClientCredentials()
  const oauthConfigured = Boolean(clientId && clientSecret)

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return successResponse({
        authenticated: false,
        oauthConfigured,
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
        oauthConfigured,
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
      oauthConfigured,
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
