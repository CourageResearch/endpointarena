'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { GradientBorder, PageFrame } from '@/components/site/chrome'
import { STARTER_POINTS } from '@/lib/constants'

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

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('/markets')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || !confirmPassword) return
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        password,
        intent: 'signup',
        redirect: false,
        callbackUrl: `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      })

      if (result?.ok) {
        // Trigger first-account points celebration on profile load.
        sessionStorage.setItem('ea-points-award', String(STARTER_POINTS))
        localStorage.setItem('ea-points-award-pending', String(STARTER_POINTS))
        const destination = resolveDestination(result.url, `/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`)
        const [pathname, queryString = ''] = destination.split('?')
        const params = new URLSearchParams(queryString)
        params.set('signupAward', String(STARTER_POINTS))
        router.push(`${pathname}?${params.toString()}`)
        router.refresh()
      } else if (result?.error === 'CredentialsSignin') {
        setError('An account with that email already exists. Please sign in instead.')
      } else {
        setError(result?.error || 'Failed to create account')
      }
    } catch {
      setError('Failed to create account')
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
                      onChange={(e) => setEmail(e.target.value)}
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
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-sm border border-[#e8ddd0] bg-white px-3 py-2.5 text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
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
                      onChange={(e) => setConfirmPassword(e.target.value)}
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
                    {isLoading ? 'Creating account...' : 'Create account'}
                  </button>
                </form>

                <p className="text-sm text-[#7f7469]">
                  Already have an account?{' '}
                  <a href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="text-[#1a1a1a] underline">
                    Sign in
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
