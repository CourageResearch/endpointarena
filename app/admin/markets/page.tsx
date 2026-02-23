import { asc } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { db, fdaCalendarEvents, predictionMarkets } from '@/lib/db'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminMarketManager } from '@/components/AdminMarketManager'

export const dynamic = 'force-dynamic'

async function getMarketAdminData() {
  const [events, markets] = await Promise.all([
    db.query.fdaCalendarEvents.findMany({
      orderBy: [asc(fdaCalendarEvents.pdufaDate)],
    }),
    db.query.predictionMarkets.findMany(),
  ])

  const marketByEventId = new Map(markets.map((market) => [market.fdaEventId, market]))

  return events.map((event) => {
    const market = marketByEventId.get(event.id)
    const marketStatus: 'OPEN' | 'RESOLVED' | null = market?.status === 'OPEN' || market?.status === 'RESOLVED'
      ? market.status
      : null

    return {
      id: event.id,
      drugName: event.drugName,
      companyName: event.companyName,
      symbols: event.symbols,
      pdufaDate: event.pdufaDate.toISOString(),
      outcome: event.outcome,
      marketStatus,
      marketPriceYes: market?.priceYes ?? null,
    }
  })
}

export default async function AdminMarketsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const events = await getMarketAdminData()
  const openMarkets = events.filter((event) => event.marketStatus === 'OPEN').length
  const resolvedMarkets = events.filter((event) => event.marketStatus === 'RESOLVED').length
  const pendingWithoutMarket = events.filter((event) => event.outcome === 'Pending' && event.marketStatus === null).length
  const pendingWithMarket = events.filter((event) => event.outcome === 'Pending' && event.marketStatus === 'OPEN').length

  return (
    <AdminConsoleLayout
      title="Market Operations"
      description="Open event markets, run the daily cycle, and monitor which events are missing market coverage."
      activeTab="markets"
      topActions={(
        <a
          href="/markets"
          className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
        >
          Public Markets
        </a>
      )}
    >
      <section className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
          <p className="text-xl font-semibold text-[#3a8a2e]">{openMarkets}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Open Markets</p>
        </div>
        <div className="rounded-lg border border-[#b5aa9e]/40 bg-[#f5f2ed] p-3">
          <p className="text-xl font-semibold text-[#8a8075]">{resolvedMarkets}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Resolved Markets</p>
        </div>
        <div className="rounded-lg border border-[#EF6F67]/30 bg-[#EF6F67]/5 p-3">
          <p className="text-xl font-semibold text-[#EF6F67]">{pendingWithoutMarket}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Pending, No Market</p>
        </div>
        <div className="rounded-lg border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{pendingWithMarket}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Pending, Open Market</p>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Manage Markets</h2>
        <p className="text-sm text-[#8a8075] mt-1">Run the cycle first, then open missing markets for pending events.</p>
      </section>

      <AdminMarketManager events={events} />
    </AdminConsoleLayout>
  )
}
