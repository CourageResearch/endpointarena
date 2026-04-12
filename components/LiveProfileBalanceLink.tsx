'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ACCOUNT_BALANCE_UPDATED_EVENT } from '@/lib/account-balance-events'
import { cn } from '@/lib/utils'

type LiveProfileBalanceLinkProps = {
  className: string
  profileLabel?: string | null
  onClick?: () => void
}

type BalanceResponse = {
  cashBalance: number
}

function formatNavbarBalance(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  const safeValue = Math.max(0, value)
  const showCents = !Number.isInteger(safeValue)

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(safeValue)
}

export function LiveProfileBalanceLink({
  className,
  profileLabel = null,
  onClick,
}: LiveProfileBalanceLinkProps) {
  const pathname = usePathname()
  const [cashBalance, setCashBalance] = useState<number | null>(null)
  const [hasLoadedBalance, setHasLoadedBalance] = useState(false)
  const mountedRef = useRef(true)

  const refreshBalance = useEffectEvent(async () => {
    try {
      const response = await fetch('/api/account/balance', {
        cache: 'no-store',
      })

      if (!mountedRef.current) return

      if (!response.ok) {
        if (response.status === 401) {
          setCashBalance(null)
        }
        setHasLoadedBalance(true)
        return
      }

      const payload = await response.json().catch(() => ({})) as Partial<BalanceResponse>
      if (!mountedRef.current) return

      setCashBalance(typeof payload.cashBalance === 'number' ? payload.cashBalance : null)
      setHasLoadedBalance(true)
    } catch {
      if (mountedRef.current) {
        setHasLoadedBalance(true)
      }
      // Keep the last known balance if the lightweight navbar refresh fails.
    }
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void refreshBalance()
  }, [pathname, refreshBalance])

  useEffect(() => {
    const handleFocus = () => {
      void refreshBalance()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshBalance()
      }
    }

    const handleBalanceUpdated = () => {
      void refreshBalance()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener(ACCOUNT_BALANCE_UPDATED_EVENT, handleBalanceUpdated as EventListener)

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshBalance()
      }
    }, 30000)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener(ACCOUNT_BALANCE_UPDATED_EVENT, handleBalanceUpdated as EventListener)
    }
  }, [refreshBalance])

  const balanceLabel = formatNavbarBalance(cashBalance)
  const isLoadingInitialBalance = !hasLoadedBalance && balanceLabel === null
  const buttonLabel = balanceLabel ?? (isLoadingInitialBalance ? '...' : 'Profile')
  const buttonTitle = [profileLabel, balanceLabel ? `Balance ${balanceLabel}` : null]
    .filter(Boolean)
    .join(' | ') || undefined
  const buttonAriaLabel = balanceLabel
    ? `Profile, balance ${balanceLabel}`
    : isLoadingInitialBalance
      ? 'Profile balance loading'
      : 'Profile'

  return (
    <Link
      href="/profile"
      onClick={onClick}
      className={cn(
        'inline-block min-w-[3.25rem] text-center tabular-nums',
        isLoadingInitialBalance && 'opacity-70',
        className,
      )}
      title={buttonTitle}
      aria-label={buttonAriaLabel}
      aria-busy={isLoadingInitialBalance}
    >
      {buttonLabel}
    </Link>
  )
}
