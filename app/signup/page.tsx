'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { GradientBorder, PageFrame } from '@/components/site/chrome'
import { STARTER_POINTS } from '@/lib/constants'
import { buildProfileCallbackUrl, ensureAuthGeo, normalizeCallbackUrl, resolveDestination } from '@/lib/auth/client-navigation'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('/markets')
  const [geo, setGeo] = useState({ country: '', state: '' })
  const signupsClosed = errorCode === 'SIGNUPS_CLOSED'

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
    const authError = params.get('error')
    if (authError === 'SIGNUPS_CLOSED') {
      setError('Signups are full. Endpoint Arena is currently full.')
      setErrorCode('SIGNUPS_CLOSED')
    }

    ensureAuthGeo({ country: '', state: '' }).then((detectedGeo) => {
      if (!cancelled && (detectedGeo.country || detectedGeo.state)) {
        setGeo(detectedGeo)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (signupsClosed) return
    if (!email || !password || !confirmPassword) return
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setErrorCode('')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setErrorCode('')
      return
    }

    setIsLoading(true)
    setError('')
    setErrorCode('')

    try {
      const detectedGeo = await ensureAuthGeo(geo)
      if (!geo.country && !geo.state && (detectedGeo.country || detectedGeo.state)) {
        setGeo(detectedGeo)
      }

      const profileCallbackUrl = buildProfileCallbackUrl(callbackUrl)

      const result = await signIn('credentials', {
        email,
        password,
        intent: 'signup',
        country: detectedGeo.country,
        state: detectedGeo.state,
        region: detectedGeo.state,
        redirect: false,
        callbackUrl: profileCallbackUrl,
      })

      if (result?.ok) {
        // Trigger first-account points celebration on profile load.
        sessionStorage.setItem('ea-points-award', String(STARTER_POINTS))
        localStorage.setItem('ea-points-award-pending', String(STARTER_POINTS))
        const destination = resolveDestination(result.url, profileCallbackUrl)
        const [pathname, queryString = ''] = destination.split('?')
        const params = new URLSearchParams(queryString)
        params.set('signupAward', String(STARTER_POINTS))
        router.push(`${pathname}?${params.toString()}`)
        router.refresh()
      } else if (result?.error === 'SIGNUPS_CLOSED') {
        setError('Signups are full. Endpoint Arena is currently full.')
        setErrorCode('SIGNUPS_CLOSED')
      } else if (result?.error === 'CredentialsSignin') {
        setError('An account with that email already exists. Please sign in instead.')
        setErrorCode('')
      } else if (result?.error === 'AUTH_UNAVAILABLE') {
        setError('Account creation is temporarily unavailable. Please try again shortly.')
        setErrorCode('')
      } else {
        setError('Failed to create account. Please try again.')
        setErrorCode('')
      }
    } catch {
      setError('Failed to create account')
      setErrorCode('')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
        <div className="mx-auto max-w-xl">
          <section>
            <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-5 sm:p-7">
              <div className="space-y-5">
                <div>
                  <h1 className="text-xl font-semibold text-[#1a1a1a]">Create account</h1>
                  <p className="mt-1 text-sm text-[#7f7469]">
                    Create your account with email and password.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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
                      onChange={(e) => {
                        if (!signupsClosed && error) setError('')
                        if (!signupsClosed && errorCode) setErrorCode('')
                        setEmail(e.target.value)
                      }}
                      className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                      disabled={signupsClosed}
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="password"
                      className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]"
                    >
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => {
                        if (!signupsClosed && error) setError('')
                        if (!signupsClosed && errorCode) setErrorCode('')
                        setPassword(e.target.value)
                      }}
                      className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                      disabled={signupsClosed}
                      minLength={8}
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]"
                    >
                      Confirm Password
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={(e) => {
                        if (!signupsClosed && error) setError('')
                        if (!signupsClosed && errorCode) setErrorCode('')
                        setConfirmPassword(e.target.value)
                      }}
                      className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                      disabled={signupsClosed}
                      minLength={8}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || signupsClosed}
                    className="w-full rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {signupsClosed ? 'Signups full' : isLoading ? 'Creating account...' : 'Create account'}
                  </button>
                </form>

                <p className="text-sm text-[#7f7469]">
                  Already have an account?{' '}
                  <a href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="text-[#1a1a1a] underline">
                    Sign in
                  </a>
                </p>

                {error ? (
                  <div className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
                    <p>{error}</p>
                    {errorCode === 'SIGNUPS_CLOSED' ? (
                      <p className="mt-2">
                        Join the waitlist at{' '}
                        <a
                          href="https://endpointarena.com/waitlist"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline"
                        >
                          endpointarena.com/waitlist
                        </a>
                        {' '}or check back later.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </GradientBorder>
          </section>
        </div>
      </main>
    </PageFrame>
  )
}
