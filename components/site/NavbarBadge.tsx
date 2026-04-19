import Link from 'next/link'
import type { MouseEventHandler } from 'react'
import { cn } from '@/lib/utils'

const NAVBAR_BADGE_CLASS = 'inline-flex shrink-0 items-center rounded-full border border-[#e8ddd0] bg-white/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#8a8075]'

export function NavbarBadge({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <span className={cn(NAVBAR_BADGE_CLASS, className)}>{children}</span>
}

export function NavbarBadgeLink({
  href,
  title,
  children,
  className,
  onClick,
  prefetch,
}: {
  href: string
  title?: string
  children: React.ReactNode
  className?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
  prefetch?: boolean
}) {
  return (
    <Link
      href={href}
      title={title}
      onClick={onClick}
      prefetch={prefetch}
      className={cn(NAVBAR_BADGE_CLASS, 'transition-colors hover:bg-white hover:text-[#1a1a1a]', className)}
    >
      {children}
    </Link>
  )
}
