import { createHash, randomBytes } from 'crypto'
import { ExternalServiceError, ValidationError, isAppError } from '@/lib/errors'

const X_CHALLENGE_TTL_MINUTES = 10
const VERIFICATION_POST_MUST_STAY_LIVE_HOURS = 12
const X_CONNECTION_EXPIRED_REASON = 'x_connection_expired'
const X_CREDITS_DEPLETED_REASON = 'x_credits_depleted'

type XUserMeResponse = {
  data?: {
    id?: string
    username?: string
    name?: string
  }
}

type XPostResponse = {
  data?: {
    id?: string
    text?: string
    author_id?: string
    created_at?: string
  }
}

type XProblemResponse = {
  title?: string
  detail?: string
  type?: string
}

type VerifiedPost = {
  id: string
  text: string
  authorId: string
  createdAt: string | null
}

type StoredXChallenge = {
  xChallengeToken: string | null
  xChallengeTokenHash: string | null
  xChallengeExpiresAt: Date | null
}

export type ActiveXChallenge = {
  challengeToken: string
  expiresAt: string
  postTemplate: string
}

export function generateChallengeToken(): string {
  return `EA-${randomBytes(6).toString('hex').toUpperCase()}`
}

export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getChallengeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + X_CHALLENGE_TTL_MINUTES * 60 * 1000)
}

export function getVerificationPostMustStayUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + VERIFICATION_POST_MUST_STAY_LIVE_HOURS * 60 * 60 * 1000)
}

export function buildDefaultVerificationPost(token: string): string {
  return `Prediction markets for clinical trial outcomes.\nVerifying my account on https://endpointarena.com\n\nCode: ${token}`
}

export function extractVerificationChallengeToken(input: string): string | null {
  const match = input.match(/\bEA-[A-F0-9]{12}\b/)
  return match?.[0] ?? null
}

export function getActiveXChallenge(
  challenge: StoredXChallenge,
  now: Date = new Date(),
): ActiveXChallenge | null {
  const challengeToken = challenge.xChallengeToken?.trim() ?? null
  if (!challengeToken || !challenge.xChallengeTokenHash || !challenge.xChallengeExpiresAt) {
    return null
  }

  if (challenge.xChallengeExpiresAt.getTime() <= now.getTime()) {
    return null
  }

  if (hashChallengeToken(challengeToken) !== challenge.xChallengeTokenHash) {
    return null
  }

  return {
    challengeToken,
    expiresAt: challenge.xChallengeExpiresAt.toISOString(),
    postTemplate: buildDefaultVerificationPost(challengeToken),
  }
}

export function parseVerificationPostId(input: string): string {
  const raw = input.trim()
  if (!raw) {
    throw new ValidationError('X post URL or ID is required')
  }

  if (/^\d{6,30}$/.test(raw)) {
    return raw
  }

  const statusMatch = raw.match(/status\/(\d{6,30})/i)
  if (statusMatch?.[1]) {
    return statusMatch[1]
  }

  const queryMatch = raw.match(/[?&]id=(\d{6,30})/i)
  if (queryMatch?.[1]) {
    return queryMatch[1]
  }

  throw new ValidationError('Could not parse an X post ID from the provided URL')
}

function hasReason(error: unknown, reason: string): boolean {
  if (!isAppError(error)) return false
  return error.details?.reason === reason
}

export function isXConnectionExpiredError(error: unknown): boolean {
  if (hasReason(error, X_CONNECTION_EXPIRED_REASON)) return true
  return error instanceof ValidationError
    && error.message === 'Your X connection expired. Reconnect your X account and retry.'
}

function isXCreditsDepletedError(error: unknown): boolean {
  if (hasReason(error, X_CREDITS_DEPLETED_REASON)) return true
  return error instanceof ValidationError
    && error.message === 'X API credits are depleted. Add credits in X Developer Console, then try again.'
}

async function fetchFromXApi<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await response.text().catch(() => '')
    let parsed: XProblemResponse | null = null
    try {
      parsed = JSON.parse(payload) as XProblemResponse
    } catch {
      parsed = null
    }

    if (response.status === 402 && parsed?.title === 'CreditsDepleted') {
      throw new ValidationError('X API credits are depleted. Add credits in X Developer Console, then try again.', {
        details: {
          reason: X_CREDITS_DEPLETED_REASON,
          status: response.status,
        },
      })
    }

    if (response.status === 401) {
      throw new ValidationError('Your X connection expired. Reconnect your X account and retry.', {
        details: {
          reason: X_CONNECTION_EXPIRED_REASON,
          status: response.status,
        },
      })
    }

    throw new ExternalServiceError('Failed to query X API', {
      details: {
        status: response.status,
        body: payload.slice(0, 1000),
      },
    })
  }

  return await response.json() as T
}

async function fetchXProfile(accessToken: string): Promise<{ id: string; username: string | null; name: string | null }> {
  const payload = await fetchFromXApi<XUserMeResponse>(
    'https://api.twitter.com/2/users/me?user.fields=username',
    accessToken,
  )

  const id = payload.data?.id
  if (!id) {
    throw new ExternalServiceError('X account lookup returned no user ID')
  }

  return {
    id,
    username: payload.data?.username ?? null,
    name: payload.data?.name ?? null,
  }
}

export async function fetchVerificationPostById(accessToken: string, postId: string): Promise<VerifiedPost | null> {
  const response = await fetch(
    `https://api.twitter.com/2/tweets/${encodeURIComponent(postId)}?tweet.fields=author_id,created_at,text`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    },
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const payload = await response.text().catch(() => '')
    let parsed: XProblemResponse | null = null
    try {
      parsed = JSON.parse(payload) as XProblemResponse
    } catch {
      parsed = null
    }

    if (response.status === 402 && parsed?.title === 'CreditsDepleted') {
      throw new ValidationError('X API credits are depleted. Add credits in X Developer Console, then try again.', {
        details: {
          reason: X_CREDITS_DEPLETED_REASON,
          status: response.status,
        },
      })
    }

    if (response.status === 401) {
      throw new ValidationError('Your X connection expired. Reconnect your X account and retry.', {
        details: {
          reason: X_CONNECTION_EXPIRED_REASON,
          status: response.status,
        },
      })
    }

    throw new ExternalServiceError('Failed to fetch the verification post from X', {
      details: {
        status: response.status,
        body: payload.slice(0, 1000),
      },
    })
  }

  const payload = await response.json() as XPostResponse
  const post = payload.data
  if (!post?.id || !post?.author_id || !post?.text) {
    return null
  }

  return {
    id: post.id,
    text: post.text,
    authorId: post.author_id,
    createdAt: post.created_at ?? null,
  }
}
