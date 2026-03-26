import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const SITE_BG_CLASS = 'bg-[#F5F2ED]'
const SITE_TEXT_CLASS = 'text-[#1a1a1a]'
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
const FOOTER_COLUMNS: Array<Array<{ href: string; label: string }>> = [
  [
    { href: '/trials', label: 'trials' },
    { href: '/leaderboard', label: 'leaderboard' },
  ],
  [
    { href: '/waitlist', label: 'waitlist' },
    { href: '/contact', label: 'contact' },
    { href: '/brand', label: 'brand kit' },
  ],
  [
    { href: '/method', label: 'methodology' },
    { href: '/glossary', label: 'glossary' },
    { href: '/pdf', label: 'pdf one pager' },
  ],
]

export function PageFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-h-screen overflow-x-hidden', SITE_BG_CLASS, SITE_TEXT_CLASS, className)}>
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
    <footer className={cn('w-full', className)}>
      <div className="w-full">
        <div
          className="h-px w-full"
          style={{ background: BRAND_GRADIENT_HORIZONTAL }}
          aria-hidden="true"
        />
        <div className="py-5 sm:py-6">
          <nav className="ml-auto flex w-full max-w-[620px] flex-wrap justify-end gap-x-12 gap-y-4">
            {FOOTER_COLUMNS.map((column, index) => (
              <div key={`footer-col-${index}`} className="flex min-w-[140px] flex-col items-end gap-2">
                {column.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-right text-sm text-[#8a8075] underline-offset-4 decoration-[#d7cab8] transition-colors hover:text-[#1a1a1a] hover:underline"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div
          className="h-px w-full"
          style={{ background: BRAND_GRADIENT_HORIZONTAL }}
          aria-hidden="true"
        />
      </div>
    </footer>
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
