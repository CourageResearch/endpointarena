'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  isLocalhostHostname,
  normalizeAnalyticsPathname,
  sendAnalyticsEvents,
  shouldTrackPublicAnalyticsPath,
} from '@/lib/analytics-events'

export function NotFoundAnalyticsTracker() {
  const pathname = usePathname()
  const lastTrackedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLocalhostHostname(window.location.hostname)) return
    if (!shouldTrackPublicAnalyticsPath(pathname)) return

    const normalizedPath = normalizeAnalyticsPathname(pathname)
    if (!normalizedPath) return
    if (lastTrackedPathRef.current === normalizedPath) return

    lastTrackedPathRef.current = normalizedPath
    sendAnalyticsEvents([{
      type: 'not_found',
      url: normalizedPath,
      referrer: typeof document !== 'undefined' ? document.referrer : undefined,
    }])
  }, [pathname])

  return <div data-endpoint-page-kind="not-found" hidden />
}
