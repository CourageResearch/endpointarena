'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { LiveProfileBalanceLink } from '@/components/LiveProfileBalanceLink'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { BrandLink } from '@/components/site/Brand'
import { cn } from '@/lib/utils'
import { ADMIN_EMAIL } from '@/lib/constants'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/method', label: 'Methodology' },
]

export function WhiteNavbar({
  bgClass = 'bg-white/80',
  borderClass = 'border-neutral-200',
  adminRuntimeLabel = null,
}: {
  bgClass?: string
  borderClass?: string
  adminRuntimeLabel?: string | null
} = {}) {
  const pathname = usePathname()
  const { data: session, status: sessionStatus } = useSession()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [resolvedAdminRuntimeLabel, setResolvedAdminRuntimeLabel] = useState<string | null>(adminRuntimeLabel)
  const isAdminRoute = pathname.startsWith('/admin')
  const isAdminUser = Boolean(session?.user?.email && session.user.email === ADMIN_EMAIL)
  const safeCallback = encodeURIComponent(pathname || '/')
  const ctaHref = sessionStatus === 'authenticated' ? `/profile?callbackUrl=${safeCallback}` : '/signup'
  const ctaLabel = sessionStatus === 'authenticated' ? 'Play Humans vs AI' : 'Sign up'
  const profileLabel = session?.user?.xUsername?.trim() || session?.user?.email?.trim() || null
  const showGuestCta = !isAdminRoute && sessionStatus === 'unauthenticated'
  const showProfileBalance = sessionStatus === 'authenticated'

  useEffect(() => {
    setResolvedAdminRuntimeLabel(adminRuntimeLabel)
  }, [adminRuntimeLabel])

  useEffect(() => {
    if (!isAdminUser) {
      setResolvedAdminRuntimeLabel(null)
      return
    }

    if (adminRuntimeLabel) {
      setResolvedAdminRuntimeLabel(adminRuntimeLabel)
      return
    }

    let cancelled = false

    const loadDatabaseTarget = async () => {
      try {
        const response = await fetch('/api/admin/database-target', {
          method: 'GET',
          cache: 'no-store',
        })
        if (!response.ok) return

        const payload = await response.json() as {
          target?: string
          targets?: Array<{
            target?: string
            label?: string
          }>
        }

        const activeTarget = typeof payload.target === 'string' ? payload.target : null
        const activeLabel = payload.targets?.find((entry) => entry.target === activeTarget)?.label ?? null

        if (!cancelled && typeof activeLabel === 'string' && activeLabel.trim().length > 0) {
          setResolvedAdminRuntimeLabel(activeLabel)
        }
      } catch {
        // Leave the admin pill visible even if the runtime target request fails.
      }
    }

    void loadDatabaseTarget()

    return () => {
      cancelled = true
    }
  }, [adminRuntimeLabel, isAdminUser])

  const handleNavClick = () => {
    setMobileMenuOpen(false)
  }

  const isItemActive = (item: { href: string; matchPrefixes?: string[] }) => {
    if (item.href === '/') return pathname === '/'

    const matchPrefixes = item.matchPrefixes ?? [item.href]
    return matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  }

  return (
    <nav className={cn('sticky top-0 z-50 border-b shadow-[0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-md', borderClass, bgClass)}>
      <div className={SITE_CONTAINER_CLASS}>
        <div className="flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <BrandLink onClick={handleNavClick} />
            {isAdminUser ? (
              <div className="hidden sm:flex items-center gap-1.5">
                <Link
                  href="/admin"
                  className="inline-flex rounded-full border border-[#e8ddd0] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8075] transition-colors hover:bg-white hover:text-[#1a1a1a]"
                >
                  Admin
                </Link>
                {resolvedAdminRuntimeLabel ? (
                  <Link
                    href="/admin/settings"
                    title={`Current admin database: ${resolvedAdminRuntimeLabel}. Open settings.`}
                    className="inline-flex rounded-full border border-[#e8ddd0] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8075] transition-colors hover:bg-white hover:text-[#1a1a1a]"
                  >
                    {resolvedAdminRuntimeLabel}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            className="touch-target -mr-2 rounded-md p-1.5 text-[#8a8075] transition-colors hover:bg-white/70 hover:text-[#1a1a1a] xl:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="site-mobile-nav"
          >
            {mobileMenuOpen ? (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>

          <div className="hidden items-center gap-0.5 xl:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = isItemActive(item)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'font-medium text-[#1a1a1a]'
                      : 'text-[#8a8075] hover:text-[#1a1a1a]'
                  )}
                >
                  {item.label}
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-px rounded-full"
                      style={{ background: 'linear-gradient(90deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}
                    />
                  )}
                </Link>
              )
            })}
            {showGuestCta ? (
              <Link
                href={ctaHref}
                className="ml-2 rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                {ctaLabel}
              </Link>
            ) : null}
            {showProfileBalance ? (
              <LiveProfileBalanceLink
                profileLabel={profileLabel}
                className="ml-2 rounded-sm border border-[#e8ddd0] bg-white/80 px-3 py-1.5 text-xs font-medium text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a]"
              />
            ) : null}
          </div>
        </div>

        {mobileMenuOpen && (
          <div id="site-mobile-nav" className="mobile-menu-slide border-t border-[#e8ddd0] pb-2 pt-1.5 xl:hidden">
            {showGuestCta ? (
              <Link
                href={ctaHref}
                onClick={handleNavClick}
                className="touch-target mb-1 block rounded-md border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-3 text-base font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                {ctaLabel}
              </Link>
            ) : null}
            {NAV_ITEMS.map((item) => {
              const isActive = isItemActive(item)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  className={cn(
                    'touch-target block rounded-md px-4 py-3 text-base transition-colors',
                    isActive
                      ? 'bg-white text-[#1a1a1a] shadow-[inset_0_0_0_1px_rgba(232,221,208,0.9)]'
                      : 'text-[#8a8075] hover:text-[#1a1a1a] hover:bg-[#e8ddd0]/20'
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
            {showProfileBalance ? (
              <LiveProfileBalanceLink
                profileLabel={profileLabel}
                onClick={handleNavClick}
                className="touch-target mt-1 block rounded-md border border-[#e8ddd0] bg-white px-4 py-3 text-base text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a]"
              />
            ) : null}
          </div>
        )}
      </div>
    </nav>
  )
}
