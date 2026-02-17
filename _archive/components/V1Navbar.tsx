'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/v1', label: 'Home' },
  { href: '/v1/leaderboard', label: 'Leaderboard' },
  { href: '/v1/fda-calendar', label: 'FDA Calendar' },
  { href: '/v1/method', label: 'How It Works' },
  { href: '/glossary', label: 'Glossary' },
]

export function V1Navbar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavClick = () => {
    setMobileMenuOpen(false)
  }

  return (
    <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo / Brand */}
          <Link href="/v1" className="flex items-center gap-2" onClick={handleNavClick}>
            {/* Logo icon - pill/capsule with chart */}
            <div className="w-7 h-7 relative">
              <svg viewBox="0 0 28 28" fill="none" className="w-full h-full">
                {/* Pill shape */}
                <rect x="4" y="8" width="20" height="12" rx="6" className="fill-blue-500" />
                <rect x="14" y="8" width="10" height="12" rx="0" className="fill-blue-400" />
                <rect x="18" y="8" width="6" height="12" rx="6" className="fill-blue-400" />
                {/* Chart bars inside */}
                <rect x="8" y="12" width="2" height="4" rx="0.5" className="fill-white/80" />
                <rect x="11" y="11" width="2" height="5" rx="0.5" className="fill-white/80" />
                <rect x="17" y="10" width="2" height="6" rx="0.5" className="fill-white/90" />
                <rect x="20" y="12" width="2" height="4" rx="0.5" className="fill-white/70" />
              </svg>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-white tracking-tight">Endpoint</span>
              <span className="text-lg font-bold text-blue-500 tracking-tight">Arena</span>
            </div>
            <span className="ml-1 px-2 py-0.5 text-xs bg-zinc-700 text-zinc-300 rounded font-medium">
              v1
            </span>
          </Link>

          {/* Mobile Hamburger Button */}
          <button
            className="md:hidden p-2 -mr-2 text-zinc-400 hover:text-white touch-target"
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
                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                    isActive
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}

            {/* Link to new version */}
            <Link
              href="/"
              className="ml-2 px-3 py-2 text-sm rounded-md transition-colors text-blue-400 hover:text-blue-300 hover:bg-zinc-800/50"
            >
              New Version
            </Link>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-zinc-800 py-2 mobile-menu-slide">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  className={`block px-4 py-3 text-base rounded-md transition-colors touch-target ${
                    isActive
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
            <Link
              href="/"
              onClick={handleNavClick}
              className="block px-4 py-3 text-base rounded-md transition-colors touch-target mt-2 border-t border-zinc-800 pt-4 text-blue-400 hover:text-blue-300 hover:bg-zinc-800/50"
            >
              New Version
            </Link>
          </div>
        )}
      </div>
    </nav>
  )
}
