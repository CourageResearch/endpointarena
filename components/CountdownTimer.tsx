'use client'

import { useState, useEffect } from 'react'

interface CountdownTimerProps {
  targetDate: Date | string
  variant?: 'dark' | 'light'
}

export function CountdownTimer({ targetDate, variant = 'dark' }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    const target = new Date(targetDate).getTime()

    const updateCountdown = () => {
      const now = Date.now()
      const diff = target - now

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
        return
      }

      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      })
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [targetDate])

  const textColor = variant === 'light' ? 'text-white' : 'text-blue-400'
  const separatorColor = variant === 'light' ? 'text-white/60' : 'text-zinc-500'

  return (
    <div className="flex items-center gap-1 text-sm font-mono">
      <span className={`${textColor} font-bold`}>{timeLeft.days}d</span>
      <span className={separatorColor}>:</span>
      <span className={`${textColor} font-bold`}>{String(timeLeft.hours).padStart(2, '0')}h</span>
      <span className={separatorColor}>:</span>
      <span className={`${textColor} font-bold`}>{String(timeLeft.minutes).padStart(2, '0')}m</span>
      <span className={separatorColor}>:</span>
      <span className={`${textColor} font-bold`}>{String(timeLeft.seconds).padStart(2, '0')}s</span>
    </div>
  )
}
