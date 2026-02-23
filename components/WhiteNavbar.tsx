'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { BrandLink } from '@/components/site/Brand'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/markets', label: 'Markets' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/fda-calendar', label: 'Calendar' },
  { href: '/method', label: 'Method' },
  { href: '/glossary', label: 'Glossary' },
]

export function WhiteNavbar({ bgClass = 'bg-white/80', borderClass = 'border-neutral-200' }: { bgClass?: string; borderClass?: string } = {}) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isAdmin = pathname.startsWith('/admin')

  const handleNavClick = () => {
    setMobileMenuOpen(false)
  }

  const isItemActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <nav className={cn('sticky top-0 z-50 border-b shadow-[0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-md', borderClass, bgClass)}>
      <div className={SITE_CONTAINER_CLASS}>
        <div className="flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <BrandLink onClick={handleNavClick} />
            {isAdmin ? (
              <span className="hidden sm:inline-flex rounded-full border border-[#e8ddd0] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8075]">
                Admin
              </span>
            ) : null}
          </div>

          {/* Mobile Hamburger Button */}
          <button
            className="touch-target -mr-2 rounded-md p-1.5 text-[#8a8075] transition-colors hover:bg-white/70 hover:text-[#1a1a1a] md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="site-mobile-nav"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-0.5 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = isItemActive(item.href)
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
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div id="site-mobile-nav" className="mobile-menu-slide border-t border-[#e8ddd0] pb-2 pt-1.5 md:hidden">
            {NAV_ITEMS.map((item) => {
              const isActive = isItemActive(item.href)
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
          </div>
        )}
      </div>
    </nav>
  )
}
