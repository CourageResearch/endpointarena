import { cookies, headers } from 'next/headers'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSession } from '@/lib/auth/session'
import { ConfigurationError, UnauthorizedError } from '@/lib/errors'
import {
  extractPrivyAccessToken,
  isPrivyConfigured,
  setPrivyAccessTokenCookie,
  setPrivyAppSessionCookie,
} from '@/lib/privy'

export async function POST() {
  const requestId = createRequestId()

  try {
    const [headerStore, cookieStore] = await Promise.all([headers(), cookies()])
    const accessToken = extractPrivyAccessToken(headerStore, cookieStore)

    if (!isPrivyConfigured()) {
      throw new ConfigurationError('Privy server credentials are missing. Add PRIVY_APP_SECRET to .env.local and restart the dev server.')
    }

    const session = await getSession()
    if (!session) {
      throw new UnauthorizedError('Privy authentication is required')
    }

    const response = successResponse(session, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })

    if (accessToken) {
      setPrivyAccessTokenCookie(response, accessToken)
    }
    setPrivyAppSessionCookie(response, session.user)

    return response
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to sync the Privy user')
  }
}
