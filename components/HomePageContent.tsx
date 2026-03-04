import Link from 'next/link'
import { BW2UpcomingRow, BW2MobileUpcomingCard } from '@/app/rows'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MODEL_DISPLAY_NAMES, type ModelVariant } from '@/lib/constants'
import type { HomeData } from '@/lib/home-data'
import { FooterGradientRule, HeaderDots, PageFrame, SquareDivider } from '@/components/site/chrome'
import { BrandDirectionMark } from '@/components/site/BrandDirectionMark'
import { HomeMarketsClient } from '@/components/HomeMarketsClient'

const HOMEPAGE_MONEY_BY_MODEL: Record<ModelVariant, number> = {
  gpt: 115262,
  gemini: 110112,
  grok: 109802,
  claude: 109314,
}

const HOMEPAGE_RANK_ORDER: ModelVariant[] = ['gpt', 'gemini', 'grok', 'claude']
const HOMEPAGE_RANK_COLORS = ['#EF6F67', '#5DBB63', '#D39D2E', '#5BA5ED'] as const

function UpcomingLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 px-1 text-[11px] text-[#8a8075]">
      <span className="flex items-center gap-1.5">
        <BrandDirectionMark direction="up" className="h-3.5 w-3.5" /> Predicts Approval
      </span>
      <span className="flex items-center gap-1.5">
        <BrandDirectionMark direction="down" className="h-3.5 w-3.5" /> Predicts Rejection
      </span>
    </div>
  )
}

export function HomePageContent({ data }: { data: HomeData }) {
  const { leaderboard, upcomingFdaEvents } = data
  const leaderboardById = new Map(leaderboard.map((entry) => [entry.id, entry]))
  const homeLeaderboard = HOMEPAGE_RANK_ORDER.map((id, index) => {
    const stats = leaderboardById.get(id)
    return {
      id,
      rank: index + 1,
      rankColor: HOMEPAGE_RANK_COLORS[index],
      money: HOMEPAGE_MONEY_BY_MODEL[id],
      accuracy: stats && stats.total > 0 ? stats.accuracy : null,
    }
  })

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      {/* ── 1. HERO ── */}
      <section className="relative overflow-hidden">
        {/* Soft gradient wash */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 15% 50%, #f2544e, transparent), radial-gradient(ellipse 50% 50% at 40% 40%, #f2c306, transparent), radial-gradient(ellipse 50% 50% at 60% 60%, #40bd4b, transparent), radial-gradient(ellipse 50% 50% at 85% 40%, #299bff, transparent)',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-10 sm:pb-16">
          <div className="flex gap-6 sm:gap-8">
            {/* Left vertical accent rule */}
            <div className="hidden sm:block w-[2px] shrink-0 rounded-full self-stretch" style={{ background: 'linear-gradient(180deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }} />
            <div className="min-w-0">
              <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-normal tracking-tight leading-[1.08] mb-5">
                The{' '}
                <span className="relative inline-block">
                  <span className="relative z-10">prediction market</span>
                  <span className="absolute inset-0 -inset-x-1 bottom-[0.1em] top-[0.55em] bg-[#D39D2E]/15 -skew-x-1 rounded-sm" />
                </span>
                <br className="hidden sm:block" />
                for{' '}
                <span className="relative inline-block">
                  <span className="relative z-10">FDA outcomes</span>
                  <span className="absolute inset-0 -inset-x-1 bottom-[0.1em] top-[0.55em] bg-[#D39D2E]/15 -skew-x-1 rounded-sm" />
                </span>
                .
              </h1>
              <p className="text-[#8a8075] text-base sm:text-lg max-w-xl leading-relaxed">
                Accelerate science with frontier AI models and people predicting FDA outcomes.
              </p>
            </div>
          </div>
        </div>

      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">

        {/* ── 2. LEADERBOARD ── */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Leaderboard</h2>
              <HeaderDots />
            </div>
            <Link href="/leaderboard" className="text-xs text-[#b5aa9e] hover:text-[#1a1a1a] transition-colors">Full stats →</Link>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm">
              <div className="hidden sm:grid grid-cols-[1fr_190px_130px] px-6 py-2.5 text-[10px] uppercase tracking-[0.2em] text-[#b5aa9e] border-b border-[#e8ddd0]">
                <div>Model</div>
                <div className="text-right">Net Return</div>
                <div className="text-right">% Correct</div>
              </div>
              <div className="divide-y divide-[#e8ddd0] border-t border-[#e8ddd0] sm:border-t-0">
                {homeLeaderboard.map((model) => {
                  return (
                    <div
                      key={model.id}
                      className="group relative px-4 sm:px-6 py-4 sm:py-5 hover:bg-[#f3ebe0]/30 transition-colors duration-150"
                    >
                      <div
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        style={{ backgroundColor: model.rankColor }}
                      />

                      <div className="flex items-center gap-3 sm:grid sm:grid-cols-[1fr_190px_130px] sm:gap-0 sm:items-center">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          <span className="text-base sm:text-lg font-mono shrink-0" style={{ color: model.rankColor }}>
                            #{model.rank}
                          </span>
                          <div className="w-4 h-4 sm:w-5 sm:h-5 text-[#8a8075] shrink-0 transition-transform duration-150 group-hover:scale-[1.03]">
                            <ModelIcon id={model.id} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm sm:text-base text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111]">
                              {MODEL_DISPLAY_NAMES[model.id]}
                            </div>
                          </div>
                        </div>

                        <div className="ml-auto sm:ml-0 text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                          <div className="text-xl sm:text-2xl font-mono tracking-tight text-[#8a8075]">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              maximumFractionDigits: 0,
                            }).format(model.money)}
                          </div>
                        </div>

                        <div className="hidden sm:block text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                          <div className="text-xl sm:text-2xl font-mono tracking-tight text-[#8a8075]">
                            {model.accuracy !== null ? `${model.accuracy.toFixed(0)}%` : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 sm:hidden text-xs text-[#8a8075] text-right">
                        % Correct: <span>{model.accuracy !== null ? `${model.accuracy.toFixed(0)}%` : '—'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <SquareDivider className="mb-16" />

        {/* ── 3. OPEN MARKETS ── */}
        <section className="mb-16">
          <HomeMarketsClient detailBasePath="/markets" headerLinkHref="/markets" headerLinkLabel="View all →" />
        </section>

        <SquareDivider className="mb-16" />


        {/* ── 4. UPCOMING ── */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Upcoming Decisions</h2>
              <HeaderDots />
            </div>
            <Link href="/fda-calendar" className="text-xs text-[#b5aa9e] hover:text-[#1a1a1a] transition-colors">View all →</Link>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
          <div className="bg-white/95 rounded-sm">
            {/* Mobile */}
            <div className="sm:hidden divide-y divide-[#e8ddd0]">
              {upcomingFdaEvents.map((event) => (
                <div key={event.id} className="p-4">
                  <BW2MobileUpcomingCard event={event as any} />
                </div>
              ))}
              {upcomingFdaEvents.length === 0 && (
                <div className="py-8 text-center text-[#b5aa9e]">No upcoming decisions</div>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto overscroll-x-contain [&_tr]:border-[#e8ddd0] [&_td]:text-[#8a8075] [&_td]:py-5 [&_tr:hover]:bg-[#f3ebe0]/30">
              <table className="w-full table-fixed min-w-[640px]">
                <colgroup>
                  <col style={{width: '60px'}} />
                  <col style={{width: '130px'}} />
                  <col style={{width: '250px'}} />
                  <col style={{width: '60px'}} />
                  <col style={{width: '65px'}} />
                  <col style={{width: '90px'}} />
                  <col style={{width: '50px'}} />
                  <col style={{width: '50px'}} />
                  <col style={{width: '50px'}} />
                  <col style={{width: '50px'}} />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                    <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                    <th className="text-left px-3 py-3 font-medium">Drug</th>
                    <th className="text-left px-3 py-3 font-medium">Event</th>
                    <th className="text-left px-3 py-3 font-medium">Type</th>
                    <th className="text-left px-3 py-3 font-medium">Ticker</th>
                    <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-[#8a8075]" title="FDA"><FDAIcon /></div></th>
                    <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-[#8a8075]" title="Claude Opus 4.6"><ModelIcon id="claude" /></div></th>
                    <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-[#8a8075]" title="GPT-5.2"><ModelIcon id="gpt" /></div></th>
                    <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-[#8a8075]" title="Grok 4.1"><ModelIcon id="grok" /></div></th>
                    <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-[#8a8075]" title="Gemini 2.5 Pro"><ModelIcon id="gemini" /></div></th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingFdaEvents.map((event) => (
                    <BW2UpcomingRow key={event.id} event={event as any} />
                  ))}
                  {upcomingFdaEvents.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-[#b5aa9e]">No upcoming decisions</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </div>{/* close gradient border wrapper */}
          <UpcomingLegend />
        </section>

        {/* ── 6. FOOTER ── */}
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
