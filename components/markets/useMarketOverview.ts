'use client'

import { useEffect, useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

async function requestMarketOverview(): Promise<OverviewResponse> {
  const response = await fetch('/api/markets/overview', { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Failed to load markets'))
  }
  return payload as OverviewResponse
}

export function useMarketOverview(initialData: OverviewResponse | null = null) {
  const [data, setData] = useState<OverviewResponse | null>(initialData)
  const [loading, setLoading] = useState(initialData == null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    async function run(initial: boolean) {
      if (initial) setLoading(true)
      else setRefreshing(true)

      try {
        const next = await requestMarketOverview()
        if (disposed) return
        setData(next)
        setError(null)
      } catch (err) {
        if (disposed) return
        setError(err instanceof Error ? err.message : 'Failed to load markets')
      } finally {
        if (disposed) return
        if (initial) setLoading(false)
        else setRefreshing(false)
      }
    }

    void run(initialData == null)
    const timer = window.setInterval(() => {
      void run(false)
    }, 60_000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [initialData])

  const reload = async () => {
    setRefreshing(true)
    try {
      const next = await requestMarketOverview()
      setData(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load markets')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  const generatedAt = useMemo(() => data?.generatedAt ?? null, [data?.generatedAt])

  return { data, loading, refreshing, error, reload, generatedAt }
}
