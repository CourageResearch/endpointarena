'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function truncateWalletAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function Season4WalletAddressCopy({
  value,
  href,
  className,
  valueClassName,
  linkClassName,
  buttonClassName,
  emptyLabel = 'Not linked yet',
  copyLabel = 'Copy address',
}: {
  value: string | null
  href?: string | null
  className?: string
  valueClassName?: string
  linkClassName?: string
  buttonClassName?: string
  emptyLabel?: string
  copyLabel?: string
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const resetTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  if (!value) {
    return <span className={cn('font-medium text-[#1a1a1a]', valueClassName)}>{emptyLabel}</span>
  }

  const walletAddress = value
  const displayAddress = truncateWalletAddress(walletAddress)

  async function handleCopy() {
    let copied = false

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(walletAddress)
        copied = true
      }
    } catch {
      copied = false
    }

    if (!copied) {
      const fallback = document.createElement('textarea')
      fallback.value = walletAddress
      fallback.setAttribute('readonly', 'true')
      fallback.style.position = 'fixed'
      fallback.style.opacity = '0'
      document.body.appendChild(fallback)
      fallback.focus()
      fallback.select()
      copied = document.execCommand('copy')
      document.body.removeChild(fallback)
    }

    setCopyState(copied ? 'copied' : 'error')

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current)
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle')
    }, 1600)
  }

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2 align-middle', className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={cn('font-medium text-[#1a1a1a]', linkClassName ?? valueClassName)}
          title={value}
        >
          {displayAddress}
        </a>
      ) : (
        <span className={cn('font-medium text-[#1a1a1a]', valueClassName)} title={value}>
          {displayAddress}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5BA5ED]/40',
          buttonClassName,
        )}
        aria-label={copyLabel}
        title={copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Retry copy' : copyLabel}
      >
        {copyState === 'copied' ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.5 8.25 6.25 11l6.25-6.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.25" y="3.25" width="7.5" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M3.25 10.75h-.5A1.5 1.5 0 0 1 1.25 9.25v-6.5a1.5 1.5 0 0 1 1.5-1.5h4.5a1.5 1.5 0 0 1 1.5 1.5v.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </span>
  )
}
