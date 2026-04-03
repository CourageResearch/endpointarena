import Link from 'next/link'
import type { ReactNode } from 'react'
import { gte, sql } from 'drizzle-orm'
import { db, contactMessages, crashEvents, users, waitlistEntries } from '@/lib/db'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'

type AdminTab = 'predictions' | 'waitlist' | 'users' | 'contact' | 'ai' | 'trials' | 'settings' | 'analytics' | 'searches' | 'crashes' | 'outcomes' | 'update'

interface AdminConsoleLayoutProps {
  title: string
  description: string
  activeTab: AdminTab
  topActions?: ReactNode
  children: ReactNode
}

const ADMIN_TABS: Array<{ id: AdminTab; href: string; label: string }> = [
  { id: 'ai', href: '/admin/ai', label: 'AI' },
  { id: 'trials', href: '/admin/trials', label: 'Trials' },
  { id: 'update', href: '/admin/update', label: 'Update' },
  { id: 'outcomes', href: '/admin/outcomes', label: 'Oracle' },
  { id: 'users', href: '/admin/users', label: 'Users' },
  { id: 'contact', href: '/admin/contact', label: 'Contact' },
  { id: 'analytics', href: '/admin/analytics', label: 'Analytics' },
  { id: 'searches', href: '/admin/searches', label: 'Searches' },
  { id: 'crashes', href: '/admin/crashes', label: 'Crashes' },
  { id: 'settings', href: '/admin/settings', label: 'Settings' },
  { id: 'waitlist', href: '/admin/waitlist', label: 'Waitlist' },
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

async function getContactCount() {
  try {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(contactMessages)
    return rows[0]?.count ?? 0
  } catch (error) {
    console.error('Failed to load contact count:', error)
    return 0
  }
}

async function getCrashes24hCount() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(crashEvents)
      .where(gte(crashEvents.createdAt, since))
    return rows[0]?.count ?? 0
  } catch (error) {
    console.error('Failed to load crash badge count:', error)
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
  const [waitlistBadge, usersCount, contactCount, crashes24hCount] = await Promise.all([
    getWaitlistBadgeData(),
    getUsersCount(),
    getContactCount(),
    getCrashes24hCount(),
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
        aria-current={isActive ? 'page' : undefined}
        className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 border-b-2 px-1.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
          isActive
            ? 'border-[#1a1a1a] text-[#1a1a1a]'
            : 'border-transparent text-[#8a8075] hover:border-[#d8ccb9] hover:text-[#1a1a1a]'
        }`}
      >
        {tab.label}
        {tab.id === 'waitlist' ? (
          <span
            title="Total waitlist signups"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {waitlistBadge.total}
          </span>
        ) : null}
        {tab.id === 'users' ? (
          <span
            title="Total users"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {usersCount}
          </span>
        ) : null}
        {tab.id === 'contact' ? (
          <span
            title="Total contact messages"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {contactCount}
          </span>
        ) : null}
        {tab.id === 'crashes' ? (
          <span
            title="Crash events in last 24 hours"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {crashes24hCount}
          </span>
        ) : null}
      </Link>
    )
  }

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8`}>
        <header className="mb-7">
          <div className="py-4 sm:py-5">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b5aa9e]">Admin Console</p>
                <HeaderDots />
              </div>
              <h1 className="text-2xl font-semibold text-[#1a1a1a] mt-1">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-[#8a8075]">{description}</p>
            </div>
          </div>
          <div className="mt-1">
            <nav className="admin-tabs-scroll flex overflow-x-auto border-b border-[#d8ccb9]">
              {ADMIN_TABS.map((tab) => renderTabLink(tab.id))}
            </nav>
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
