'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import type { AppSession } from '@/lib/auth/types'

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim())

type MinimalPrivyState = {
  ready: boolean
  authenticated: boolean
  getAccessToken: () => Promise<string | null>
  logout: () => Promise<void>
}

function useOptionalPrivy(): MinimalPrivyState {
  if (!PRIVY_ENABLED) {
    return {
      ready: true,
      authenticated: false,
      getAccessToken: async () => null,
      logout: async () => {},
    }
  }

  const privy = usePrivy()
  return {
    ready: privy.ready,
    authenticated: privy.authenticated,
    getAccessToken: privy.getAccessToken,
    logout: privy.logout,
  }
}

export function useAuth() {
  const privy = useOptionalPrivy()
  const [session, setSession] = useState<AppSession | null>(null)
  const [hydrated, setHydrated] = useState(!PRIVY_ENABLED)

  const fetchWithAuth = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)

    if (privy.authenticated) {
      const accessToken = await privy.getAccessToken()
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }
    }

    return fetch(input, {
      ...init,
      credentials: init.credentials ?? 'include',
      headers,
    })
  }, [privy.authenticated, privy.getAccessToken])

  useEffect(() => {
    if (!PRIVY_ENABLED) {
      setSession(null)
      setHydrated(true)
      return
    }

    if (!privy.ready) return

    if (!privy.authenticated) {
      setSession(null)
      setHydrated(true)
      return
    }

    let cancelled = false

    const loadSession = async () => {
      try {
        const response = await fetchWithAuth('/api/auth/me', {
          cache: 'no-store',
        })

        if (!response.ok) {
          if (!cancelled) {
            setSession(null)
          }
          return
        }

        const payload = await response.json() as AppSession
        if (!cancelled) {
          setSession(payload)
        }
      } catch {
        if (!cancelled) {
          setSession(null)
        }
      } finally {
        if (!cancelled) {
          setHydrated(true)
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [fetchWithAuth, privy.authenticated, privy.ready])

  const status: 'loading' | 'authenticated' | 'unauthenticated' = (() => {
    if (!hydrated) return 'loading'
    if (PRIVY_ENABLED && !privy.ready) return 'loading'
    return session ? 'authenticated' : 'unauthenticated'
  })()

  const signOut = useCallback(async (callbackUrl = '/') => {
    await privy.logout()
    await fetch('/api/auth/privy/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined)
    window.location.assign(callbackUrl)
  }, [privy.logout])

  return {
    data: session,
    status,
    fetchWithAuth,
    signOut,
  }
}
