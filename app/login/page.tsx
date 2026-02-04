'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        redirect: false,
      })

      if (result?.ok) {
        router.push('/admin')
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
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-lg mx-auto mb-4">
            EA
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Sign in to EndpointArena</h1>
          <p className="text-sm text-zinc-500 mt-1">Make predictions on clinical trials</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-zinc-100 text-zinc-900 font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-xs text-zinc-600 text-center mt-6">
          Enter any email to create an account or sign in
        </p>

        <a
          href="/"
          className="block text-center text-sm text-zinc-500 hover:text-zinc-300 mt-4"
        >
          Back to home
        </a>
      </div>
    </div>
  )
}
