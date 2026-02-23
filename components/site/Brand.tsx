import Link from 'next/link'
import { cn } from '@/lib/utils'

function getBrandDotColors(muted = false) {
  return {
    coral: muted ? '#D79A93' : '#EF6F67',
    green: muted ? '#8FC193' : '#5DBB63',
    gold: muted ? '#C3A46B' : '#D39D2E',
    blue: muted ? '#8DBAE8' : '#5BA5ED',
  }
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
      className={cn('h-6 w-7 shrink-0', className)}
      fill="none"
      aria-hidden="true"
    >
      <rect x="0.8" y="7.8" width="6.4" height="6.4" rx="2" fill={colors.coral} />
      <rect x="7.8" y="14.8" width="6.4" height="6.4" rx="2" fill={colors.green} />
      <rect x="14.8" y="7.8" width="6.4" height="6.4" rx="2" fill={colors.gold} />
      <rect x="21.8" y="0.8" width="6.4" height="6.4" rx="2" fill={colors.blue} />
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
  const wordClass = cn('font-medium text-[#8a8075]', wordClassName)

  return (
    <span className={cn('inline-flex items-baseline gap-1 tracking-tight', className)}>
      <span className={wordClass}>Endpoint</span>
      <span className={wordClass}>Arena</span>
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
      className={cn(
        'group flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5BA5ED]/40',
        className
      )}
    >
      <BrandMark className="h-[26px] w-[26px] transition-transform duration-200 group-hover:scale-[1.03]" />
      <BrandWordmark className="text-[15px]" />
    </Link>
  )
}
