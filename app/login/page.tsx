'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { GradientBorder, PageFrame } from '@/components/site/chrome'
import { detectGeoFromClient } from '@/lib/client-country'

function normalizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/markets'
  if (!raw.startsWith('/')) return '/markets'
  if (raw.startsWith('//')) return '/markets'
  return raw
}

function resolveDestination(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback
  try {
    const parsed = new URL(url, window.location.origin)
    return normalizeCallbackUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`)
  } catch {
    return fallback
  }
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('/markets')
  const [geo, setGeo] = useState({ country: '', state: '' })

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
    const oauthError = params.get('error')
    if (oauthError === 'TwitterAccountAlreadyLinked') {
      setError('That X account is already linked to another Endpoint Arena account.')
    } else if (oauthError === 'TwitterConnectionFailed') {
      setError('Failed to connect your X account. Please try again.')
    } else if (oauthError === 'Callback' || oauthError === 'OAuthCallback') {
      setError('X login reached consent but failed on callback. This usually means OAuth client secret or redirect settings are incorrect in X Developer Portal.')
    } else if (oauthError === 'OAuthSignin') {
      setError('Could not start X login. Check OAuth app configuration and try again.')
    } else if (oauthError === 'AccessDenied') {
      setError('X authorization was denied. Please authorize the app to continue.')
    } else if (oauthError) {
      setError(`Authentication error: ${oauthError}`)
    }

    if (oauthError) {
      params.delete('error')
      const nextQuery = params.toString()
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    detectGeoFromClient().then((detectedGeo) => {
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
    if (!email || !password) return

    setIsLoading(true)
    setError('')

    try {
      const detectedGeo = geo.country || geo.state ? geo : await detectGeoFromClient()
      if (!geo.country && !geo.state && (detectedGeo.country || detectedGeo.state)) {
        setGeo(detectedGeo)
      }

      const result = await signIn('credentials', {
        email,
        password,
        intent: 'signin',
        country: detectedGeo.country,
        state: detectedGeo.state,
        redirect: false,
        callbackUrl: `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      })

      if (result?.ok) {
        router.push(resolveDestination(result.url, `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`))
        router.refresh()
      } else {
        if (result?.error === 'CredentialsSignin') {
          setError('Invalid email or password.')
        } else if (result?.error === 'AUTH_UNAVAILABLE') {
          setError('Sign in is temporarily unavailable. Please try again shortly.')
        } else {
          setError('Failed to sign in. Please try again.')
        }
      }
    } catch {
      setError('Failed to sign in')
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
                  <h1 className="text-xl font-semibold text-[#1a1a1a]">Sign in</h1>
                  <p className="mt-1 text-sm text-[#7f7469]">
                    Sign in with your email and password.
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
                        if (error) setError('')
                        setEmail(e.target.value)
                      }}
                      className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
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
                        if (error) setError('')
                        setPassword(e.target.value)
                      }}
                      className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                      minLength={8}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading ? 'Signing in...' : 'Sign in'}
                  </button>
                </form>

                <p className="text-sm text-[#7f7469]">
                  New to Endpoint Arena?{' '}
                  <a href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="text-[#1a1a1a] underline">
                    Create an account
                  </a>
                </p>

                {error ? (
                  <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
                    {error}
                  </p>
                ) : null}
              </div>
            </GradientBorder>
          </section>
        </div>
      </main>
    </PageFrame>
  )
}
