import Link from 'next/link'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { PublicNavbar } from '@/components/site/PublicNavbar'
import type { Season4MarketSummary } from '@/lib/season4-market-data'

function formatPercent(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function formatCloseTime(value: string | null): string {
  if (!value) return 'No close time'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function statusLabel(market: Season4MarketSummary): string {
  if (market.status === 'resolved' && market.resolvedOutcome) {
    return `Resolved ${market.resolvedOutcome}`
  }

  if (market.status === 'closed') return 'Closed'
  if (market.status === 'deployed') return 'Live'
  return market.status
}

export function Season4HomePage({
  chainName,
  markets,
  selectedTab = 'live',
}: {
  chainName: string
  markets: Season4MarketSummary[]
  selectedTab?: 'live' | 'resolved'
}) {
  const filteredMarkets = selectedTab === 'resolved'
    ? markets.filter((market) => market.status === 'resolved')
    : markets.filter((market) => market.status !== 'resolved' && market.status !== 'archived')
  const featuredMarket = filteredMarkets[0] ?? null

  return (
    <PageFrame>
      <PublicNavbar />

      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 15% 50%, #f2544e, transparent), radial-gradient(ellipse 50% 50% at 40% 40%, #f2c306, transparent), radial-gradient(ellipse 50% 50% at 60% 60%, #40bd4b, transparent), radial-gradient(ellipse 50% 50% at 85% 40%, #299bff, transparent)',
          }}
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-6 pt-10 sm:px-6 sm:pb-10 sm:pt-20">
          <div className="flex gap-6 sm:gap-8">
            <div className="hidden w-px shrink-0 self-stretch sm:block">
              <div className="h-full w-px bg-[linear-gradient(180deg,#EF6F67,#5DBB63,#D39D2E,#5BA5ED)]" />
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-4xl font-normal tracking-tight leading-[1.08] sm:text-5xl md:text-6xl">
                The{' '}
                <span className="inline-block">prediction market</span>
                <span className="sm:hidden">{' '}</span>
                <br className="hidden sm:block" />
                for{' '}
                <span className="inline-block">clinical trials</span>
                .
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#6c6258] sm:text-lg">
                Season 4 is live on {chainName}. Sign in with Privy, claim the faucet, and trade onchain YES or NO positions from your embedded wallet.
              </p>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6 sm:pb-16 sm:pt-8">
        <section className="mb-16">
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Markets</p>
                  <HeaderDots />
                </div>
                <p className="mt-2 text-sm text-[#7b7064]">
                  Onchain on {chainName}. Mock USDC, sponsored wallet flow, and app-restricted YES/NO positions.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/"
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                    selectedTab === 'live'
                      ? 'bg-[#1a1a1a] text-white'
                      : 'border border-[#e8ddd0] bg-white text-[#8a8075] hover:bg-[#f5eee5] hover:text-[#1a1a1a]'
                  }`}
                >
                  Live
                </Link>
                <Link
                  href="/?tab=resolved"
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                    selectedTab === 'resolved'
                      ? 'bg-[#1a1a1a] text-white'
                      : 'border border-[#e8ddd0] bg-white text-[#8a8075] hover:bg-[#f5eee5] hover:text-[#1a1a1a]'
                  }`}
                >
                  Resolved
                </Link>
              </div>
            </div>

            {featuredMarket ? (
              <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-5 sm:p-6">
                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8a8075]">
                      Featured Market
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-[#1a1a1a] sm:text-3xl">{featuredMarket.title}</h2>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#7b7064]">
                      <span className="rounded-full border border-[#e7dccf] bg-[#f8f4ee] px-2.5 py-1">{statusLabel(featuredMarket)}</span>
                      <span className="rounded-full border border-[#e7dccf] bg-[#f8f4ee] px-2.5 py-1">YES {formatPercent(featuredMarket.priceYes)}</span>
                      <span className="rounded-full border border-[#e7dccf] bg-[#f8f4ee] px-2.5 py-1">{featuredMarket.totalTrades} trades</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-[#7b7064] lg:text-right">
                    <p>Closes {formatCloseTime(featuredMarket.closeTime)}</p>
                    <Link
                      href={`/trials/${encodeURIComponent(featuredMarket.marketSlug)}`}
                      className="inline-flex rounded-sm bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2b2620]"
                    >
                      Open market
                    </Link>
                  </div>
                </div>
              </GradientBorder>
            ) : (
              <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-5 sm:p-6">
                <p className="text-lg font-semibold text-[#1a1a1a]">No season 4 markets match this view yet.</p>
                <p className="mt-2 text-sm text-[#7b7064]">Create the first market from the admin flow, then this board will fill in automatically.</p>
              </GradientBorder>
            )}
          </div>

          <div className="mt-4 rounded-sm border border-[#e8ddd0] bg-white/80">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_auto_auto_auto] gap-4 border-b border-[#e8ddd0] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e] sm:grid">
              <span>Market</span>
              <span className="text-right">YES</span>
              <span className="text-right">Close</span>
              <span className="text-right">Activity</span>
            </div>
            {filteredMarkets.length === 0 ? (
              <div className="px-5 py-6 text-sm text-[#8a8075]">No markets to show in this view yet.</div>
            ) : (
              filteredMarkets.map((market) => (
                <Link
                  key={market.id}
                  href={`/trials/${encodeURIComponent(market.marketSlug)}`}
                  className="group grid gap-3 border-b border-[#e8ddd0] px-5 py-4 transition-colors last:border-b-0 hover:bg-[#f8f3ec]/55 sm:grid-cols-[minmax(0,1.6fr)_auto_auto_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-base font-medium text-[#1a1a1a]">{market.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#7b7064]">
                      <span className="rounded-full border border-[#e7dccf] bg-[#f8f4ee] px-2 py-0.5">{statusLabel(market)}</span>
                      {market.resolvedOutcome ? (
                        <span>{market.resolvedOutcome} settled</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-sm text-[#1a1a1a] sm:text-right">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e] sm:hidden">YES</p>
                    <p className="font-medium">{formatPercent(market.priceYes)}</p>
                  </div>
                  <div className="text-sm text-[#1a1a1a] sm:text-right">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e] sm:hidden">Close</p>
                    <p>{formatCloseTime(market.closeTime)}</p>
                  </div>
                  <div className="text-sm text-[#7b7064] sm:text-right">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e] sm:hidden">Activity</p>
                    <p>{market.totalTrades} trade{market.totalTrades === 1 ? '' : 's'}</p>
                    <p>{market.lastTradeAt ? new Date(market.lastTradeAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No trades yet'}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
