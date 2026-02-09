'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/fda-calendar', label: 'Calendar' },
  { href: '/method', label: 'Method' },
  { href: '/glossary', label: 'Glossary' },
]

export function WhiteNavbar({ bgClass = 'bg-white/80', borderClass = 'border-neutral-200' }: { bgClass?: string; borderClass?: string } = {}) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavClick = () => {
    setMobileMenuOpen(false)
  }

  return (
    <nav className={`border-b ${borderClass} ${bgClass} backdrop-blur-sm sticky top-0 z-50`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-[#1a1a1a]" onClick={handleNavClick}>
            <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0">
              <circle cx="5" cy="18" r="3.2" fill="#D4604A" />
              <circle cx="12" cy="11" r="3.2" fill="#C9A227" />
              <circle cx="19" cy="4" r="3.2" fill="#2D7CF6" />
            </svg>
            <span className="font-bold">Endpoint</span><span className="font-normal text-[#b5aa9e]">Arena</span>
          </Link>

          {/* Mobile Hamburger Button */}
          <button
            className="md:hidden p-2 -mr-2 text-[#b5aa9e] hover:text-[#1a1a1a]"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
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
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-[#1a1a1a] font-medium'
                      : 'text-[#8a8075] hover:text-[#1a1a1a]'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6)' }} />
                  )}
                </Link>
              )
            })}
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#e8ddd0] py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  className={`block px-4 py-3 text-base rounded-md transition-colors ${
                    isActive
                      ? 'bg-[#e8ddd0]/40 text-[#1a1a1a] font-medium'
                      : 'text-[#8a8075] hover:text-[#1a1a1a] hover:bg-[#e8ddd0]/20'
                  }`}
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
