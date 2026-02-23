import Link from 'next/link'
import type { ReactNode } from 'react'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { LogoutButton } from '@/components/LogoutButton'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'

type AdminTab = 'predictions' | 'markets' | 'settings' | 'analytics' | 'costs'

interface AdminConsoleLayoutProps {
  title: string
  description: string
  activeTab: AdminTab
  topActions?: ReactNode
  children: ReactNode
}

const ADMIN_TABS: Array<{ id: AdminTab; href: string; label: string }> = [
  { id: 'predictions', href: '/admin', label: 'Predictions' },
  { id: 'markets', href: '/admin/markets', label: 'Markets' },
  { id: 'settings', href: '/admin/settings', label: 'Settings' },
  { id: 'analytics', href: '/admin/analytics', label: 'Analytics' },
  { id: 'costs', href: '/admin/costs', label: 'Costs' },
]

export function AdminConsoleLayout({
  title,
  description,
  activeTab,
  topActions,
  children,
}: AdminConsoleLayoutProps) {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8`}>
        <header className="mb-7 rounded-xl border border-[#e8ddd0] bg-white/70 backdrop-blur-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-4 sm:py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b5aa9e]">Admin Console</p>
                <HeaderDots />
              </div>
              <h1 className="text-2xl font-semibold text-[#1a1a1a] mt-1">{title}</h1>
              <p className="text-sm text-[#8a8075] mt-1">{description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
              >
                Public Site
              </Link>
              <LogoutButton />
            </div>
          </div>
          <div className="border-t border-[#e8ddd0] px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
            <nav className="flex flex-wrap gap-2">
              {ADMIN_TABS.map((tab) => {
                const isActive = tab.id === activeTab
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      isActive
                        ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                        : 'bg-white/80 text-[#8a8075] border-[#e8ddd0] hover:text-[#1a1a1a] hover:bg-white'
                    }`}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>
            {topActions ? (
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {topActions}
              </div>
            ) : null}
          </div>
        </header>

        {children}
      </main>

      <FooterGradientRule />
    </PageFrame>
  )
}
