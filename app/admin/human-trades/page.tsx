import Link from 'next/link'
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { db, fdaCalendarEvents, marketActions, marketActors, predictionMarkets, users } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const ACTION_FILTERS = ['ALL', 'BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'] as const
const STATUS_FILTERS = ['ALL', 'ok', 'error', 'skipped'] as const

type ActionFilter = (typeof ACTION_FILTERS)[number]
type StatusFilter = (typeof STATUS_FILTERS)[number]
type SearchParamValue = string | string[] | undefined
type PageSearchParams = Record<string, SearchParamValue>

function firstSearchParam(value: SearchParamValue): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }
  return typeof value === 'string' ? value : ''
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

function parseDateInputUtc(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function parseActionFilter(value: string): ActionFilter {
  return ACTION_FILTERS.includes(value as ActionFilter) ? (value as ActionFilter) : 'ALL'
}

function parseStatusFilter(value: string): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : 'ALL'
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatSignedNumber(value: number): string {
  const abs = Math.abs(value)
  return `${value >= 0 ? '+' : '-'}${abs.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
}

function buildFilters({
  q,
  action,
  status,
  fromDate,
  toDateEnd,
}: {
  q: string
  action: ActionFilter
  status: StatusFilter
  fromDate: Date | null
  toDateEnd: Date | null
}): SQL[] {
  const conditions: SQL[] = [
    eq(marketActors.actorType, 'human'),
    eq(marketActions.actionSource, 'human'),
  ]

  if (action !== 'ALL') {
    conditions.push(eq(marketActions.action, action))
  }

  if (status !== 'ALL') {
    conditions.push(eq(marketActions.status, status))
  }

  if (fromDate) {
    conditions.push(gte(marketActions.createdAt, fromDate))
  }

  if (toDateEnd) {
    conditions.push(lte(marketActions.createdAt, toDateEnd))
  }

  if (q.length > 0) {
    const pattern = `%${q}%`
    conditions.push(sql`(
      ${users.email} ILIKE ${pattern}
      OR ${users.xUsername} ILIKE ${pattern}
      OR ${users.name} ILIKE ${pattern}
      OR ${marketActions.actorId} ILIKE ${pattern}
      OR ${marketActors.displayName} ILIKE ${pattern}
      OR ${fdaCalendarEvents.drugName} ILIKE ${pattern}
      OR ${fdaCalendarEvents.companyName} ILIKE ${pattern}
    )`)
  }

  return conditions
}

function buildPageHref({
  page,
  q,
  action,
  status,
  from,
  to,
}: {
  page: number
  q: string
  action: ActionFilter
  status: StatusFilter
  from: string
  to: string
}): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (action !== 'ALL') params.set('action', action)
  if (status !== 'ALL') params.set('status', status)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/human-trades?${query}` : '/admin/human-trades'
}

export default async function AdminHumanTradesPage({
  searchParams,
}: {
  searchParams?: PageSearchParams | Promise<PageSearchParams>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const q = firstSearchParam(resolvedSearchParams.q).trim().slice(0, 100)
  const action = parseActionFilter(firstSearchParam(resolvedSearchParams.action))
  const status = parseStatusFilter(firstSearchParam(resolvedSearchParams.status))
  const from = firstSearchParam(resolvedSearchParams.from)
  const to = firstSearchParam(resolvedSearchParams.to)
  const requestedPage = parsePositiveInt(firstSearchParam(resolvedSearchParams.page), 1)

  const fromDate = parseDateInputUtc(from)
  const toDateStart = parseDateInputUtc(to)
  const toDateEnd = toDateStart
    ? new Date(toDateStart.getTime() + (24 * 60 * 60 * 1000) - 1)
    : null

  const where = and(...buildFilters({ q, action, status, fromDate, toDateEnd }))

  const [summaryRows, weeklyRows, totalRows] = await Promise.all([
    db
      .select({
        totalTrades: sql<number>`count(*)`,
        uniqueTraders: sql<number>`count(distinct ${marketActions.actorId})`,
        totalVolumeUsd: sql<number>`coalesce(sum(abs(${marketActions.usdAmount})), 0)`,
      })
      .from(marketActions)
      .leftJoin(marketActors, eq(marketActors.id, marketActions.actorId))
      .where(and(
        eq(marketActors.actorType, 'human'),
        eq(marketActions.actionSource, 'human'),
      )),
    db
      .select({
        weeklyTrades: sql<number>`count(*)`,
        weeklyVolumeUsd: sql<number>`coalesce(sum(abs(${marketActions.usdAmount})), 0)`,
      })
      .from(marketActions)
      .leftJoin(marketActors, eq(marketActors.id, marketActions.actorId))
      .where(and(
        eq(marketActors.actorType, 'human'),
        eq(marketActions.actionSource, 'human'),
        gte(marketActions.createdAt, new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))),
      )),
    db
      .select({ count: sql<number>`count(*)` })
      .from(marketActions)
      .leftJoin(marketActors, eq(marketActors.id, marketActions.actorId))
      .leftJoin(users, eq(users.id, marketActors.userId))
      .leftJoin(fdaCalendarEvents, eq(fdaCalendarEvents.id, marketActions.fdaEventId))
      .where(where),
  ])

  const totalCount = Number(totalRows[0]?.count ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * PAGE_SIZE

  const rows = await db
    .select({
      id: marketActions.id,
      createdAt: marketActions.createdAt,
      actorId: marketActions.actorId,
      action: marketActions.action,
      status: marketActions.status,
      usdAmount: marketActions.usdAmount,
      sharesDelta: marketActions.sharesDelta,
      priceBefore: marketActions.priceBefore,
      priceAfter: marketActions.priceAfter,
      explanation: marketActions.explanation,
      marketId: marketActions.marketId,
      userEmail: users.email,
      userName: users.name,
      userXUsername: users.xUsername,
      actorDisplayName: marketActors.displayName,
      drugName: fdaCalendarEvents.drugName,
      companyName: fdaCalendarEvents.companyName,
      pdufaDate: fdaCalendarEvents.pdufaDate,
      marketStatus: predictionMarkets.status,
    })
    .from(marketActions)
    .leftJoin(marketActors, eq(marketActors.id, marketActions.actorId))
    .leftJoin(users, eq(users.id, marketActors.userId))
    .leftJoin(fdaCalendarEvents, eq(fdaCalendarEvents.id, marketActions.fdaEventId))
    .leftJoin(predictionMarkets, eq(predictionMarkets.id, marketActions.marketId))
    .where(where)
    .orderBy(desc(marketActions.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset)

  const summary = summaryRows[0]
  const weekly = weeklyRows[0]
  const previousHref = page > 1
    ? buildPageHref({ page: page - 1, q, action, status, from, to })
    : null
  const nextHref = page < totalPages
    ? buildPageHref({ page: page + 1, q, action, status, from, to })
    : null

  return (
    <AdminConsoleLayout
      title="Human Trades"
      description="Review all manually submitted trades from verified human users."
      activeTab="humanTrades"
    >
      <section className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{Number(summary?.totalTrades ?? 0).toLocaleString()}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">All Trades</p>
        </div>
        <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
          <p className="text-xl font-semibold text-[#3a8a2e]">{Number(summary?.uniqueTraders ?? 0).toLocaleString()}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Unique Traders</p>
        </div>
        <div className="rounded-none border border-[#b5aa9e]/40 bg-[#f5f2ed] p-3">
          <p className="text-xl font-semibold text-[#8a8075]">{formatMoney(Number(summary?.totalVolumeUsd ?? 0))}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">All-Time Volume</p>
        </div>
        <div className="rounded-none border border-[#D39D2E]/30 bg-[#D39D2E]/5 p-3">
          <p className="text-xl font-semibold text-[#D39D2E]">{formatMoney(Number(weekly?.weeklyVolumeUsd ?? 0))}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">
            Volume (Last 7d) • {Number(weekly?.weeklyTrades ?? 0).toLocaleString()} trades
          </p>
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <form action="/admin/human-trades" method="get" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] mb-1">
              Search
            </label>
            <input
              name="q"
              defaultValue={q}
              placeholder="Email, @username, drug, company, actor id"
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none focus:border-[#c8b7a2]"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] mb-1">
              Action
            </label>
            <select
              name="action"
              defaultValue={action}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#c8b7a2]"
            >
              {ACTION_FILTERS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] mb-1">
              Status
            </label>
            <select
              name="status"
              defaultValue={status}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#c8b7a2]"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] mb-1">
              From (UTC)
            </label>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#c8b7a2]"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] mb-1">
              To (UTC)
            </label>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#c8b7a2]"
            />
          </div>

          <div className="md:col-span-2 lg:col-span-6 flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-none border border-[#1a1a1a] bg-[#1a1a1a] px-3 text-xs font-medium text-white transition-colors hover:bg-black"
            >
              Apply Filters
            </button>
            <Link
              href="/admin/human-trades"
              className="inline-flex h-9 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-3 text-xs font-medium text-[#8a8075] transition-colors hover:text-[#1a1a1a]"
            >
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Human Trade Log</h2>
          <p className="text-xs text-[#8a8075]">
            Page {page} of {totalPages} • {totalCount.toLocaleString()} matching rows
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No human trades match the current filters.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Time (UTC)</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">User</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Event</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Action</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">USD</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Shares Δ</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Price B/A</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Explanation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const createdAtLabel = row.createdAt
                    ? row.createdAt.toLocaleString('en-US', {
                      timeZone: 'UTC',
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                    })
                    : 'Unknown'
                  const statusClass = row.status === 'ok'
                    ? 'text-[#3a8a2e]'
                    : row.status === 'error'
                      ? 'text-[#c24f45]'
                      : 'text-[#8a8075]'

                  return (
                    <tr key={row.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                      <td className="px-3 py-2 text-[#8a8075] whitespace-nowrap">{createdAtLabel}</td>
                      <td className="px-3 py-2 text-[#1a1a1a]">
                        <p>{row.userEmail ?? row.userName ?? 'Unknown user'}</p>
                        <p className="text-xs text-[#8a8075] mt-0.5">
                          {row.userXUsername ? `@${row.userXUsername}` : row.actorDisplayName ?? row.actorId}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-[#1a1a1a]">
                        <p>{row.drugName ?? 'Unknown event'}</p>
                        <p className="text-xs text-[#8a8075] mt-0.5">
                          {row.companyName ?? '—'} {row.pdufaDate ? `• PDUFA ${row.pdufaDate.toLocaleDateString('en-US', { timeZone: 'UTC' })}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-[#1a1a1a] whitespace-nowrap">{row.action}</td>
                      <td className="px-3 py-2 text-right text-[#1a1a1a] whitespace-nowrap">{formatMoney(row.usdAmount)}</td>
                      <td className="px-3 py-2 text-right text-[#8a8075] whitespace-nowrap">{formatSignedNumber(row.sharesDelta)}</td>
                      <td className="px-3 py-2 text-right text-[#8a8075] whitespace-nowrap">
                        {(row.priceBefore * 100).toFixed(1)}% → {(row.priceAfter * 100).toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap font-medium ${statusClass}`}>{row.status}</td>
                      <td className="px-3 py-2 text-[#8a8075] max-w-[32rem]">
                        <p className="line-clamp-2">{row.explanation || '—'}</p>
                        <p className="text-xs mt-0.5">
                          Market {row.marketId.slice(0, 8)} • {row.marketStatus ?? 'Unknown'}
                        </p>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-[#8a8075]">Showing up to {PAGE_SIZE} rows per page</p>
          <div className="flex items-center gap-2">
            {previousHref ? (
              <Link
                href={previousHref}
                className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:text-[#1a1a1a]"
              >
                Previous
              </Link>
            ) : (
              <span className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-[#f7f2eb] px-2.5 text-xs font-medium text-[#b5aa9e]">
                Previous
              </span>
            )}

            {nextHref ? (
              <Link
                href={nextHref}
                className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:text-[#1a1a1a]"
              >
                Next
              </Link>
            ) : (
              <span className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-[#f7f2eb] px-2.5 text-xs font-medium text-[#b5aa9e]">
                Next
              </span>
            )}
          </div>
        </div>
      </section>
    </AdminConsoleLayout>
  )
}
