import { createRequestId, successResponse } from '@/lib/api-response'
import { clearPrivyAccessTokenCookie, clearPrivyAppSessionCookie } from '@/lib/privy'

export async function POST() {
  const requestId = createRequestId()
  const response = successResponse({
    success: true,
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  })

  clearPrivyAccessTokenCookie(response)
  clearPrivyAppSessionCookie(response)
  return response
}
