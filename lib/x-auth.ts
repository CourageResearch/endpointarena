import { and, eq } from 'drizzle-orm'
import { accounts, db } from '@/lib/db'
import { ExternalServiceError } from '@/lib/errors'
import { getXClientCredentials } from '@/lib/x-env'

const X_TOKEN_REFRESH_ENDPOINT = 'https://api.twitter.com/2/oauth2/token'
const TOKEN_EXPIRY_SKEW_SECONDS = 60

type XAccountRow = typeof accounts.$inferSelect

type TokenRefreshSuccess = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  tokenType: string | null
  scope: string | null
}

type TokenRefreshReconnect = {
  requiresReconnect: true
}

type TokenRefreshResult = TokenRefreshSuccess | TokenRefreshReconnect

type XTokenRefreshPayload = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
}

type XTokenResolution = {
  account: XAccountRow | null
  accessToken: string | null
  requiresReconnect: boolean
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getNowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function isAccessTokenExpired(expiresAt: number | null | undefined, nowEpochSeconds: number): boolean {
  if (typeof expiresAt !== 'number') return false
  return expiresAt <= nowEpochSeconds + TOKEN_EXPIRY_SKEW_SECONDS
}

function refreshFailureRequiresReconnect(status: number, payload: XTokenRefreshPayload | null): boolean {
  if (status === 400 || status === 401 || status === 403) return true
  const code = payload?.error
  return code === 'invalid_grant'
    || code === 'invalid_request'
    || code === 'unauthorized_client'
    || code === 'invalid_client'
}

async function refreshXAccessToken({
  refreshToken,
  clientId,
  clientSecret,
}: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<TokenRefreshResult> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  let response: Response
  try {
    response = await fetch(X_TOKEN_REFRESH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      cache: 'no-store',
    })
  } catch (error) {
    throw new ExternalServiceError('Failed to refresh X access token', {
      cause: error,
    })
  }

  const rawPayload = await response.text().catch(() => '')
  let parsed: XTokenRefreshPayload | null = null
  try {
    parsed = rawPayload ? JSON.parse(rawPayload) as XTokenRefreshPayload : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    if (refreshFailureRequiresReconnect(response.status, parsed)) {
      return { requiresReconnect: true }
    }
    throw new ExternalServiceError('Failed to refresh X access token', {
      details: {
        status: response.status,
        body: rawPayload.slice(0, 1000),
      },
    })
  }

  const accessToken = trimOrNull(parsed?.access_token)
  if (!accessToken) {
    throw new ExternalServiceError('X token refresh returned no access token')
  }

  const expiresIn = typeof parsed?.expires_in === 'number' && Number.isFinite(parsed.expires_in)
    ? Math.max(0, Math.floor(parsed.expires_in))
    : null
  const expiresAt = expiresIn == null ? null : getNowEpochSeconds() + expiresIn

  return {
    accessToken,
    refreshToken: trimOrNull(parsed?.refresh_token),
    tokenType: trimOrNull(parsed?.token_type),
    scope: trimOrNull(parsed?.scope),
    expiresAt,
  }
}

export async function getUsableXAccessToken(
  userId: string,
  accountOverride?: XAccountRow | null,
): Promise<XTokenResolution> {
  const account = accountOverride !== undefined
    ? accountOverride
    : await db.query.accounts.findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.provider, 'twitter'),
      ),
    })

  if (!account) {
    return {
      account: null,
      accessToken: null,
      requiresReconnect: false,
    }
  }

  const currentAccessToken = trimOrNull(account.access_token)
  if (!currentAccessToken) {
    return {
      account,
      accessToken: null,
      requiresReconnect: true,
    }
  }

  const nowEpochSeconds = getNowEpochSeconds()
  if (!isAccessTokenExpired(account.expires_at, nowEpochSeconds)) {
    return {
      account,
      accessToken: currentAccessToken,
      requiresReconnect: false,
    }
  }

  const refreshToken = trimOrNull(account.refresh_token)
  if (!refreshToken) {
    console.warn('X token expired and no refresh token is available', { userId })
    return {
      account,
      accessToken: null,
      requiresReconnect: true,
    }
  }

  const { clientId, clientSecret } = getXClientCredentials()
  if (!clientId || !clientSecret) {
    console.warn('X token refresh cannot run because X app credentials are missing', { userId })
    return {
      account,
      accessToken: null,
      requiresReconnect: true,
    }
  }

  let refreshed: TokenRefreshResult
  try {
    refreshed = await refreshXAccessToken({
      refreshToken,
      clientId,
      clientSecret,
    })
  } catch (error) {
    console.warn('X token refresh failed due to external error', { userId })
    throw error
  }

  if ('requiresReconnect' in refreshed) {
    console.warn('X token refresh requires reconnect', { userId })
    return {
      account,
      accessToken: null,
      requiresReconnect: true,
    }
  }

  const nextRefreshToken = refreshed.refreshToken ?? trimOrNull(account.refresh_token)
  const nextTokenType = refreshed.tokenType ?? trimOrNull(account.token_type)
  const nextScope = refreshed.scope ?? trimOrNull(account.scope)

  await db.update(accounts)
    .set({
      access_token: refreshed.accessToken,
      refresh_token: nextRefreshToken,
      expires_at: refreshed.expiresAt,
      token_type: nextTokenType,
      scope: nextScope,
    })
    .where(eq(accounts.id, account.id))

  return {
    account: {
      ...account,
      access_token: refreshed.accessToken,
      refresh_token: nextRefreshToken,
      expires_at: refreshed.expiresAt,
      token_type: nextTokenType,
      scope: nextScope,
    },
    accessToken: refreshed.accessToken,
    requiresReconnect: false,
  }
}
