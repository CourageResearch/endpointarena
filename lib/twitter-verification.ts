import { createHash, randomBytes } from 'crypto'
import { ExternalServiceError, ValidationError } from '@/lib/errors'

export const TWITTER_CHALLENGE_TTL_MINUTES = 10
export const TWEET_MUST_STAY_LIVE_HOURS = 24

type TwitterUserMeResponse = {
  data?: {
    id?: string
    username?: string
    name?: string
  }
}

type TwitterTweetResponse = {
  data?: {
    id?: string
    text?: string
    author_id?: string
    created_at?: string
  }
}

type TwitterProblemResponse = {
  title?: string
  detail?: string
  type?: string
}

export type VerifiedTweet = {
  id: string
  text: string
  authorId: string
  createdAt: string | null
}

export function generateChallengeToken(): string {
  return `EA-${randomBytes(6).toString('hex').toUpperCase()}`
}

export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getChallengeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TWITTER_CHALLENGE_TTL_MINUTES * 60 * 1000)
}

export function getTweetMustStayUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + TWEET_MUST_STAY_LIVE_HOURS * 60 * 60 * 1000)
}

export function buildDefaultVerificationTweet(token: string): string {
  return `I just joined Humans vs AI on EndpointArena. I'm making my calls against the models. #EndpointArena #HumansVsAI ${token}`
}

export function parseTweetId(input: string): string {
  const raw = input.trim()
  if (!raw) {
    throw new ValidationError('Tweet URL or ID is required')
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

  throw new ValidationError('Could not parse tweet ID from the provided URL')
}

async function fetchFromTwitter<T>(
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
    let parsed: TwitterProblemResponse | null = null
    try {
      parsed = JSON.parse(payload) as TwitterProblemResponse
    } catch {
      parsed = null
    }

    if (response.status === 402 && parsed?.title === 'CreditsDepleted') {
      throw new ValidationError('X API credits are depleted. Add credits in X Developer Console, then try again.')
    }

    if (response.status === 401) {
      throw new ValidationError('Your X connection expired. Reconnect your X account and retry.')
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

export async function fetchTwitterMe(accessToken: string): Promise<{ id: string; username: string | null; name: string | null }> {
  const payload = await fetchFromTwitter<TwitterUserMeResponse>(
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

export async function fetchTweetById(accessToken: string, tweetId: string): Promise<VerifiedTweet | null> {
  const response = await fetch(
    `https://api.twitter.com/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=author_id,created_at,text`,
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
    let parsed: TwitterProblemResponse | null = null
    try {
      parsed = JSON.parse(payload) as TwitterProblemResponse
    } catch {
      parsed = null
    }

    if (response.status === 402 && parsed?.title === 'CreditsDepleted') {
      throw new ValidationError('X API credits are depleted. Add credits in X Developer Console, then try again.')
    }

    if (response.status === 401) {
      throw new ValidationError('Your X connection expired. Reconnect your X account and retry.')
    }

    throw new ExternalServiceError('Failed to fetch tweet from X', {
      details: {
        status: response.status,
        body: payload.slice(0, 1000),
      },
    })
  }

  const payload = await response.json() as TwitterTweetResponse
  const tweet = payload.data
  if (!tweet?.id || !tweet?.author_id || !tweet?.text) {
    return null
  }

  return {
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    createdAt: tweet.created_at ?? null,
  }
}
