'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { XInlineMark, XLogoMark } from '@/components/XMark'
import { getApiErrorMessage } from '@/lib/client-api'

type ConnectionStatus = {
  authenticated: boolean
  connected: boolean
  requiresReconnect: boolean
  xCheckState: 'ok' | 'requires_reconnect' | 'temporarily_unavailable'
  username: string | null
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
  const [statusData, setStatusData] = useState<ConnectionStatus | null>(null)
  const [error, setError] = useState<ReactNode>('')
  const [xAuthAvailable, setXAuthAvailable] = useState<boolean | null>(null)

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

    void loadProviders()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      setStatusLoading(true)
      try {
        const response = await fetch('/api/x-connection/status', {
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, 'Failed to load X connection status'))
        }
        if (!cancelled) {
          setStatusData(payload as ConnectionStatus)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load X connection status')
        }
      } finally {
        if (!cancelled) {
          setStatusLoading(false)
        }
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
    }
  }, [])

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

  if (statusLoading && !statusData) {
    return (
      <div className="rounded-sm border border-[#ef6f67]/45 bg-white/80 p-4 text-sm text-[#8a8075]">Loading X connection...</div>
    )
  }

  return (
    <div className="space-y-5 rounded-sm border border-[#5DBB63] bg-[#fffdfa] p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-[#1a1a1a]">X Connection</p>
        <p className="mt-1 text-sm text-[#6d645a]">Link <XInlineMark className="mx-0.5" /> to show your connected account on your profile. Trading does not require an X connection.</p>
      </div>

      {error ? (
        <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">{error}</p>
      ) : null}

      {statusData?.xCheckState === 'temporarily_unavailable' ? (
        <div className="rounded-sm border border-[#eadcc9] bg-[#f8f3ec] p-3 text-sm text-[#6d645a]">
          <p>We could not refresh your current <XInlineMark className="mx-0.5" /> connection status right now. Your profile and trading are still available.</p>
        </div>
      ) : null}

      {statusData?.requiresReconnect ? (
        <div className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 p-3 text-sm text-[#b94e47]">
          <p>Your <XInlineMark className="mx-0.5" /> session expired. Reconnect your account to keep your profile link active.</p>
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
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Link Account</p>
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
        <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Linked Account</p>
          <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">
            {statusData.username ? (
              <>Connected as <span className="font-medium">@{statusData.username}</span></>
            ) : (
              <>Your <XInlineMark className="mx-0.5" /> account is linked</>
            )}
          </h3>
          <p className="mt-2 text-sm text-[#6d645a]">
            You can keep this link as-is or reconnect if you want to refresh the session or switch accounts.
          </p>
          <button
            type="button"
            onClick={handleConnectX}
            disabled={xAuthAvailable === false}
            className="mt-4 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statusData.requiresReconnect ? 'Reconnect account' : 'Reconnect or switch account'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
