'use client'

import { useEffect, useRef } from 'react'

type ErrorWithDigest = Error & {
  digest?: string
}

async function reportCrash(error: ErrorWithDigest) {
  try {
    await fetch('/api/crash-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      keepalive: true,
      body: JSON.stringify({
        source: 'app-error',
        digest: error.digest ?? null,
        name: error.name ?? 'Error',
        message: error.message ?? 'Application error',
        stack: error.stack ?? null,
        url: window.location.href,
        path: window.location.pathname,
        userAgent: navigator.userAgent,
      }),
    })
  } catch {
    // Ignore logging failures in client error boundary.
  }
}

export default function Error({
  error,
  reset,
}: {
  error: ErrorWithDigest
  reset: () => void
}) {
  const reportedRef = useRef(false)

  useEffect(() => {
    if (reportedRef.current) return
    reportedRef.current = true
    void reportCrash(error)
  }, [error])

  return (
    <div className="min-h-screen bg-[#F5F2ED] px-4 py-12 text-[#1a1a1a]">
      <div className="mx-auto max-w-xl rounded-sm border border-[#e8ddd0] bg-white/90 p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">Application Error</p>
        <h1 className="mt-2 text-xl font-semibold">Something went wrong.</h1>
        <p className="mt-2 text-sm text-[#6d645a]">
          We logged this crash so it can be investigated.
          {error.digest ? ` Reference digest: ${error.digest}.` : ''}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 inline-flex items-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
