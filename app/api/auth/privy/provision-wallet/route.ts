import { cookies, headers } from 'next/headers'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSession, serializeSessionUser } from '@/lib/auth/session'
import { ConfigurationError, UnauthorizedError } from '@/lib/errors'
import {
  ensurePrivyEmbeddedEthereumWallet,
  extractPrivyAccessToken,
  getPrivyClient,
  setPrivyAccessTokenCookie,
  setPrivyAppSessionCookie,
  syncPrivyUserToLocalUser,
} from '@/lib/privy'

export async function POST() {
  const requestId = createRequestId()

  try {
    const [headerStore, cookieStore] = await Promise.all([headers(), cookies()])
    const accessToken = extractPrivyAccessToken(headerStore, cookieStore)
    const session = await getSession()
    if (!session?.user?.privyUserId) {
      throw new UnauthorizedError('Privy authentication is required')
    }

    const privyClient = getPrivyClient()
    if (!privyClient) {
      throw new ConfigurationError('Privy is not configured for this environment')
    }

    const privyUser = await ensurePrivyEmbeddedEthereumWallet(session.user.privyUserId)
    const syncedUser = await syncPrivyUserToLocalUser(privyUser)

    const response = successResponse({
      success: true,
      user: syncedUser,
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })

    if (accessToken) {
      setPrivyAccessTokenCookie(response, accessToken)
    }
    setPrivyAppSessionCookie(response, serializeSessionUser(syncedUser))

    return response
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to provision the season 4 wallet')
  }
}
