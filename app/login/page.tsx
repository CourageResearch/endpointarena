'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { GradientBorder, PageFrame } from '@/components/site/chrome'

function normalizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/admin'
  if (!raw.startsWith('/')) return '/admin'
  if (raw.startsWith('//')) return '/admin'
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('/admin')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCallbackUrl(normalizeCallbackUrl(params.get('callbackUrl')))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        redirect: false,
        callbackUrl,
      })

      if (result?.ok) {
        router.push(resolveDestination(result.url, callbackUrl))
        router.refresh()
      } else {
        setError('Failed to sign in')
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

                {error ? (
                  <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            </GradientBorder>
          </section>
        </div>
      </main>
    </PageFrame>
  )
}
