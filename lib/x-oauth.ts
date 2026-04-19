import { createHash, createHmac, randomBytes } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { accounts, db, users } from '@/lib/db'
import {
  ConfigurationError,
  ConflictError,
  ExternalServiceError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors'
import { getXClientCredentials } from '@/lib/x-env'

const X_OAUTH_COOKIE_NAME = 'endpointarena_x_oauth'
const X_OAUTH_SCOPE = 'users.read offline.access'
const X_AUTHORIZE_ENDPOINT = 'https://x.com/i/oauth2/authorize'
const X_TOKEN_ENDPOINT = 'https://api.twitter.com/2/oauth2/token'
const X_PROFILE_ENDPOINT = 'https://api.twitter.com/2/users/me?user.fields=username'
const X_OAUTH_TTL_SECONDS = 10 * 60

type PendingXOAuthState = {
  state: string
  codeVerifier: string
  userId: string
  callbackUrl: string
  expiresAt: number
}

type XTokenPayload = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

type XUserProfilePayload = {
  data?: {
    id?: string
    username?: string
  }
  errors?: Array<{
    title?: string
    detail?: string
  }>
}

export type XTokenExchangeResult = {
  accessToken: string
  refreshToken: string | null
  tokenType: string | null
  scope: string | null
  expiresAt: number | null
}

export type XUserProfile = {
  id: string
  username: string | null
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/trials'
  if (!raw.startsWith('/')) return '/trials'
  if (raw.startsWith('//')) return '/trials'
  return raw
}

function getOAuthCookieSigningSecret(): string {
  const secret = trimOrNull(process.env.PRIVY_APP_SECRET)

  if (!secret) {
    throw new ConfigurationError('PRIVY_APP_SECRET is required for X OAuth state signing')
  }

  return secret
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.isBuffer(value)
    ? value.toString('base64url')
    : Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signPayload(payload: string): string {
  return createHmac('sha256', getOAuthCookieSigningSecret())
    .update(payload)
    .digest('base64url')
}

function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

export function getXOAuthCookieName(): string {
  return X_OAUTH_COOKIE_NAME
}

export function buildXCallbackRedirectPath(callbackUrl: string, errorCode?: string | null): string {
  const normalizedCallbackUrl = normalizeCallbackUrl(callbackUrl)
  const params = new URLSearchParams()
  params.set('callbackUrl', normalizedCallbackUrl)
  if (errorCode) {
    params.set('error', errorCode)
  }

  return `/profile?${params.toString()}`
}

export function createSignedXOAuthState(userId: string, callbackUrl: string): {
  cookieValue: string
  authorizationState: string
  codeVerifier: string
} {
  const payload: PendingXOAuthState = {
    state: randomUrlSafe(24),
    codeVerifier: randomUrlSafe(48),
    userId,
    callbackUrl: normalizeCallbackUrl(callbackUrl),
    expiresAt: Math.floor(Date.now() / 1000) + X_OAUTH_TTL_SECONDS,
  }

  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)

  return {
    cookieValue: `${encodedPayload}.${signature}`,
    authorizationState: payload.state,
    codeVerifier: payload.codeVerifier,
  }
}

export function readSignedXOAuthState(cookieValue: string | null | undefined): PendingXOAuthState {
  if (!cookieValue) {
    throw new ValidationError('Missing X OAuth state')
  }

  const [encodedPayload, signature] = cookieValue.split('.')
  if (!encodedPayload || !signature) {
    throw new ValidationError('Invalid X OAuth state')
  }

  const expectedSignature = signPayload(encodedPayload)
  if (signature !== expectedSignature) {
    throw new ValidationError('Invalid X OAuth state signature')
  }

  let parsed: PendingXOAuthState
  try {
    parsed = JSON.parse(decodeBase64Url(encodedPayload)) as PendingXOAuthState
  } catch (error) {
    throw new ValidationError('Unable to parse X OAuth state', { cause: error })
  }

  if (
    !parsed
    || typeof parsed.state !== 'string'
    || typeof parsed.codeVerifier !== 'string'
    || typeof parsed.userId !== 'string'
    || typeof parsed.callbackUrl !== 'string'
    || typeof parsed.expiresAt !== 'number'
  ) {
    throw new ValidationError('Malformed X OAuth state')
  }

  if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new ValidationError('X OAuth state expired')
  }

  return {
    ...parsed,
    callbackUrl: normalizeCallbackUrl(parsed.callbackUrl),
  }
}

export function buildXAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  codeVerifier,
}: {
  clientId: string
  redirectUri: string
  state: string
  codeVerifier: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: X_OAUTH_SCOPE,
    state,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: 'S256',
  })

  return `${X_AUTHORIZE_ENDPOINT}?${params.toString()}`
}

export function resolveXCallbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/x-connection/callback`
}

export function requireXOAuthCredentials() {
  const { clientId, clientSecret } = getXClientCredentials()
  if (!clientId || !clientSecret) {
    throw new ConfigurationError('X OAuth is not configured. Add X_CLIENT_ID and X_CLIENT_SECRET.')
  }

  return { clientId, clientSecret }
}

export async function exchangeCodeForXTokens({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<XTokenExchangeResult> {
  const { clientId, clientSecret } = requireXOAuthCredentials()
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')

  let response: Response
  try {
    response = await fetch(X_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      cache: 'no-store',
    })
  } catch (error) {
    throw new ExternalServiceError('Failed to exchange X OAuth code', { cause: error })
  }

  const rawText = await response.text().catch(() => '')
  let parsed: XTokenPayload | null = null
  try {
    parsed = rawText ? JSON.parse(rawText) as XTokenPayload : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    throw new ExternalServiceError('X OAuth code exchange failed', {
      details: {
        status: response.status,
        body: rawText.slice(0, 1000),
      },
    })
  }

  const accessToken = trimOrNull(parsed?.access_token)
  if (!accessToken) {
    throw new ExternalServiceError('X OAuth did not return an access token')
  }

  const expiresIn = typeof parsed?.expires_in === 'number' && Number.isFinite(parsed.expires_in)
    ? Math.max(0, Math.floor(parsed.expires_in))
    : null

  return {
    accessToken,
    refreshToken: trimOrNull(parsed?.refresh_token),
    tokenType: trimOrNull(parsed?.token_type),
    scope: trimOrNull(parsed?.scope),
    expiresAt: expiresIn == null ? null : Math.floor(Date.now() / 1000) + expiresIn,
  }
}

export async function fetchXUserProfile(accessToken: string): Promise<XUserProfile> {
  let response: Response
  try {
    response = await fetch(X_PROFILE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })
  } catch (error) {
    throw new ExternalServiceError('Failed to load the X user profile', { cause: error })
  }

  const rawText = await response.text().catch(() => '')
  let parsed: XUserProfilePayload | null = null
  try {
    parsed = rawText ? JSON.parse(rawText) as XUserProfilePayload : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    throw new ExternalServiceError('Failed to load the X user profile', {
      details: {
        status: response.status,
        body: rawText.slice(0, 1000),
      },
    })
  }

  const userId = trimOrNull(parsed?.data?.id)
  if (!userId) {
    throw new ExternalServiceError('X user profile returned no user id')
  }

  return {
    id: userId,
    username: trimOrNull(parsed?.data?.username),
  }
}

export async function persistXConnectionForUser({
  userId,
  tokens,
  profile,
}: {
  userId: string
  tokens: XTokenExchangeResult
  profile: XUserProfile
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [currentUser] = await tx
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!currentUser) {
      throw new UnauthorizedError('User account not found')
    }

    const [linkedElsewhere] = await tx
      .select({
        id: users.id,
      })
      .from(users)
      .where(and(
        eq(users.xUserId, profile.id),
        ne(users.id, userId),
      ))
      .limit(1)

    if (linkedElsewhere) {
      throw new ConflictError('This X account is already linked to another user')
    }

    const existingAccounts = await tx
      .select({
        id: accounts.id,
      })
      .from(accounts)
      .where(and(
        eq(accounts.userId, userId),
        eq(accounts.provider, 'twitter'),
      ))

    const [primaryAccount, ...staleAccounts] = existingAccounts

    if (primaryAccount) {
      await tx.update(accounts)
        .set({
          type: 'oauth',
          providerAccountId: profile.id,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: tokens.expiresAt,
          token_type: tokens.tokenType,
          scope: tokens.scope,
          id_token: null,
          session_state: null,
        })
        .where(eq(accounts.id, primaryAccount.id))
    } else {
      await tx.insert(accounts).values({
        userId,
        type: 'oauth',
        provider: 'twitter',
        providerAccountId: profile.id,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
        token_type: tokens.tokenType,
        scope: tokens.scope,
        id_token: null,
        session_state: null,
      })
    }

    for (const staleAccount of staleAccounts) {
      await tx.delete(accounts)
        .where(eq(accounts.id, staleAccount.id))
    }

    await tx.update(users)
      .set({
        xUserId: profile.id,
        xUsername: profile.username,
        xConnectedAt: new Date(),
      })
      .where(eq(users.id, userId))
  })
}
