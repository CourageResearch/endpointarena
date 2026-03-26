'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

type AnalyticsEvent = {
  type: 'pageview'
  url: string
  referrer?: string
}

const FLUSH_DELAY = 2000
const BATCH_MAX = 10

function isLocalhostHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

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

    const payload = JSON.stringify({ events })

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics', payload)
    } else {
      fetch('/api/analytics', {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {})
    }
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
    if (pathname.startsWith('/admin')) return
    enqueue({
      type: 'pageview',
      url: pathname,
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
