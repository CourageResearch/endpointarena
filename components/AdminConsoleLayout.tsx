import Link from 'next/link'
import type { ReactNode } from 'react'
import { gte, sql } from 'drizzle-orm'
import { db, users, waitlistEntries } from '@/lib/db'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'

type AdminTab = 'predictions' | 'waitlist' | 'users' | 'contact' | 'markets' | 'settings' | 'resources' | 'analytics' | 'costs'

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
  { id: 'users', href: '/admin/users', label: 'Users' },
  { id: 'contact', href: '/admin/contact', label: 'Contact' },
  { id: 'analytics', href: '/admin/analytics', label: 'Analytics' },
  { id: 'settings', href: '/admin/settings', label: 'Settings' },
  { id: 'resources', href: '/admin/resources', label: 'Resources' },
  { id: 'costs', href: '/admin/costs', label: 'Costs' },
  { id: 'waitlist', href: '/admin/waitlist', label: 'Waitlist' },
]

const ADMIN_TAB_ROWS: AdminTab[][] = [
  ['predictions', 'markets'],
  ['users', 'contact'],
  ['analytics', 'settings'],
  ['waitlist', 'resources'],
  ['costs'],
]


async function getWaitlistBadgeData() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [totalRows, newRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(waitlistEntries),
      db
        .select({ count: sql<number>`count(*)` })
        .from(waitlistEntries)
        .where(gte(waitlistEntries.createdAt, since)),
    ])

    return {
      total: totalRows[0]?.count ?? 0,
      newLast7d: newRows[0]?.count ?? 0,
    }
  } catch (error) {
    console.error('Failed to load waitlist badge counts:', error)
    return {
      total: 0,
      newLast7d: 0,
    }
  }
}

async function getUsersCount() {
  try {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(users)
    return rows[0]?.count ?? 0
  } catch (error) {
    console.error('Failed to load users count:', error)
    return 0
  }
}

export async function AdminConsoleLayout({
  title,
  description,
  activeTab,
  topActions,
  children,
}: AdminConsoleLayoutProps) {
  const [waitlistBadge, usersCount] = await Promise.all([
    getWaitlistBadgeData(),
    getUsersCount(),
  ])
  const tabsById = new Map(ADMIN_TABS.map((tab) => [tab.id, tab]))

  const renderTabLink = (tabId: AdminTab) => {
    const tab = tabsById.get(tabId)
    if (!tab) return null
    const isActive = tab.id === activeTab

    return (
      <Link
        key={tab.id}
        href={tab.href}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
          isActive
            ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
            : 'bg-white/80 text-[#8a8075] border-[#e8ddd0] hover:text-[#1a1a1a] hover:bg-white'
        }`}
      >
        {tab.label}
        {tab.id === 'waitlist' ? (
          <span
            title="New in last 7 days and total signups"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? 'bg-white/20 text-white'
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {waitlistBadge.newLast7d} new / {waitlistBadge.total}
          </span>
        ) : null}
        {tab.id === 'users' ? (
          <span
            title="Total users"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? 'bg-white/20 text-white'
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {usersCount}
          </span>
        ) : null}
      </Link>
    )
  }

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8`}>
        <header className="mb-7 rounded-xl border border-[#e8ddd0] bg-white/70 backdrop-blur-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-4 sm:py-5">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b5aa9e]">Admin Console</p>
                <HeaderDots />
              </div>
              <h1 className="text-2xl font-semibold text-[#1a1a1a] mt-1">{title}</h1>
              <p className="text-sm text-[#8a8075] mt-1">{description}</p>
            </div>
          </div>
          <div className="border-t border-[#e8ddd0] px-3 py-2">
            <div className="flex flex-col gap-2">
              {ADMIN_TAB_ROWS.map((row, rowIndex) => (
                <nav key={`tab-row-${rowIndex}`} className="flex flex-wrap gap-2">
                  {row.map((tabId) => renderTabLink(tabId))}
                </nav>
              ))}
            </div>
            {topActions ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {topActions}
              </div>
            ) : null}
          </div>
        </header>

        {children}
      </main>

      <div className={SITE_CONTAINER_CLASS}>
        <FooterGradientRule />
      </div>
    </PageFrame>
  )
}
