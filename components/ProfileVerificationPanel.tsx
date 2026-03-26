'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'
import { ModelIcon } from '@/components/ModelIcon'

type VerificationStatus = {
  authenticated: boolean
  connected: boolean
  verified: boolean
  requiresReconnect: boolean
  xCheckState: 'ok' | 'requires_reconnect' | 'temporarily_unavailable'
  username: string | null
  mustStayUntil: string | null
  verifiedAt: string | null
  profile: {
    pointsBalance: number
    rank: number
  } | null
}

type ChallengePayload = {
  challengeToken: string
  expiresAt: string
  tweetTemplate: string
}

function normalizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/trials'
  if (!raw.startsWith('/')) return '/trials'
  if (raw.startsWith('//')) return '/trials'
  return raw
}

export function ProfileVerificationPanel() {
  const router = useRouter()
  const [callbackUrl, setCallbackUrl] = useState('/trials')
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusData, setStatusData] = useState<VerificationStatus | null>(null)
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null)
  const [tweetInput, setTweetInput] = useState('')
  const [error, setError] = useState('')
  const [twitterAvailable, setTwitterAvailable] = useState<boolean | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
    const oauthError = params.get('error')
    if (oauthError === 'Callback' || oauthError === 'OAuthCallback') {
      setError('X login consent completed but callback failed. Check OAuth2 client secret and redirect URI in X app settings.')
    } else if (oauthError === 'AccessDenied') {
      setError('X authorization was cancelled. Authorize the app to continue.')
    } else if (oauthError) {
      setError(`Authentication error: ${oauthError}`)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadProviders() {
      try {
        const response = await fetch('/api/auth/providers', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (!cancelled) {
          setTwitterAvailable(Boolean(payload && typeof payload === 'object' && 'twitter' in payload))
        }
      } catch {
        if (!cancelled) setTwitterAvailable(false)
      }
    }

    loadProviders()
    return () => {
      cancelled = true
    }
  }, [])

  const loadStatus = async () => {
    setStatusLoading(true)
    try {
      const response = await fetch('/api/twitter-verification/status', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to load verification status'))
      }
      setStatusData(payload as VerificationStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verification status')
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const intentHref = useMemo(() => {
    if (!challenge?.tweetTemplate) return '#'
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(challenge.tweetTemplate)}`
  }, [challenge?.tweetTemplate])

  const handleConnectX = async () => {
    if (twitterAvailable === false) {
      setError('X login is not configured yet. Add TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET.')
      return
    }

    const session = await getSession()
    if (!session?.user?.id) {
      router.push(`/login?error=TwitterSessionExpired&callbackUrl=${encodeURIComponent(callbackUrl)}`)
      return
    }

    setError('')
    await signIn('twitter', {
      callbackUrl: `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    })
  }

  const handleGenerateChallenge = async () => {
    setError('')
    setIsGenerating(true)
    try {
      const response = await fetch('/api/twitter-verification/challenge', {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to create challenge'))
      }
      if (payload?.alreadyVerified) {
        await loadStatus()
        return
      }
      setChallenge(payload as ChallengePayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create challenge')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleVerifyTweet = async () => {
    if (!challenge?.challengeToken) {
      setError('Create a challenge token first')
      return
    }
    if (!tweetInput.trim()) {
      setError('Paste your tweet URL first')
      return
    }

    setError('')
    setIsVerifying(true)
    try {
      const response = await fetch('/api/twitter-verification/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tweetUrl: tweetInput.trim(),
          challengeToken: challenge.challengeToken,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to verify tweet'))
      }
      const pointsAwarded = typeof payload?.pointsAwarded === 'number' ? payload.pointsAwarded : 0
      if (pointsAwarded > 0) {
        sessionStorage.setItem('ea-points-award', String(pointsAwarded))
      }

      await loadStatus()
      setChallenge(null)
      setTweetInput('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify tweet')
    } finally {
      setIsVerifying(false)
    }
  }

  if (statusLoading && !statusData) {
    return (
      <div className="rounded-sm border border-[#ef6f67]/45 bg-white/80 p-4 text-sm text-[#8a8075]">Loading verification…</div>
    )
  }

  if (statusData?.verified) {
    return (
      <div className="rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 p-4 text-sm text-[#45754f]">
        <p className="font-medium text-[#2f7b40]">Trading unlocked.</p>
        {statusData.requiresReconnect ? (
          <div className="mt-3 rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 p-3 text-[#b94e47]">
            <p>Your X session expired. Reconnect X to continue verification checks.</p>
            <button
              type="button"
              onClick={handleConnectX}
              disabled={twitterAvailable === false}
              className="mt-3 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reconnect X account
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-5 rounded-sm border border-[#ef6f67] bg-[#fffdfa] p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-[#1a1a1a]">Unlock trading</p>
        <p className="mt-1 text-sm text-[#6d645a]">Complete one X verification tweet to unlock Humans vs AI gameplay and earn points.</p>
      </div>

      {error ? (
        <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">{error}</p>
      ) : null}

      {statusData?.requiresReconnect ? (
        <div className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 p-3 text-sm text-[#b94e47]">
          <p>Your X session expired. Reconnect X to continue verification checks.</p>
          <button
            type="button"
            onClick={handleConnectX}
            disabled={twitterAvailable === false}
            className="mt-3 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reconnect X account
          </button>
        </div>
      ) : null}

      {!statusData?.connected ? (
        <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 1</p>
          <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">Connect the X account you want to verify</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d645a]">
            Use the same X account that will post the verification tweet. We only use this connection to confirm the tweet belongs to you.
          </p>
          <button
            type="button"
            onClick={handleConnectX}
            disabled={twitterAvailable === false}
            className="mt-4 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true" className="mr-2 inline-flex h-4 w-4 items-center justify-center">
              <ModelIcon id="grok" className="h-4 w-4" />
            </span>
            {twitterAvailable === false ? 'Login unavailable' : 'Connect X to begin'}
          </button>
        </div>
      ) : null}

      {statusData?.connected ? (
        <div className="space-y-4">
          {!challenge ? (
            <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 2</p>
              <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">Generate your ready-to-post verification tweet</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d645a]">
                We will create the exact tweet text with your unique verification tag. Post it publicly without editing or removing that tag.
              </p>
              {statusData.username ? (
                <p className="mt-2 text-xs text-[#8a8075]">
                  Connected as <span className="font-medium text-[#1a1a1a]">@{statusData.username}</span>
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleGenerateChallenge}
                disabled={isGenerating}
                className="mt-4 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? 'Generating...' : 'Generate verification tweet'}
              </button>
            </div>
          ) : null}

          {challenge ? (
            <div className="space-y-4">
              <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 2</p>
                <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">Post this tweet on X</h3>
                <p className="mt-2 text-sm leading-6 text-[#6d645a]">
                  Open the composer below and publish the tweet as written. Keep the unique verification tag exactly as shown.
                </p>
                <p className="mt-3 rounded-sm bg-[#f8f3ec] p-3 text-xs leading-6 text-[#4d453c]">{challenge.tweetTemplate}</p>
                <a
                  href={intentHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                >
                  Open X composer
                </a>
              </div>

              <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 3</p>
                <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">Paste the live tweet URL to unlock trading</h3>
                <p className="mt-2 text-sm leading-6 text-[#6d645a]">
                  After the tweet is posted, copy its public link and paste it below. Example: https://x.com/username/status/...
                </p>
                <input
                  type="text"
                  value={tweetInput}
                  onChange={(event) => setTweetInput(event.target.value)}
                  placeholder="https://x.com/username/status/..."
                  className="mt-4 w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleVerifyTweet}
                  disabled={isVerifying}
                  className="mt-3 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isVerifying ? 'Verifying...' : 'Verify tweet and unlock'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
