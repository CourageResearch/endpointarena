import { db } from '@/lib/db'
import { analyticsEvents } from '@/lib/schema'
import { gte, eq, sql, desc, and } from 'drizzle-orm'
import { Navbar } from '@/components/Navbar'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { ADMIN_EMAIL } from '@/lib/constants'

export const dynamic = 'force-dynamic'

async function getAnalyticsData(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const allEvents = await db
    .select()
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, since))

  const pageviews = allEvents.filter(e => e.type === 'pageview')
  const clicks = allEvents.filter(e => e.type === 'click')

  // Unique visitors (distinct sessionHash)
  const uniqueVisitors = new Set(pageviews.map(e => e.sessionHash).filter(Boolean)).size

  // Unique pages
  const uniquePages = new Set(pageviews.map(e => e.url)).size

  // Views per day
  const viewsByDay = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    viewsByDay.set(d.toISOString().slice(0, 10), 0)
  }
  for (const pv of pageviews) {
    if (pv.createdAt) {
      const day = pv.createdAt.toISOString().slice(0, 10)
      viewsByDay.set(day, (viewsByDay.get(day) || 0) + 1)
    }
  }
  const dailyViews = Array.from(viewsByDay.entries()).map(([date, count]) => ({ date, count }))

  // Top pages
  const pageCounts = new Map<string, number>()
  for (const pv of pageviews) {
    pageCounts.set(pv.url, (pageCounts.get(pv.url) || 0) + 1)
  }
  const topPages = Array.from(pageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([url, count]) => ({ url, count, pct: pageviews.length > 0 ? ((count / pageviews.length) * 100).toFixed(1) : '0' }))

  // Top clicked elements
  const clickCounts = new Map<string, { count: number; url: string }>()
  for (const c of clicks) {
    const key = `${c.elementId}||${c.url}`
    const existing = clickCounts.get(key)
    if (existing) {
      existing.count++
    } else {
      clickCounts.set(key, { count: 1, url: c.url })
    }
  }
  const topClicks = Array.from(clickCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([key, val]) => ({
      elementId: key.split('||')[0],
      url: val.url,
      count: val.count,
    }))

  // Top referrers (filter self-referrals)
  const refCounts = new Map<string, number>()
  for (const pv of pageviews) {
    if (pv.referrer && !pv.referrer.includes('endpointarena.com')) {
      refCounts.set(pv.referrer, (refCounts.get(pv.referrer) || 0) + 1)
    }
  }
  const topReferrers = Array.from(refCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([referrer, count]) => ({ referrer, count }))

  // Top countries
  const countryCounts = new Map<string, number>()
  for (const pv of pageviews) {
    if (pv.country) {
      countryCounts.set(pv.country, (countryCounts.get(pv.country) || 0) + 1)
    }
  }
  const topCountries = Array.from(countryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([country, count]) => ({ country, count }))

  // Top cities
  const cityCounts = new Map<string, number>()
  for (const pv of pageviews) {
    if (pv.city) {
      const label = pv.country ? `${pv.city}, ${pv.country}` : pv.city
      cityCounts.set(label, (cityCounts.get(label) || 0) + 1)
    }
  }
  const topCities = Array.from(cityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([city, count]) => ({ city, count }))

  return {
    totalPageViews: pageviews.length,
    uniqueVisitors,
    totalClicks: clicks.length,
    uniquePages,
    dailyViews,
    topPages,
    topClicks,
    topReferrers,
    topCountries,
    topCities,
  }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const params = await searchParams
  const days = params.days === '30' ? 30 : 7
  const data = await getAnalyticsData(days)
  const maxDailyViews = Math.max(...data.dailyViews.map(d => d.count), 1)

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
            <p className="text-zinc-500 text-sm mt-1">
              Page views and click tracking
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/admin/analytics?days=7"
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                days === 7
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300 hover:text-white'
              }`}
            >
              7 days
            </a>
            <a
              href="/admin/analytics?days=30"
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                days === 30
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300 hover:text-white'
              }`}
            >
              30 days
            </a>
            <a
              href="/admin"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
            >
              Back to Admin
            </a>
          </div>
        </div>

        {/* Summary Cards */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
              <div className="text-2xl font-bold text-white">{data.totalPageViews.toLocaleString()}</div>
              <div className="text-zinc-500 text-xs">Page Views</div>
            </div>
            <div className="bg-zinc-900/50 border border-blue-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">{data.uniqueVisitors.toLocaleString()}</div>
              <div className="text-blue-400/60 text-xs">Unique Visitors (approx)</div>
            </div>
            <div className="bg-zinc-900/50 border border-emerald-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-emerald-400">{data.totalClicks.toLocaleString()}</div>
              <div className="text-emerald-400/60 text-xs">Total Clicks</div>
            </div>
            <div className="bg-zinc-900/50 border border-orange-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-orange-400">{data.uniquePages}</div>
              <div className="text-orange-400/60 text-xs">Pages Tracked</div>
            </div>
          </div>
        </section>

        {/* Views Over Time */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Views Over Time</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-end gap-1" style={{ height: '160px' }}>
              {data.dailyViews.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <div
                    className="w-full bg-blue-500 rounded-t min-h-[2px] transition-all hover:bg-blue-400"
                    style={{ height: `${(d.count / maxDailyViews) * 100}%` }}
                  />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    {d.count} views
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-1 mt-2">
              {data.dailyViews.map((d, i) => (
                <div key={d.date} className="flex-1 text-center">
                  {(i === 0 || i === data.dailyViews.length - 1 || i === Math.floor(data.dailyViews.length / 2)) && (
                    <span className="text-zinc-600 text-[10px]">
                      {d.date.slice(5)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Top Pages */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Top Pages</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            {data.topPages.length === 0 ? (
              <div className="p-4 text-zinc-500 text-sm">No pageview data yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left text-zinc-500 font-medium px-4 py-2">Page</th>
                    <th className="text-right text-zinc-500 font-medium px-4 py-2">Views</th>
                    <th className="text-right text-zinc-500 font-medium px-4 py-2">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPages.map(p => (
                    <tr key={p.url} className="border-b border-zinc-800/50">
                      <td className="px-4 py-2 text-zinc-300 font-mono text-xs">{p.url}</td>
                      <td className="px-4 py-2 text-right text-white">{p.count.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-zinc-500">{p.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Top Clicked Elements */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Top Clicked Elements</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            {data.topClicks.length === 0 ? (
              <div className="p-4 text-zinc-500 text-sm">No click data yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left text-zinc-500 font-medium px-4 py-2">Element</th>
                    <th className="text-left text-zinc-500 font-medium px-4 py-2">Page</th>
                    <th className="text-right text-zinc-500 font-medium px-4 py-2">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topClicks.map((c, i) => (
                    <tr key={i} className="border-b border-zinc-800/50">
                      <td className="px-4 py-2 text-zinc-300 font-mono text-xs">{c.elementId}</td>
                      <td className="px-4 py-2 text-zinc-500 font-mono text-xs">{c.url}</td>
                      <td className="px-4 py-2 text-right text-white">{c.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Top Countries & Cities */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Geographic Distribution</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Top Countries */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800 text-zinc-400 text-xs font-medium">Top Countries</div>
              {data.topCountries.length === 0 ? (
                <div className="p-4 text-zinc-500 text-sm">No geographic data yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left text-zinc-500 font-medium px-4 py-2">Country</th>
                      <th className="text-right text-zinc-500 font-medium px-4 py-2">Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCountries.map(c => (
                      <tr key={c.country} className="border-b border-zinc-800/50">
                        <td className="px-4 py-2 text-zinc-300 text-xs">{c.country}</td>
                        <td className="px-4 py-2 text-right text-white">{c.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Top Cities */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800 text-zinc-400 text-xs font-medium">Top Cities</div>
              {data.topCities.length === 0 ? (
                <div className="p-4 text-zinc-500 text-sm">No geographic data yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left text-zinc-500 font-medium px-4 py-2">City</th>
                      <th className="text-right text-zinc-500 font-medium px-4 py-2">Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCities.map(c => (
                      <tr key={c.city} className="border-b border-zinc-800/50">
                        <td className="px-4 py-2 text-zinc-300 text-xs">{c.city}</td>
                        <td className="px-4 py-2 text-right text-white">{c.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* Top Referrers */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Top Referrers</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            {data.topReferrers.length === 0 ? (
              <div className="p-4 text-zinc-500 text-sm">No referrer data yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left text-zinc-500 font-medium px-4 py-2">Referrer</th>
                    <th className="text-right text-zinc-500 font-medium px-4 py-2">Views</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topReferrers.map(r => (
                    <tr key={r.referrer} className="border-b border-zinc-800/50">
                      <td className="px-4 py-2 text-zinc-300 text-xs break-all">{r.referrer}</td>
                      <td className="px-4 py-2 text-right text-white">{r.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
