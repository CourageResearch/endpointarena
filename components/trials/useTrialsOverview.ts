'use client'

import { useEffect, useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

async function requestTrialsOverview(
  marketId?: string | null,
  options: {
    includeAccounts?: boolean
    includeEquityHistory?: boolean
    includeResolved?: boolean
    includeRecentRuns?: boolean
  } = {},
): Promise<OverviewResponse> {
  const params = new URLSearchParams()
  if (marketId) {
    params.set('marketId', marketId)
  }
  if (options.includeResolved) {
    params.set('includeResolved', '1')
  }
  if (options.includeAccounts === false) {
    params.set('includeAccounts', '0')
  }
  if (options.includeEquityHistory === false) {
    params.set('includeEquityHistory', '0')
  }
  if (options.includeRecentRuns === false) {
    params.set('includeRecentRuns', '0')
  }
  const query = params.toString()
  const url = query ? `/api/trials/overview?${query}` : '/api/trials/overview'
  const response = await fetch(url, { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Failed to load trials'))
  }
  return payload as OverviewResponse
}

export function useTrialsOverview(
  initialData: OverviewResponse | null = null,
  marketId?: string | null,
  options: {
    includeAccounts?: boolean
    includeEquityHistory?: boolean
    includeResolved?: boolean
    autoRefresh?: boolean
    includeRecentRuns?: boolean
  } = {},
) {
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
        const next = await requestTrialsOverview(marketId, options)
        if (disposed) return
        setData(next)
        setError(null)
      } catch (err) {
        if (disposed) return
        setError(err instanceof Error ? err.message : 'Failed to load trials')
      } finally {
        if (disposed) return
        if (initial) setLoading(false)
        else setRefreshing(false)
      }
    }

    const shouldAutoRefresh = options.autoRefresh !== false

    if (initialData == null) {
      void run(true)
    } else if (shouldAutoRefresh) {
      void run(false)
    }

    const timer = shouldAutoRefresh
      ? window.setInterval(() => {
          void run(false)
        }, 60_000)
      : null

    return () => {
      disposed = true
      if (timer !== null) {
        window.clearInterval(timer)
      }
    }
  }, [
    initialData,
    marketId,
    options.autoRefresh,
    options.includeAccounts,
    options.includeEquityHistory,
    options.includeRecentRuns,
    options.includeResolved,
  ])

  const reload = async () => {
    setRefreshing(true)
    try {
      const next = await requestTrialsOverview(marketId, options)
      setData(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trials')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  const generatedAt = useMemo(() => data?.generatedAt ?? null, [data?.generatedAt])

  return { data, loading, refreshing, error, reload, generatedAt }
}
