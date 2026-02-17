'use client'

import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

type AnalyticsEvent = {
  type: 'pageview' | 'click'
  url: string
  referrer?: string
  elementId?: string
}

type AnalyticsContextValue = {
  trackClick: (elementId: string) => void
}

const AnalyticsContext = createContext<AnalyticsContextValue>({
  trackClick: () => {},
})

export function useAnalytics() {
  return useContext(AnalyticsContext)
}

const FLUSH_DELAY = 2000
const BATCH_MAX = 10

export function AnalyticsTracker({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const queueRef = useRef<AnalyticsEvent[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Track page views on route change
  useEffect(() => {
    enqueue({
      type: 'pageview',
      url: pathname,
      referrer: typeof document !== 'undefined' ? document.referrer : undefined,
    })
  }, [pathname, enqueue])

  // Flush on page unload
  useEffect(() => {
    const handleUnload = () => flush()
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      flush()
    }
  }, [flush])

  const trackClick = useCallback(
    (elementId: string) => {
      enqueue({
        type: 'click',
        url: pathname,
        elementId,
      })
    },
    [pathname, enqueue]
  )

  return (
    <AnalyticsContext.Provider value={{ trackClick }}>
      {children}
    </AnalyticsContext.Provider>
  )
}
