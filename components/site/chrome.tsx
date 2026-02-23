import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const SITE_BG_CLASS = 'bg-[#F5F2ED]'
export const SITE_TEXT_CLASS = 'text-[#1a1a1a]'
export const BRAND_DOT_COLORS = {
  coral: '#EF6F67',
  green: '#5DBB63',
  gold: '#D39D2E',
  blue: '#5BA5ED',
} as const

export const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND_DOT_COLORS.coral}, ${BRAND_DOT_COLORS.green}, ${BRAND_DOT_COLORS.gold}, ${BRAND_DOT_COLORS.blue})`
export const BRAND_GRADIENT_HORIZONTAL = `linear-gradient(90deg, ${BRAND_DOT_COLORS.coral}, ${BRAND_DOT_COLORS.green}, ${BRAND_DOT_COLORS.gold}, ${BRAND_DOT_COLORS.blue})`
const DOTS = [
  BRAND_DOT_COLORS.coral,
  BRAND_DOT_COLORS.green,
  BRAND_DOT_COLORS.gold,
  BRAND_DOT_COLORS.blue,
]

const DIVIDER_SQUARES = [BRAND_DOT_COLORS.coral, BRAND_DOT_COLORS.green, BRAND_DOT_COLORS.gold, BRAND_DOT_COLORS.blue]

export function PageFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-h-screen overflow-x-clip', SITE_BG_CLASS, SITE_TEXT_CLASS, className)}>
      {children}
    </div>
  )
}

export function HeaderDots({
  className,
}: {
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)} aria-hidden="true">
      {DOTS.map((color, index) => (
        <div
          key={`${color}-${index}`}
          className="h-[6px] w-[6px] rounded-[2px]"
          style={{ backgroundColor: color, opacity: index === 1 ? 0.85 : 0.8 }}
        />
      ))}
    </div>
  )
}

export function SquareDivider({ className }: { className?: string }) {
  return (
    <div className={cn('w-full', className)} aria-hidden="true">
      <svg className="w-full" height="8" preserveAspectRatio="none">
        <rect x="20%" y="1" width="6" height="6" rx="1" fill={DIVIDER_SQUARES[0]} opacity="0.8" />
        <rect x="40%" y="1" width="6" height="6" rx="1" fill={DIVIDER_SQUARES[1]} opacity="0.8" />
        <rect x="60%" y="1" width="6" height="6" rx="1" fill={DIVIDER_SQUARES[2]} opacity="0.85" />
        <rect x="80%" y="1" width="6" height="6" rx="1" fill={DIVIDER_SQUARES[3]} opacity="0.8" />
      </svg>
    </div>
  )
}

export function FooterGradientRule({ className }: { className?: string }) {
  return (
    <div
      className={cn('h-px w-full', className)}
      style={{ background: BRAND_GRADIENT_HORIZONTAL }}
      aria-hidden="true"
    />
  )
}

export function GradientBorder({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
}) {
  return (
    <div className={cn('rounded-xl p-px', className)} style={{ background: BRAND_GRADIENT }}>
      <div className={cn('rounded-[11px] bg-white/95', innerClassName)}>
        {children}
      </div>
    </div>
  )
}
