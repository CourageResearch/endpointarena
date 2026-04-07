import { and, desc, gte, inArray } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { db } from '@/lib/db'
import { analyticsEvents } from '@/lib/schema'
import { ensureAnalyticsEventsSchema } from '@/lib/analytics-events'
import {
  ADMIN_ACTIVITY_DAY_FILTERS,
  buildAdminDayFilterHref,
  type PageSearchParams,
  parseAdminDayFilter,
} from '@/lib/admin-search-params'

export const dynamic = 'force-dynamic'

const SEARCH_EVENT_TYPES = ['market_search', 'trial_search'] as const

type SearchRollup = {
  query: string
  count: number
  avgResults: number
  zeroResultCount: number
  lastSearchedAt: Date | null
}

async function getSearchAnalytics(days: number) {
  await ensureAnalyticsEventsSchema()

  const today = new Date()
  const todayUtcMidnight = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ))
  const startUtcMidnight = new Date(todayUtcMidnight)
  startUtcMidnight.setUTCDate(startUtcMidnight.getUTCDate() - (days - 1))

  const rows = await db
    .select()
    .from(analyticsEvents)
    .where(and(
      inArray(analyticsEvents.type, [...SEARCH_EVENT_TYPES]),
      gte(analyticsEvents.createdAt, startUtcMidnight),
    ))
    .orderBy(desc(analyticsEvents.createdAt))

  const searchRows = rows.filter((row) => typeof row.searchQuery === 'string' && row.searchQuery.trim().length > 0)
  const uniqueQueries = new Set(searchRows.map((row) => row.searchQuery!.toLowerCase())).size
  const zeroResultSearches = searchRows.filter((row) => (row.resultCount ?? 0) === 0).length
  const searchesWithResults = searchRows.filter((row) => (row.resultCount ?? 0) > 0).length

  const queryMap = new Map<string, SearchRollup & { totalResults: number }>()
  for (const row of searchRows) {
    const rawQuery = row.searchQuery!.trim()
    const normalizedQuery = rawQuery.toLowerCase()
    const existing = queryMap.get(normalizedQuery)
    const resultCount = Math.max(0, row.resultCount ?? 0)

    if (existing) {
      existing.count += 1
      existing.totalResults += resultCount
      existing.zeroResultCount += resultCount === 0 ? 1 : 0
      if (row.createdAt && (!existing.lastSearchedAt || row.createdAt > existing.lastSearchedAt)) {
        existing.lastSearchedAt = row.createdAt
      }
      continue
    }

    queryMap.set(normalizedQuery, {
      query: rawQuery,
      count: 1,
      avgResults: resultCount,
      totalResults: resultCount,
      zeroResultCount: resultCount === 0 ? 1 : 0,
      lastSearchedAt: row.createdAt ?? null,
    })
  }

  const topQueries = Array.from(queryMap.values())
    .map((entry) => ({
      query: entry.query,
      count: entry.count,
      avgResults: entry.count > 0 ? entry.totalResults / entry.count : 0,
      zeroResultCount: entry.zeroResultCount,
      lastSearchedAt: entry.lastSearchedAt,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return (b.lastSearchedAt?.getTime() ?? 0) - (a.lastSearchedAt?.getTime() ?? 0)
    })
    .slice(0, 25)

  const topZeroResultQueries = topQueries
    .filter((entry) => entry.zeroResultCount > 0)
    .sort((a, b) => {
      if (b.zeroResultCount !== a.zeroResultCount) return b.zeroResultCount - a.zeroResultCount
      return b.count - a.count
    })
    .slice(0, 15)

  const recentSearches = searchRows.slice(0, 50).map((row) => ({
    id: row.id,
    query: row.searchQuery!,
    url: row.url,
    resultCount: Math.max(0, row.resultCount ?? 0),
    createdAt: row.createdAt,
  }))

  return {
    totalSearches: searchRows.length,
    uniqueQueries,
    zeroResultSearches,
    searchesWithResults,
    topQueries,
    topZeroResultQueries,
    recentSearches,
  }
}

function formatWhen(value: Date | null): string {
  if (!value) return 'Unknown'
  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function AdminSearchesPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const days = parseAdminDayFilter(resolvedSearchParams.days, ADMIN_ACTIVITY_DAY_FILTERS, 7)
  const data = await getSearchAnalytics(days)

  return (
    <AdminConsoleLayout
      title="Search Analytics"
      activeTab="searches"
      days={days}
    >
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Summary</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-none border border-[#e8ddd0] bg-white/80 p-3">
            <div className="text-2xl font-bold text-[#1a1a1a]">{data.totalSearches.toLocaleString()}</div>
            <div className="text-xs text-[#8a8075]">Searches</div>
          </div>
          <div className="rounded-none border border-[#5BA5ED]/30 bg-white/80 p-3">
            <div className="text-2xl font-bold text-[#5BA5ED]">{data.uniqueQueries.toLocaleString()}</div>
            <div className="text-xs text-[#5BA5ED]/70">Unique Queries</div>
          </div>
          <div className="rounded-none border border-[#EF6F67]/30 bg-white/80 p-3">
            <div className="text-2xl font-bold text-[#EF6F67]">{data.zeroResultSearches.toLocaleString()}</div>
            <div className="text-xs text-[#EF6F67]/70">Zero-Result Searches</div>
          </div>
          <div className="rounded-none border border-[#3a8a2e]/30 bg-white/80 p-3">
            <div className="text-2xl font-bold text-[#3a8a2e]">{data.searchesWithResults.toLocaleString()}</div>
            <div className="text-xs text-[#3a8a2e]/70">Searches With Results</div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Top Queries</h2>
          <div className="flex flex-wrap gap-2">
            {ADMIN_ACTIVITY_DAY_FILTERS.map((option) => (
              <a
                key={option.value}
                href={buildAdminDayFilterHref('/admin/searches', option.value, ADMIN_ACTIVITY_DAY_FILTERS)}
                className={`rounded-none border px-3 py-1.5 text-sm transition-colors ${
                  days === option.value
                  ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                  : 'border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:bg-white hover:text-[#1a1a1a]'
                }`}
              >
                {option.label}
              </a>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-none border border-[#e8ddd0] bg-white/80">
          {data.topQueries.length === 0 ? (
            <div className="p-4 text-sm text-[#8a8075]">No search data yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Query</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Searches</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Avg Results</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Zero Result</th>
                  <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {data.topQueries.map((entry) => (
                  <tr key={entry.query} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                    <td className="px-4 py-2 text-[#1a1a1a]">{entry.query}</td>
                    <td className="px-4 py-2 text-right text-[#1a1a1a]">{entry.count}</td>
                    <td className="px-4 py-2 text-right text-[#8a8075]">{entry.avgResults.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-[#8a8075]">{entry.zeroResultCount}</td>
                    <td className="px-4 py-2 text-right text-[#8a8075]">{formatWhen(entry.lastSearchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Zero-Result Queries</h2>
          <div className="overflow-hidden rounded-none border border-[#e8ddd0] bg-white/80">
            {data.topZeroResultQueries.length === 0 ? (
              <div className="p-4 text-sm text-[#8a8075]">No zero-result searches in this range.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8ddd0]">
                    <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Query</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Zero Result</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topZeroResultQueries.map((entry) => (
                    <tr key={`zero-${entry.query}`} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                      <td className="px-4 py-2 text-[#1a1a1a]">{entry.query}</td>
                      <td className="px-4 py-2 text-right text-[#EF6F67]">{entry.zeroResultCount}</td>
                      <td className="px-4 py-2 text-right text-[#8a8075]">{entry.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Recent Searches</h2>
          <div className="overflow-hidden rounded-none border border-[#e8ddd0] bg-white/80">
            {data.recentSearches.length === 0 ? (
              <div className="p-4 text-sm text-[#8a8075]">No recent searches yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8ddd0]">
                    <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Query</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Results</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSearches.map((entry) => (
                    <tr key={entry.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                      <td className="px-4 py-2">
                        <div className="text-[#1a1a1a]">{entry.query}</div>
                        <div className="mt-0.5 text-[11px] text-[#8a8075]">{entry.url}</div>
                      </td>
                      <td className="px-4 py-2 text-right text-[#8a8075]">{entry.resultCount}</td>
                      <td className="px-4 py-2 text-right text-[#8a8075]">{formatWhen(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </AdminConsoleLayout>
  )
}
