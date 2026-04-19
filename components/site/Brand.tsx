import Link from 'next/link'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

function getBrandDotColors(muted = false) {
  return {
    coral: muted ? '#D79A93' : '#EF6F67',
    green: muted ? '#8FC193' : '#5DBB63',
    gold: muted ? '#C3A46B' : '#D39D2E',
    blue: muted ? '#8DBAE8' : '#5BA5ED',
  }
}

const BRAND_WORDMARK = ['Endpoint', 'Arena'] as const

function getBrandLetterStyle(index: number, color: string): CSSProperties {
  return {
    ['--brand-letter-index' as '--brand-letter-index']: index,
    ['--brand-letter-wave-color' as '--brand-letter-wave-color']: color,
  } as CSSProperties
}

export function BrandMark({
  className,
  muted = false,
}: {
  className?: string
  muted?: boolean
}) {
  const colors = getBrandDotColors(muted)

  return (
    <svg
      viewBox="0 0 30 24"
      className={cn('brand-mark h-6 w-7 shrink-0', className)}
      fill="none"
      aria-hidden="true"
    >
      <rect className="brand-mark-rect brand-mark-step-1" x="0.8" y="7.8" width="6.4" height="6.4" rx="0" fill={colors.coral} />
      <rect className="brand-mark-rect brand-mark-step-2" x="7.8" y="14.8" width="6.4" height="6.4" rx="0" fill={colors.green} />
      <rect className="brand-mark-rect brand-mark-step-3" x="14.8" y="7.8" width="6.4" height="6.4" rx="0" fill={colors.gold} />
      <rect className="brand-mark-rect brand-mark-step-4" x="21.8" y="0.8" width="6.4" height="6.4" rx="0" fill={colors.blue} />
    </svg>
  )
}

export function BrandWordmark({
  className,
  wordClassName,
}: {
  className?: string
  wordClassName?: string
}) {
  const colors = getBrandDotColors()
  const waveColors = [colors.coral, colors.green, colors.gold, colors.blue]
  const letterClass = cn('brand-wordmark-letter inline-block font-medium text-[#8a8075]', wordClassName)
  let letterIndex = 0

  return (
    <span aria-hidden="true" className={cn('inline-flex', className)}>
      <span className="inline-flex items-baseline gap-1 tracking-tight">
        {BRAND_WORDMARK.map((word) => (
          <span key={word} className="brand-wordmark-word inline-flex">
            {Array.from(word).map((letter) => {
              const currentIndex = letterIndex
              const color = waveColors[currentIndex % waveColors.length]
              letterIndex += 1

              return (
                <span
                  key={`${word}-${currentIndex}-${letter}`}
                  className={letterClass}
                  style={getBrandLetterStyle(currentIndex, color)}
                >
                  {letter}
                </span>
              )
            })}
          </span>
        ))}
      </span>
    </span>
  )
}

export function BrandLink({
  href = '/',
  onClick,
  className,
}: {
  href?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label="Endpoint Arena"
      className={cn(
        'brand-link group flex min-w-0 items-center gap-2 rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5BA5ED]/40',
        className
      )}
    >
      <BrandMark className="h-[26px] w-[26px]" />
      <BrandWordmark className="text-[15px]" />
    </Link>
  )
}
