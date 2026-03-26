'use client'

import { useEffect, useMemo, useState } from 'react'
import { ProfileRefillCelebration } from '@/components/ProfileRefillCelebration'
import { STARTER_POINTS } from '@/lib/constants'

type ProfilePointsBalanceProps = {
  pointsBalance: number
  pointsAwarded?: number
  userId: string
  userCreatedAtIso: string | null
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function parseStoredNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed)
}

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe)
}

export function ProfilePointsBalance({
  pointsBalance,
  pointsAwarded = 0,
  userId,
  userCreatedAtIso,
}: ProfilePointsBalanceProps) {
  const [displayPoints, setDisplayPoints] = useState(pointsBalance)
  const [celebrationAwarded, setCelebrationAwarded] = useState(0)

  const label = useMemo(() => formatUsd(displayPoints), [displayPoints])

  useEffect(() => {
    let start = pointsBalance
    let awarded = Math.max(0, pointsAwarded)
    const seenSignupCelebrationKey = `ea-signup-celebrated:${userId}`
    let shouldMarkSignupCelebrationSeen = false

    const urlParams = new URLSearchParams(window.location.search)
    const urlAward = parseStoredNumber(urlParams.get('signupAward'))

    const unlockAwardStored = parseStoredNumber(sessionStorage.getItem('ea-points-award'))
    const unlockAwardFallback = parseStoredNumber(localStorage.getItem('ea-points-award-pending'))
    const resolvedUnlockAward = Math.max(urlAward ?? 0, unlockAwardStored ?? 0, unlockAwardFallback ?? 0)
    if (resolvedUnlockAward > 0) {
      awarded = Math.max(awarded, resolvedUnlockAward)
      start = Math.max(0, pointsBalance - resolvedUnlockAward)
      sessionStorage.removeItem('ea-points-award')
      localStorage.removeItem('ea-points-award-pending')
      shouldMarkSignupCelebrationSeen = true

      if (urlAward && urlParams.has('signupAward')) {
        urlParams.delete('signupAward')
        const nextQuery = urlParams.toString()
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }
    }

    const hasSeenSignupCelebration = localStorage.getItem(seenSignupCelebrationKey) === '1'
    const createdAtMs = userCreatedAtIso ? Date.parse(userCreatedAtIso) : Number.NaN
    const isRecentSignup = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= (30 * 60 * 1000)
    if (!hasSeenSignupCelebration && isRecentSignup && pointsBalance >= STARTER_POINTS && awarded < STARTER_POINTS) {
      awarded = STARTER_POINTS
      start = Math.max(0, pointsBalance - awarded)
      shouldMarkSignupCelebrationSeen = true
    }

    if (awarded > 0 && start === pointsBalance) {
      start = Math.max(0, pointsBalance - awarded)
    }

    const previousStored = parseStoredNumber(localStorage.getItem('ea-last-points-balance'))
    if (previousStored !== null && previousStored >= 0 && previousStored < pointsBalance) {
      start = Math.min(start, previousStored)
    }

    localStorage.setItem('ea-last-points-balance', String(pointsBalance))

    if (awarded >= STARTER_POINTS) {
      setCelebrationAwarded(awarded)
    } else {
      setCelebrationAwarded(0)
    }

    if (shouldMarkSignupCelebrationSeen) {
      window.setTimeout(() => {
        localStorage.setItem(seenSignupCelebrationKey, '1')
      }, 0)
    }

    if (start >= pointsBalance) {
      setDisplayPoints(pointsBalance)
      return
    }

    let rafId = 0
    const durationMs = 900
    const startedAt = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const eased = easeOutCubic(progress)
      const nextValue = Math.round(start + (pointsBalance - start) * eased)
      setDisplayPoints(nextValue)
      if (progress < 1) {
        rafId = window.requestAnimationFrame(tick)
      }
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [pointsBalance, pointsAwarded, userCreatedAtIso, userId])

  return (
    <>
      <ProfileRefillCelebration pointsAwarded={celebrationAwarded} />
      <p className="mt-3 text-3xl font-semibold tabular-nums text-[#1a1a1a]">{label}</p>
      <p className="mt-1 text-xs text-[#8a8075]">Daily cash refill auto-applies when eligible.</p>
    </>
  )
}
