import { useId, type ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const SITE_BG_CLASS = 'bg-[#F5F2ED]'
const SITE_TEXT_CLASS = 'text-[#1a1a1a]'
const BRAND_DOT_COLORS = {
  coral: '#EF6F67',
  green: '#5DBB63',
  gold: '#D39D2E',
  blue: '#5BA5ED',
} as const

export const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND_DOT_COLORS.coral}, ${BRAND_DOT_COLORS.green}, ${BRAND_DOT_COLORS.gold}, ${BRAND_DOT_COLORS.blue})`
export const BRAND_GRADIENT_HORIZONTAL = `linear-gradient(90deg, ${BRAND_DOT_COLORS.coral}, ${BRAND_DOT_COLORS.green}, ${BRAND_DOT_COLORS.gold}, ${BRAND_DOT_COLORS.blue})`
const BRAND_BORDER_GRADIENT = 'linear-gradient(135deg, rgba(239, 111, 103, 0.78), rgba(93, 187, 99, 0.78), rgba(211, 157, 46, 0.78), rgba(91, 165, 237, 0.78))'
const DOTS = [
  BRAND_DOT_COLORS.coral,
  BRAND_DOT_COLORS.green,
  BRAND_DOT_COLORS.gold,
  BRAND_DOT_COLORS.blue,
]

const DIVIDER_SQUARES = [BRAND_DOT_COLORS.coral, BRAND_DOT_COLORS.green, BRAND_DOT_COLORS.gold, BRAND_DOT_COLORS.blue]
type FooterLink = {
  href: string
  label: string
  className?: string
  external?: boolean
  icon?: 'x'
}

const FOOTER_COLUMNS: Array<Array<FooterLink>> = [
  [
    { href: '/', label: 'home' },
    { href: '/leaderboard', label: 'leaderboard' },
    { href: '/method', label: 'methodology' },
  ],
  [
    { href: '/signup', label: 'sign up' },
    { href: '/login', label: 'sign in' },
    { href: '/waitlist', label: 'waitlist' },
  ],
  [
    { href: '/suggest', label: 'pitch trials' },
    { href: '/poll', label: 'rank trials' },
    { href: '/glossary', label: 'glossary' },
  ],
  [
    { href: '/contact', label: 'contact' },
    { href: '/brand', label: 'brand kit' },
    { href: 'https://x.com/endpointarena', label: 'Endpoint Arena on X', external: true, icon: 'x' },
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
          className="h-[6px] w-[6px] rounded-none"
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
        <rect x="20%" y="1" width="6" height="6" rx="0" fill={DIVIDER_SQUARES[0]} opacity="0.8" />
        <rect x="40%" y="1" width="6" height="6" rx="0" fill={DIVIDER_SQUARES[1]} opacity="0.8" />
        <rect x="60%" y="1" width="6" height="6" rx="0" fill={DIVIDER_SQUARES[2]} opacity="0.85" />
        <rect x="80%" y="1" width="6" height="6" rx="0" fill={DIVIDER_SQUARES[3]} opacity="0.8" />
      </svg>
    </div>
  )
}

function GradientHairline({ className }: { className?: string }) {
  const gradientId = useId().replace(/:/g, '')

  return (
    <svg
      className={cn('block h-[1px] w-full', className)}
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={BRAND_DOT_COLORS.coral} />
          <stop offset="33.33%" stopColor={BRAND_DOT_COLORS.green} />
          <stop offset="66.67%" stopColor={BRAND_DOT_COLORS.gold} />
          <stop offset="100%" stopColor={BRAND_DOT_COLORS.blue} />
        </linearGradient>
      </defs>
      <rect width="100" height="1" fill={`url(#${gradientId})`} shapeRendering="crispEdges" />
    </svg>
  )
}

function XLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export function FooterGradientRule({ className }: { className?: string }) {
  return (
    <footer className={cn('w-full', className)}>
      <div className="w-full">
        <GradientHairline />
        <div className="py-5 sm:py-6">
          <nav className="ml-auto flex w-full max-w-[780px] flex-wrap justify-end gap-x-16 gap-y-8">
            {FOOTER_COLUMNS.map((column, index) => (
              <div key={`footer-col-${index}`} className="flex min-w-[140px] flex-col items-end gap-2">
                {column.map((item) => {
                  const linkClassName = cn(
                    'text-right text-sm text-[#8a8075] underline-offset-4 decoration-[#d7cab8] transition-colors hover:text-[#1a1a1a] hover:underline',
                    item.icon ? 'inline-flex h-5 w-5 items-center justify-end' : null,
                    item.className,
                  )
                  const linkContent = item.icon === 'x'
                    ? <XLogoIcon className="h-4 w-4 fill-current" />
                    : item.label

                  return item.external ? (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={item.label}
                      title={item.label}
                      className={linkClassName}
                    >
                      {linkContent}
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={linkClassName}
                    >
                      {linkContent}
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>
        <GradientHairline />
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
    <div className={cn('rounded-none', className)}>
      <div
        className={cn('rounded-none border border-transparent', innerClassName)}
        style={{
          background: `linear-gradient(rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.95)) padding-box, ${BRAND_BORDER_GRADIENT} border-box`,
          backgroundClip: 'padding-box, border-box',
          backgroundOrigin: 'padding-box, border-box',
        }}
      >
        {children}
      </div>
    </div>
  )
}
