'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { XInlineMark, XLogoMark } from '@/components/XMark'
import { dispatchAccountBalanceUpdated } from '@/lib/account-balance-events'
import { getApiErrorMessage } from '@/lib/client-api'

type VerificationStatus = {
  authenticated: boolean
  connected: boolean
  verified: boolean
  requiresReconnect: boolean
  xCheckState: 'ok' | 'requires_reconnect' | 'temporarily_unavailable'
  username: string | null
  mustStayUntil: string | null
  verifiedAt: string | null
  challenge: ChallengePayload | null
  profile: {
    cashBalance: number
    rank: number
  } | null
}

type ChallengePayload = {
  challengeToken: string
  expiresAt: string
  postTemplate: string
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
  const [localhostRedirectUrl, setLocalhostRedirectUrl] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusData, setStatusData] = useState<VerificationStatus | null>(null)
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null)
  const [postInput, setPostInput] = useState('')
  const [error, setError] = useState<ReactNode>('')
  const [xAuthAvailable, setXAuthAvailable] = useState<boolean | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
    if (window.location.hostname === 'localhost') {
      const normalizedUrl = new URL(window.location.href)
      normalizedUrl.hostname = '127.0.0.1'
      setLocalhostRedirectUrl(normalizedUrl.toString())
    }
    const oauthError = params.get('error')
    if (oauthError === 'Callback' || oauthError === 'OAuthCallback') {
      setError(
        <>
          <XInlineMark className="mx-0.5" /> login consent completed but callback failed. Check OAuth2 client secret and redirect URI in <XInlineMark className="mx-0.5" /> app settings.
        </>,
      )
    } else if (oauthError === 'AccessDenied') {
      setError(
        <>
          <XInlineMark className="mx-0.5" /> authorization was cancelled. Authorize the app to continue.
        </>,
      )
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
          setXAuthAvailable(Boolean(payload && typeof payload === 'object' && 'twitter' in payload))
        }
      } catch {
        if (!cancelled) setXAuthAvailable(false)
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
      const response = await fetch('/api/x-verification/status', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to load verification status'))
      }
      const nextStatus = payload as VerificationStatus
      setStatusData(nextStatus)
      setChallenge(nextStatus.challenge ?? null)
      if (!nextStatus.challenge) {
        setPostInput('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verification status')
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  useEffect(() => {
    if (statusData?.connected) return
    setChallenge(null)
    setPostInput('')
  }, [statusData?.connected])

  useEffect(() => {
    if (!statusData?.connected || challenge) return
    if (
      error === 'Create a challenge token first'
      || error === 'Create a new challenge token first'
      || error === 'Challenge token expired. Generate a new one.'
      || error === 'Challenge token does not match the active challenge'
      || error === 'X post does not match your current verification code. Generate a new verification post and use that new post URL.'
    ) {
      setError('')
    }
  }, [challenge, error, statusData?.connected])

  const intentHref = useMemo(() => {
    if (!challenge?.postTemplate) return '#'
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(challenge.postTemplate)}`
  }, [challenge?.postTemplate])

  const startXConnection = async () => {
    if (xAuthAvailable === false) {
      setError(
        <>
          <XInlineMark className="mx-0.5" /> login is not configured yet. Add <code className="font-mono text-[0.92em]">X_CLIENT_ID</code> and <code className="font-mono text-[0.92em]">X_CLIENT_SECRET</code>.
        </>,
      )
      return
    }

    const session = await getSession()
    if (!session?.user?.id) {
      router.push(`/login?error=XSessionExpired&callbackUrl=${encodeURIComponent(callbackUrl)}`)
      return
    }

    setError('')
    await signIn('twitter', {
      callbackUrl: `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    })
  }

  useEffect(() => {
    if (xAuthAvailable === null || window.location.hostname === 'localhost') return

    const params = new URLSearchParams(window.location.search)
    if (params.get('connectX') !== '1') return

    params.delete('connectX')
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', nextUrl)

    void startXConnection()
  }, [xAuthAvailable, callbackUrl, router])

  const handleConnectX = async () => {
    if (xAuthAvailable === false) {
      setError(
        <>
          <XInlineMark className="mx-0.5" /> login is not configured yet. Add <code className="font-mono text-[0.92em]">X_CLIENT_ID</code> and <code className="font-mono text-[0.92em]">X_CLIENT_SECRET</code>.
        </>,
      )
      return
    }

    if (window.location.hostname === 'localhost') {
      const normalizedUrl = new URL(window.location.href)
      normalizedUrl.hostname = '127.0.0.1'
      normalizedUrl.searchParams.set('connectX', '1')
      window.location.assign(normalizedUrl.toString())
      return
    }

    await startXConnection()
  }

  const handleGenerateChallenge = async () => {
    setError('')
    setIsGenerating(true)
    try {
      const response = await fetch('/api/x-verification/challenge', {
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

  const handleVerifyPost = async () => {
    if (!challenge?.challengeToken) {
      setError('Create a challenge token first')
      return
    }
    if (!postInput.trim()) {
      setError('Paste your X post URL first')
      return
    }

    setError('')
    setIsVerifying(true)
    try {
      const response = await fetch('/api/x-verification/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postUrl: postInput.trim(),
          challengeToken: challenge.challengeToken,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to verify X post'))
      }

      await loadStatus()
      dispatchAccountBalanceUpdated()
      setChallenge(null)
      setPostInput('')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to verify X post'
      let resetMessage: string | null = null

      if (message.includes('Create a new challenge token first')) {
        resetMessage = 'Your previous verification code is no longer active. Generate a new X verification post and use the new post URL.'
      } else if (message.includes('Challenge token expired')) {
        resetMessage = 'Your verification code expired. Generate a new X verification post, publish it, then paste that new post URL.'
      } else if (
        message.includes('Challenge token does not match')
        || message.includes('X post does not match your current verification code')
      ) {
        resetMessage = 'That X post matches an older verification code. Generate a new X verification post, publish it, then paste the new post URL.'
      }

      if (resetMessage) {
        setChallenge(null)
        setPostInput('')
        await loadStatus()
        setError(resetMessage)
        return
      }

      setError(message)
    } finally {
      setIsVerifying(false)
    }
  }

  if (statusLoading && !statusData) {
    return (
      <div className="rounded-sm border border-[#ef6f67]/45 bg-white/80 p-4 text-sm text-[#8a8075]">Loading verification...</div>
    )
  }

  if (statusData?.verified) {
    return (
      <div className="rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 p-4 text-sm text-[#45754f]">
        <p className="font-medium text-[#2f7b40]">Trading unlocked.</p>
        {statusData.requiresReconnect ? (
          <div className="mt-3 rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 p-3 text-[#b94e47]">
            <p>Your <XInlineMark className="mx-0.5" /> session expired. Reconnect <XInlineMark className="mx-0.5" /> to continue verification checks.</p>
            <button
              type="button"
              onClick={handleConnectX}
              disabled={xAuthAvailable === false}
              className="mt-3 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reconnect <XInlineMark className="mx-1" logoClassName="h-[0.9em] w-[0.9em]" /> account
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-5 rounded-sm border border-[#5DBB63] bg-[#fffdfa] p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-[#1a1a1a]">Verify your account</p>
        <p className="mt-1 text-sm text-[#6d645a]">Connect <XInlineMark className="mx-0.5" /> to claim your $5 cash bonus and start trading.</p>
      </div>

      {error ? (
        <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">{error}</p>
      ) : null}

      {statusData?.requiresReconnect ? (
        <div className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 p-3 text-sm text-[#b94e47]">
          <p>Your <XInlineMark className="mx-0.5" /> session expired. Reconnect <XInlineMark className="mx-0.5" /> to continue verification checks.</p>
          <button
            type="button"
            onClick={handleConnectX}
            disabled={xAuthAvailable === false}
            className="mt-3 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reconnect <XInlineMark className="mx-1" logoClassName="h-[0.9em] w-[0.9em]" /> account
          </button>
        </div>
      ) : null}

      {!statusData?.connected ? (
        <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 1</p>
          <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">
            Connect your <XInlineMark className="mx-0.5" /> account
          </h3>
          {localhostRedirectUrl ? (
            <p className="mt-2 rounded-sm border border-[#eadcc9] bg-[#f8f3ec] px-3 py-2 text-sm text-[#6d645a]">
              Local <XInlineMark className="mx-0.5" /> auth only works from <span className="font-medium text-[#1a1a1a]">127.0.0.1</span>. We&apos;ll switch you there before opening <XInlineMark className="mx-0.5" />.
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleConnectX}
            disabled={xAuthAvailable === false}
            className="mt-4 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true" className="mr-2 inline-flex h-4 w-4 items-center justify-center">
              <XLogoMark className="h-4 w-4" />
            </span>
            {xAuthAvailable === false ? (
              'Login unavailable'
            ) : localhostRedirectUrl ? (
              'Open 127.0.0.1 and continue'
            ) : (
              'Connect account'
            )}
          </button>
        </div>
      ) : null}

      {statusData?.connected ? (
        <div className="space-y-4">
          {!challenge ? (
            <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 2</p>
              <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">
                Generate your ready-to-post <XInlineMark className="mx-0.5" /> verification post
              </h3>
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
                {isGenerating ? 'Generating...' : (
                  <>
                    Generate <XInlineMark className="mx-1" logoClassName="h-[0.9em] w-[0.9em]" /> verification post
                  </>
                )}
              </button>
            </div>
          ) : null}

          {challenge ? (
            <div className="space-y-4">
              <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 2</p>
                <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">Post this on <XInlineMark className="ml-1" /></h3>
                <p className="mt-2 text-sm leading-6 text-[#6d645a]">
                  Open the composer below and publish the post as written. Keep the unique verification tag exactly as shown.
                </p>
                <p className="mt-3 rounded-sm bg-[#f8f3ec] p-3 text-xs leading-6 text-[#4d453c]">{challenge.postTemplate}</p>
                <a
                  href={intentHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                >
                  Open <XInlineMark className="mx-1" logoClassName="h-[0.95em] w-[0.95em]" /> composer
                </a>
              </div>

              <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Step 3</p>
                <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">
                  Paste the live <XInlineMark className="mx-0.5" /> post URL to unlock trading
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#6d645a]">
                  After the post is published, copy its public link and paste it below. Example: https://x.com/username/status/...
                </p>
                <input
                  type="text"
                  value={postInput}
                  onChange={(event) => setPostInput(event.target.value)}
                  placeholder="https://x.com/username/status/..."
                  className="mt-4 w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleVerifyPost}
                  disabled={isVerifying}
                  className="mt-3 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isVerifying ? 'Verifying...' : (
                    <>
                      Verify <XInlineMark className="mx-1" logoClassName="h-[0.9em] w-[0.9em]" /> post and unlock
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
