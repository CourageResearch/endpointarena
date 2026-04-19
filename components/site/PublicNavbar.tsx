'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/use-auth'
import { Season4BalanceLink } from '@/components/season4/Season4BalanceLink'
import { BrandLink } from '@/components/site/Brand'
import { NavbarBadge, NavbarBadgeLink } from '@/components/site/NavbarBadge'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { cn } from '@/lib/utils'
import { isConfiguredAdminEmail } from '@/lib/constants'
import { PUBLIC_NAV_ITEMS, type PublicNavItem } from '@/lib/public-navigation'

export function PublicNavbar({
  badgeLabel = 'Season 4',
}: {
  badgeLabel?: string | null
} = {}) {
  const pathname = usePathname()
  const { data: session, status: sessionStatus, fetchWithAuth } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [resolvedAdminRuntimeLabel, setResolvedAdminRuntimeLabel] = useState<string | null>(null)
  const safeCallback = encodeURIComponent(pathname || '/')
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup')
  const ctaHref = pathname.startsWith('/login')
    ? `/login?callbackUrl=${safeCallback}`
    : `/signup?callbackUrl=${safeCallback}`
  const ctaLabel = pathname.startsWith('/login') ? 'Log in' : 'Sign up'
  const profileLabel = session?.user.xUsername?.trim() || session?.user.email?.trim() || null
  const isAdminUser = isConfiguredAdminEmail(session?.user?.email)
  const showProfileBalance = sessionStatus === 'authenticated'
  const showGuestCta = !showProfileBalance

  useEffect(() => {
    if (!isAdminUser) {
      setResolvedAdminRuntimeLabel(null)
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
        // Keep the admin pill visible even if the runtime target request fails.
      }
    }

    void loadDatabaseTarget()

    return () => {
      cancelled = true
    }
  }, [isAdminUser])

  const isItemActive = (item: PublicNavItem) => {
    if (item.href === '/') return pathname === '/'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  const handleNavClick = () => {
    setMobileMenuOpen(false)
  }

  const handleAdminClick = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: '/admin' | '/admin/settings',
  ) => {
    event.preventDefault()
    handleNavClick()

    try {
      const response = await fetchWithAuth('/api/auth/me', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        window.location.assign(`/login?callbackUrl=${encodeURIComponent(href)}`)
        return
      }
    } catch {
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(href)}`)
      return
    }

    window.location.assign(href)
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-[#e8ddd0] bg-[#F5F2ED]/80 shadow-[0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-md">
      <div className={SITE_CONTAINER_CLASS}>
        <div className="flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <BrandLink onClick={handleNavClick} />
            {badgeLabel ? (
              <NavbarBadge>
                {badgeLabel}
              </NavbarBadge>
            ) : null}
            {isAdminUser ? (
              <div className="hidden sm:flex items-center gap-1.5">
                <NavbarBadgeLink
                  href="/admin"
                  prefetch={false}
                  onClick={(event) => void handleAdminClick(event, '/admin')}
                >
                  Admin
                </NavbarBadgeLink>
                {resolvedAdminRuntimeLabel ? (
                  <NavbarBadgeLink
                    href="/admin/settings"
                    title={`Current admin database: ${resolvedAdminRuntimeLabel}. Open settings.`}
                    prefetch={false}
                    onClick={(event) => void handleAdminClick(event, '/admin/settings')}
                  >
                    {resolvedAdminRuntimeLabel}
                  </NavbarBadgeLink>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            className="touch-target -mr-2 rounded-md p-1.5 text-[#8a8075] transition-colors hover:bg-white/70 hover:text-[#1a1a1a] lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="public-site-mobile-nav"
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

          <div className="hidden items-center gap-0.5 lg:flex">
            {PUBLIC_NAV_ITEMS.map((item) => {
              const isActive = isItemActive(item)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group relative rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none',
                    isActive
                      ? 'font-medium'
                      : 'text-[#8a8075]'
                  )}
                >
                  <span className="inline-flex flex-col items-center gap-0.5">
                    <span className={cn(isActive ? item.activeTextClass : item.hoverTextClass)}>
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        'block h-px w-full rounded-full transition-opacity',
                        isActive
                          ? item.activeUnderlineClass
                          : cn('opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100', item.hoverUnderlineClass),
                      )}
                    />
                  </span>
                </Link>
              )
            })}
            {showGuestCta && !isAuthPage ? (
              <Link
                href={ctaHref}
                className="ml-2 rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                {ctaLabel}
              </Link>
            ) : null}
            {showProfileBalance ? (
              <Season4BalanceLink
                profileLabel={profileLabel}
                className="ml-2 rounded-sm border border-[#e8ddd0] bg-white/80 px-3 py-1.5 text-xs font-medium text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a]"
              />
            ) : null}
          </div>
        </div>

        {mobileMenuOpen ? (
          <div id="public-site-mobile-nav" className="mobile-menu-slide border-t border-[#e8ddd0] pb-2 pt-1.5 lg:hidden">
            {isAdminUser ? (
              <div className="mb-1 flex flex-col gap-1 sm:hidden">
                <NavbarBadgeLink
                  href="/admin"
                  prefetch={false}
                  onClick={(event) => void handleAdminClick(event, '/admin')}
                  className="touch-target justify-center rounded-md px-4 py-3 text-base tracking-[0.12em]"
                >
                  Admin
                </NavbarBadgeLink>
                {resolvedAdminRuntimeLabel ? (
                  <NavbarBadgeLink
                    href="/admin/settings"
                    title={`Current admin database: ${resolvedAdminRuntimeLabel}. Open settings.`}
                    prefetch={false}
                    onClick={(event) => void handleAdminClick(event, '/admin/settings')}
                    className="touch-target justify-center rounded-md px-4 py-3 text-base tracking-[0.12em]"
                  >
                    {resolvedAdminRuntimeLabel}
                  </NavbarBadgeLink>
                ) : null}
              </div>
            ) : null}
            {showGuestCta && !isAuthPage ? (
              <Link
                href={ctaHref}
                onClick={handleNavClick}
                className="touch-target mb-1 block rounded-md border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-3 text-base font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                {ctaLabel}
              </Link>
            ) : null}
            {PUBLIC_NAV_ITEMS.map((item) => {
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
                      : 'text-[#8a8075] hover:bg-[#e8ddd0]/20 hover:text-[#1a1a1a]'
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
            {showProfileBalance ? (
              <Season4BalanceLink
                profileLabel={profileLabel}
                onClick={handleNavClick}
                className="touch-target mt-1 block rounded-md border border-[#e8ddd0] bg-white px-4 py-3 text-base text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a]"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  )
}
