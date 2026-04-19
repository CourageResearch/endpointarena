'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  isLocalhostHostname,
  normalizeAnalyticsPathname,
  sendAnalyticsEvents,
  shouldTrackPublicAnalyticsPath,
} from '@/lib/analytics-events'

type AnalyticsEvent = {
  type: 'pageview'
  url: string
  referrer?: string
}

const FLUSH_DELAY = 2000
const BATCH_MAX = 10

export function AnalyticsTracker({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const queueRef = useRef<AnalyticsEvent[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLocalhost =
    typeof window !== 'undefined' && isLocalhostHostname(window.location.hostname)

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const events = queueRef.current
    if (events.length === 0) return
    queueRef.current = []

    sendAnalyticsEvents(events)
  }, [])

  const enqueue = useCallback(
    (event: AnalyticsEvent) => {
      queueRef.current.push(event)

      if (queueRef.current.length >= BATCH_MAX) {
        flush()
        return
      }

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, FLUSH_DELAY)
    },
    [flush]
  )

  // Track page views on route change (skip admin pages)
  useEffect(() => {
    if (isLocalhost) return
    if (!shouldTrackPublicAnalyticsPath(pathname)) return
    if (typeof document !== 'undefined' && document.querySelector('[data-endpoint-page-kind="not-found"]')) {
      return
    }
    const normalizedPath = normalizeAnalyticsPathname(pathname)
    if (!normalizedPath) return
    enqueue({
      type: 'pageview',
      url: normalizedPath,
      referrer: typeof document !== 'undefined' ? document.referrer : undefined,
    })
  }, [isLocalhost, pathname, enqueue])

  // Flush on page unload
  useEffect(() => {
    const handleUnload = () => flush()
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      flush()
    }
  }, [flush])

  return <>{children}</>
}
