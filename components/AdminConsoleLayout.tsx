import Link from 'next/link'
import type { ReactNode } from 'react'
import { gte, like, notLike, sql } from 'drizzle-orm'
import { db, contactMessages, crashEvents, users, waitlistEntries } from '@/lib/db'
import { getActiveDatabaseTarget, listDatabaseTargets } from '@/lib/database-target'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { MARKET_SUGGESTION_MESSAGE_PREFIX } from '@/lib/market-suggestions'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'
import {
  ADMIN_ACTIVITY_DAY_FILTERS,
  ADMIN_CRASH_DAY_FILTERS,
  buildAdminDayFilterHref,
  type AdminDayFilterOption,
} from '@/lib/admin-search-params'

type AdminTab = 'predictions' | 'trials' | 'base' | 'waitlist' | 'users' | 'contact' | 'suggestions' | 'ai' | 'settings' | 'analytics' | 'searches' | 'crashes' | 'oracle' | 'tables'

interface AdminConsoleLayoutProps {
  title: string
  activeTab: AdminTab
  days?: number
  topActions?: ReactNode
  children: ReactNode
}

const ADMIN_TABS: Array<{
  id: AdminTab
  href: string
  label: string
  activeClass: string
  hoverClass: string
  activeBadgeClass: string
  dayFilters?: readonly AdminDayFilterOption[]
}> = [
  {
    id: 'ai',
    href: '/admin/ai',
    label: 'AI',
    activeClass: 'border-[#EF6F67] text-[#c86a63]',
    hoverClass: 'hover:border-[#EF6F67]/55 hover:text-[#c86a63]',
    activeBadgeClass: 'bg-[#EF6F67]/12 text-[#c86a63]',
  },
  {
    id: 'trials',
    href: '/admin/trials',
    label: 'Trials',
    activeClass: 'border-[#D39D2E] text-[#b8841f]',
    hoverClass: 'hover:border-[#D39D2E]/55 hover:text-[#b8841f]',
    activeBadgeClass: 'bg-[#D39D2E]/12 text-[#b8841f]',
  },
  {
    id: 'base',
    href: '/admin/base',
    label: 'Base',
    activeClass: 'border-[#5BA5ED] text-[#4a8cca]',
    hoverClass: 'hover:border-[#5BA5ED]/55 hover:text-[#4a8cca]',
    activeBadgeClass: 'bg-[#5BA5ED]/12 text-[#4a8cca]',
  },
  {
    id: 'oracle',
    href: '/admin/oracle',
    label: 'Oracle',
    activeClass: 'border-[#5BA5ED] text-[#4a8cca]',
    hoverClass: 'hover:border-[#5BA5ED]/55 hover:text-[#4a8cca]',
    activeBadgeClass: 'bg-[#5BA5ED]/12 text-[#4a8cca]',
  },
  {
    id: 'users',
    href: '/admin/users',
    label: 'Users',
    activeClass: 'border-[#5DBB63] text-[#45934a]',
    hoverClass: 'hover:border-[#5DBB63]/55 hover:text-[#45934a]',
    activeBadgeClass: 'bg-[#5DBB63]/12 text-[#45934a]',
  },
  {
    id: 'contact',
    href: '/admin/contact',
    label: 'Contact',
    activeClass: 'border-[#EF6F67] text-[#c86a63]',
    hoverClass: 'hover:border-[#EF6F67]/55 hover:text-[#c86a63]',
    activeBadgeClass: 'bg-[#EF6F67]/12 text-[#c86a63]',
  },
  {
    id: 'suggestions',
    href: '/admin/suggestions',
    label: 'Suggestions',
    activeClass: 'border-[#D39D2E] text-[#b8841f]',
    hoverClass: 'hover:border-[#D39D2E]/55 hover:text-[#b8841f]',
    activeBadgeClass: 'bg-[#D39D2E]/12 text-[#b8841f]',
  },
  {
    id: 'analytics',
    href: '/admin/analytics',
    label: 'Analytics',
    activeClass: 'border-[#5DBB63] text-[#45934a]',
    hoverClass: 'hover:border-[#5DBB63]/55 hover:text-[#45934a]',
    activeBadgeClass: 'bg-[#5DBB63]/12 text-[#45934a]',
    dayFilters: ADMIN_ACTIVITY_DAY_FILTERS,
  },
  {
    id: 'searches',
    href: '/admin/searches',
    label: 'Searches',
    activeClass: 'border-[#5BA5ED] text-[#4a8cca]',
    hoverClass: 'hover:border-[#5BA5ED]/55 hover:text-[#4a8cca]',
    activeBadgeClass: 'bg-[#5BA5ED]/12 text-[#4a8cca]',
    dayFilters: ADMIN_ACTIVITY_DAY_FILTERS,
  },
  {
    id: 'crashes',
    href: '/admin/crashes',
    label: 'Crashes',
    activeClass: 'border-[#EF6F67] text-[#c86a63]',
    hoverClass: 'hover:border-[#EF6F67]/55 hover:text-[#c86a63]',
    activeBadgeClass: 'bg-[#EF6F67]/12 text-[#c86a63]',
    dayFilters: ADMIN_CRASH_DAY_FILTERS,
  },
  {
    id: 'waitlist',
    href: '/admin/waitlist',
    label: 'Waitlist',
    activeClass: 'border-[#D39D2E] text-[#b8841f]',
    hoverClass: 'hover:border-[#D39D2E]/55 hover:text-[#b8841f]',
    activeBadgeClass: 'bg-[#D39D2E]/12 text-[#b8841f]',
  },
  {
    id: 'tables',
    href: '/admin/tables',
    label: 'Tables',
    activeClass: 'border-[#5DBB63] text-[#45934a]',
    hoverClass: 'hover:border-[#5DBB63]/55 hover:text-[#45934a]',
    activeBadgeClass: 'bg-[#5DBB63]/12 text-[#45934a]',
  },
  {
    id: 'settings',
    href: '/admin/settings',
    label: 'Settings',
    activeClass: 'border-[#5BA5ED] text-[#4a8cca]',
    hoverClass: 'hover:border-[#5BA5ED]/55 hover:text-[#4a8cca]',
    activeBadgeClass: 'bg-[#5BA5ED]/12 text-[#4a8cca]',
  },
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
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(contactMessages)
      .where(notLike(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`))
    return rows[0]?.count ?? 0
  } catch (error) {
    console.error('Failed to load contact count:', error)
    return 0
  }
}

async function getSuggestionsCount() {
  try {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(contactMessages)
      .where(like(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`))
    return rows[0]?.count ?? 0
  } catch (error) {
    console.error('Failed to load suggestions count:', error)
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
  activeTab,
  days,
  topActions,
  children,
}: AdminConsoleLayoutProps) {
  const [waitlistBadge, usersCount, contactCount, suggestionsCount, crashes24hCount] = await Promise.all([
    getWaitlistBadgeData(),
    getUsersCount(),
    getContactCount(),
    getSuggestionsCount(),
    getCrashes24hCount(),
  ])
  const activeDatabaseTarget = getActiveDatabaseTarget()
  const activeDatabase = listDatabaseTargets().find((entry) => entry.target === activeDatabaseTarget) ?? null
  const tabsById = new Map(ADMIN_TABS.map((tab) => [tab.id, tab]))

  const renderTabLink = (tabId: AdminTab) => {
    const tab = tabsById.get(tabId)
    if (!tab) return null
    const isActive = tab.id === activeTab

    return (
      <Link
        key={tab.id}
        href={buildAdminDayFilterHref(tab.href, days, tab.dayFilters ?? [])}
        aria-current={isActive ? 'page' : undefined}
        className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 border-b-2 px-1.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
          isActive
            ? tab.activeClass
            : `border-transparent text-[#8a8075] ${tab.hoverClass}`
        }`}
      >
        {tab.label}
        {tab.id === 'waitlist' ? (
          <span
            title="Total waitlist signups"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? tab.activeBadgeClass
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
                ? tab.activeBadgeClass
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
                ? tab.activeBadgeClass
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {contactCount}
          </span>
        ) : null}
        {tab.id === 'suggestions' ? (
          <span
            title="Total market suggestions"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? tab.activeBadgeClass
                : 'bg-[#f3ebe0] text-[#8a8075]'
            }`}
          >
            {suggestionsCount}
          </span>
        ) : null}
        {tab.id === 'crashes' ? (
          <span
            title="Crash events in last 24 hours"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive
                ? tab.activeBadgeClass
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
      <WhiteNavbar
        bgClass="bg-[#F5F2ED]/80"
        borderClass="border-[#e8ddd0]"
        adminRuntimeLabel={activeDatabase?.label ?? null}
        forceAdminBadges
      />

      <main className={`${SITE_CONTAINER_CLASS} py-5`}>
        <header className="mb-7">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#b5aa9e]">Admin</p>
            <HeaderDots />
          </div>
          <nav
            aria-label={`${title} admin sections`}
            className="admin-tabs-scroll flex overflow-x-auto border-b border-[#d8ccb9]"
          >
            {ADMIN_TABS.map((tab) => renderTabLink(tab.id))}
          </nav>
          {topActions ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {topActions}
            </div>
          ) : null}
        </header>

        {children}
      </main>

      <div className={SITE_CONTAINER_CLASS}>
        <FooterGradientRule />
      </div>
    </PageFrame>
  )
}
