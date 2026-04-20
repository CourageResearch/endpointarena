'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth'
import { XLogoMark } from '@/components/XMark'
import { GradientBorder } from '@/components/site/chrome'
import { normalizeCallbackUrl, resolveDestination } from '@/lib/auth/client-navigation'
import { isSettledPrivyOnlySession } from '@/lib/auth/session-state'
import { useAuth } from '@/lib/auth/use-auth'

type PrivyAuthMode = 'login' | 'signup'
type AuthOAuthProvider = 'google' | 'twitter'

const FINALIZE_TIMEOUT_MS = 15000
const PRIVY_ERROR_LINKED_TO_ANOTHER_USER = 'linked_to_another_user'
const PRIVY_ERROR_USER_DOES_NOT_EXIST = 'user_does_not_exist'

type ApiErrorPayload = {
  error?: {
    message?: string
  } | string
  message?: string
}

function GoogleLogoMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}

function createFinalizeTimeoutError(): Error {
  const error = new Error('Account setup is taking longer than expected. Please try again.')
  error.name = 'AbortError'
  return error
}

async function withFinalizeTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timeoutId: number | null = null

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          controller.abort()
          reject(createFinalizeTimeoutError())
        }, FINALIZE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }
}

function getOAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'That sign-in attempt did not complete. Please try again.'
}

function getPrivyErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('privyErrorCode' in error)) {
    return null
  }

  const code = (error as { privyErrorCode?: unknown }).privyErrorCode
  return typeof code === 'string' && code.trim() ? code : null
}

function getEmailAuthErrorMessage(error: unknown, fallbackMessage: string): string {
  const message = error instanceof Error ? error.message.trim() : ''
  const privyErrorCode = getPrivyErrorCode(error)

  if (
    privyErrorCode === PRIVY_ERROR_LINKED_TO_ANOTHER_USER
    || /already linked this email/i.test(message)
  ) {
    return 'This browser is still signed into a different Privy session. Start over, then request a new email code.'
  }

  if (privyErrorCode === PRIVY_ERROR_USER_DOES_NOT_EXIST) {
    return 'No account exists for that email yet. Create one first.'
  }

  return message || fallbackMessage
}

function getApiErrorMessage(payload: ApiErrorPayload | null): string | null {
  const message = payload?.message?.trim()
  if (message) return message

  if (typeof payload?.error === 'string') {
    const errorMessage = payload.error.trim()
    return errorMessage || null
  }

  const nestedMessage = payload?.error?.message?.trim()
  return nestedMessage || null
}

export function PrivyAuthCard({ mode }: { mode: PrivyAuthMode }) {
  const auth = useAuth()
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy()
  const { sendCode, loginWithCode, state: emailFlowState } = useLoginWithEmail()
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth()
  const finalizingRef = useRef(false)
  const finalizedAttemptKeyRef = useRef<string | null>(null)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('/trials')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)

  const disableSignup = mode === 'login'
  const destination = useMemo(() => normalizeCallbackUrl(callbackUrl), [callbackUrl])
  const hasPrivyOnlySession = isSettledPrivyOnlySession(authenticated, auth.status)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
  }, [])

  useEffect(() => {
    if (auth.status !== 'authenticated') return

    window.location.assign(destination)
  }, [auth.status, destination])

  const finalizePrivyLogin = useCallback(async () => {
    if (finalizingRef.current) return

    finalizingRef.current = true
    setIsFinalizing(true)
    setError('')

    try {
      await withFinalizeTimeout(async (signal) => {
        const accessToken = await getAccessToken()
        const headers = new Headers()
        if (accessToken) {
          headers.set('Authorization', `Bearer ${accessToken}`)
        }

        const response = await fetch('/api/auth/privy/sync', {
          method: 'POST',
          credentials: 'include',
          headers,
          signal,
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => null) as ApiErrorPayload | null
          throw new Error(getApiErrorMessage(payload) || 'Failed to finish account setup')
        }
      })

      window.location.assign(resolveDestination(destination, destination))
    } catch (syncError) {
      const message = syncError instanceof Error && syncError.name === 'AbortError'
        ? 'Account setup is taking longer than expected. Please try again.'
        : syncError instanceof Error
          ? syncError.message
          : 'Failed to finish account setup'

      setError(message)
      setIsFinalizing(false)
    } finally {
      finalizingRef.current = false
    }
  }, [destination, getAccessToken])

  const clearPrivyOnlySession = useCallback(async () => {
    finalizingRef.current = false
    finalizedAttemptKeyRef.current = null
    setIsFinalizing(false)

    await Promise.all([
      logout().catch(() => undefined),
      fetch('/api/auth/privy/logout', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => undefined),
    ])
  }, [logout])

  useEffect(() => {
    if (!ready || !hasPrivyOnlySession) return

    const attemptKey = `${user?.id ?? 'privy'}:${destination}`
    if (finalizedAttemptKeyRef.current === attemptKey) return

    finalizedAttemptKeyRef.current = attemptKey
    void finalizePrivyLogin()
  }, [destination, finalizePrivyLogin, hasPrivyOnlySession, ready, user?.id])

  const handleRetrySetup = () => {
    finalizedAttemptKeyRef.current = null
    void finalizePrivyLogin()
  }

  const handleStartOver = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      await clearPrivyOnlySession()
      setCode('')
      setStep('email')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSendCode = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!email.trim()) return

    setIsSubmitting(true)
    setError('')

    try {
      if (hasPrivyOnlySession) {
        await clearPrivyOnlySession()
      }

      await sendCode({
        email: email.trim(),
        disableSignup,
      })
      setStep('code')
    } catch (sendError) {
      setError(getEmailAuthErrorMessage(sendError, 'Failed to send the sign-in code'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifyCode = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!code.trim()) return

    setIsSubmitting(true)
    setError('')

    try {
      if (hasPrivyOnlySession && !isFinalizing) {
        setError('This code was requested while another Privy session was active. Start over and request a new email code.')
        return
      }

      await loginWithCode({ code: code.trim() })
    } catch (verifyError) {
      setError(getEmailAuthErrorMessage(verifyError, 'Failed to verify the code'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOAuthLogin = async (provider: AuthOAuthProvider) => {
    setError('')

    try {
      if (hasPrivyOnlySession) {
        await clearPrivyOnlySession()
      }

      await initOAuth({
        provider,
        disableSignup,
      })
    } catch (oauthError) {
      setError(getOAuthErrorMessage(oauthError))
    }
  }

  const heading = mode === 'login' ? 'Sign in' : 'Create account'
  const primaryActionLabel = step === 'email'
    ? (mode === 'login' ? 'Email me a code' : 'Create account with email')
    : (mode === 'login' ? 'Verify and sign in' : 'Verify and create account')
  const isBusy = isSubmitting || isFinalizing || oauthLoading
  const flowDescription = emailFlowState.status === 'awaiting-code-input'
    ? `We sent a 6-digit code to ${email.trim()}.`
    : null

  return (
    <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-5 sm:p-7">
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-[#1a1a1a]">{heading}</h1>
          <p className="mt-2 text-sm text-[#7f7469]">
            Wallet setup continues inside the app after sign-in, so this step won&apos;t block on embedded wallet provisioning.
          </p>
        </div>

        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => void handleOAuthLogin('google')}
            disabled={isBusy}
            aria-label="Continue with Google"
            className="inline-flex items-center justify-center rounded-sm border border-[#e8ddd0] bg-white px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f8f3ec] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>Continue with</span>
            <GoogleLogoMark className="ml-2 h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleOAuthLogin('twitter')}
            disabled={isBusy}
            aria-label="Continue with X"
            className="inline-flex items-center justify-center rounded-sm border border-[#e8ddd0] bg-white px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f8f3ec] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>Continue with</span>
            <XLogoMark className="ml-2 h-4 w-4" />
          </button>
        </div>

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#eadcc9]" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-[#fffdfa] px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">or</span>
          </div>
        </div>

        <form onSubmit={step === 'email' ? handleSendCode : handleVerifyCode} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => {
                if (error) setError('')
                setEmail(event.target.value)
              }}
              className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
              disabled={isBusy || step === 'code'}
              required
            />
          </div>

          {step === 'code' ? (
            <div>
              <label
                htmlFor="code"
                className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]"
              >
                Verification Code
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(event) => {
                  if (error) setError('')
                  setCode(event.target.value)
                }}
                className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                disabled={isBusy}
                required
              />
            </div>
          ) : null}

          {flowDescription ? (
            <p className="text-sm text-[#7f7469]">{flowDescription}</p>
          ) : null}

          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFinalizing ? 'Finishing setup...' : primaryActionLabel}
          </button>

          {step === 'code' ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setCode('')
                setStep('email')
              }}
              className="w-full text-sm text-[#7f7469] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Use a different email
            </button>
          ) : null}
        </form>

        <p className="text-sm text-[#7f7469]">
          {mode === 'login' ? 'Need a new account?' : 'Already have an account?'}{' '}
          <a
            href={`${mode === 'login' ? '/signup' : '/login'}?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="text-[#1a1a1a] underline"
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </a>
        </p>

        {error ? (
          <div className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
            <p>{error}</p>
            {authenticated ? (
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleRetrySetup}
                  disabled={isBusy}
                  className="text-sm font-medium text-[#1a1a1a] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Finish current sign-in
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartOver()}
                  disabled={isBusy}
                  className="text-sm font-medium text-[#1a1a1a] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Start over
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </GradientBorder>
  )
}
