'use client'

import { useEffect, useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'
import type { TrialsBrowseResponse } from '@/lib/trials-browse-shared'

async function requestTrialsBrowseData(options: {
  includeResolved?: boolean
} = {}): Promise<TrialsBrowseResponse> {
  const params = new URLSearchParams()
  if (options.includeResolved) {
    params.set('includeResolved', '1')
  }
  const query = params.toString()
  const url = query ? `/api/trials/browse?${query}` : '/api/trials/browse'
  const response = await fetch(url, { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Failed to load trials'))
  }
  return payload as TrialsBrowseResponse
}

export function useTrialsBrowseData(
  initialData: TrialsBrowseResponse | null = null,
  options: {
    includeResolved?: boolean
  } = {},
) {
  const [data, setData] = useState<TrialsBrowseResponse | null>(initialData)
  const [loading, setLoading] = useState(initialData == null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    async function run(initial: boolean) {
      if (initial) setLoading(true)
      else setRefreshing(true)

      try {
        const next = await requestTrialsBrowseData(options)
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

    void run(initialData == null)
    const timer = window.setInterval(() => {
      void run(false)
    }, 60_000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [initialData, options.includeResolved])

  const reload = async () => {
    setRefreshing(true)
    try {
      const next = await requestTrialsBrowseData(options)
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
