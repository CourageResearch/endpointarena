'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth'
import { GradientBorder } from '@/components/site/chrome'
import { normalizeCallbackUrl, resolveDestination } from '@/lib/auth/client-navigation'
import { useAuth } from '@/lib/auth/use-auth'

type PrivyAuthMode = 'login' | 'signup'

function getOAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'That sign-in attempt did not complete. Please try again.'
}

export function PrivyAuthCard({ mode }: { mode: PrivyAuthMode }) {
  const auth = useAuth()
  const { ready, authenticated, getAccessToken } = usePrivy()
  const { sendCode, loginWithCode, state: emailFlowState } = useLoginWithEmail()
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('/trials')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)

  const disableSignup = mode === 'login'
  const destination = useMemo(() => normalizeCallbackUrl(callbackUrl), [callbackUrl])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
  }, [])

  useEffect(() => {
    if (auth.status !== 'authenticated' || isFinalizing) return

    window.location.assign(destination)
  }, [auth.status, destination, isFinalizing])

  const finalizePrivyLogin = useCallback(async () => {
    if (isFinalizing) return

    setIsFinalizing(true)
    setError('')

    try {
      const accessToken = await getAccessToken()
      const headers = new Headers()
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }

      const response = await fetch('/api/auth/privy/sync', {
        method: 'POST',
        credentials: 'include',
        headers,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
        throw new Error(payload.message || payload.error || 'Failed to finish account setup')
      }

      window.location.assign(resolveDestination(destination, destination))
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Failed to finish account setup')
      setIsFinalizing(false)
    }
  }, [destination, getAccessToken, isFinalizing])

  useEffect(() => {
    if (!ready || !authenticated || auth.status === 'authenticated') return
    void finalizePrivyLogin()
  }, [auth.status, authenticated, finalizePrivyLogin, ready])

  const handleSendCode = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!email.trim()) return

    setIsSubmitting(true)
    setError('')

    try {
      await sendCode({
        email: email.trim(),
        disableSignup,
      })
      setStep('code')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send the sign-in code')
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
      await loginWithCode({ code: code.trim() })
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Failed to verify the code')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOAuthLogin = async (provider: 'google') => {
    setError('')

    try {
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
            className="rounded-sm border border-[#e8ddd0] bg-white px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f8f3ec] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Google
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
          <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
            {error}
          </p>
        ) : null}
      </div>
    </GradientBorder>
  )
}
