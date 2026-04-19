import { cookies, headers } from 'next/headers'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSession, serializeSessionUser } from '@/lib/auth/session'
import { ConfigurationError, UnauthorizedError } from '@/lib/errors'
import {
  extractPrivyAccessToken,
  getPrivyClient,
  setPrivyAccessTokenCookie,
  setPrivyAppSessionCookie,
  syncPrivyUserToLocalUser,
} from '@/lib/privy'

function hasEmbeddedEthereumWallet(linkedAccounts: Array<{ type?: string; chain_type?: string; connector_type?: string }>): boolean {
  return linkedAccounts.some((account) => (
    account.type === 'wallet'
    && account.chain_type === 'ethereum'
    && account.connector_type === 'embedded'
  ))
}

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

    let privyUser = await privyClient.users()._get(session.user.privyUserId)
    if (!hasEmbeddedEthereumWallet(privyUser.linked_accounts)) {
      privyUser = await privyClient.users().pregenerateWallets(session.user.privyUserId, {
        wallets: [{ chain_type: 'ethereum' }],
      })
    }

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
