'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/fda-calendar', label: 'FDA Calendar' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/how-it-works', label: 'How It Works' },
]

export function Navbar() {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith('/admin')

  return (
    <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo / Brand */}
          <Link href="/" className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-white">Endpoint</span>
            <span className="text-lg font-bold text-blue-500">Arena</span>
            {isAdmin && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded font-medium">
                Admin
              </span>
            )}
          </Link>

          {/* Main Navigation */}
          <div className="flex items-center gap-1">
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

            {/* Admin link */}
            <Link
              href="/admin"
              className={`ml-2 px-3 py-2 text-sm rounded-md transition-colors ${
                isAdmin
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              Admin
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
