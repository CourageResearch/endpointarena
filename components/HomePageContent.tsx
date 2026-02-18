import Link from 'next/link'
import { BW2UpcomingRow, BW2PastRow, BW2MobileUpcomingCard, BW2MobilePastCard } from '@/app/rows'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MODEL_SHORT_NAMES, MODEL_DISPLAY_NAMES, MODEL_VARIANT_COLORS, type ModelVariant } from '@/lib/constants'
import { HeroSquares } from '@/components/HeroSquares'
import type { HomeData } from '@/lib/home-data'

/* ── Band-themed decorative elements ── */

const SQ_COLORS = ['#f2544e', '#40bd4b', '#d4a017', '#299bff', '#31b8b5']

/** A sparse row of uniform colored squares — used between sections */
function SquareDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`w-full ${className}`}>
      <svg className="w-full" height="8" preserveAspectRatio="none">
        <rect x="20%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[0]} opacity="0.8" />
        <rect x="35%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[1]} opacity="0.8" />
        <rect x="50%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[2]} opacity="0.85" />
        <rect x="65%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[3]} opacity="0.8" />
        <rect x="80%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[4]} opacity="0.8" />
      </svg>
    </div>
  )
}

/** Tiny colored square trio that sits next to section header labels */
function HeaderDots() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#D4604A', opacity: 0.8 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#C9A227', opacity: 0.85 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#2D7CF6', opacity: 0.8 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#8E24AA', opacity: 0.8 }} />
    </div>
  )
}

function UpcomingLegend() {
  return (
    <div className="flex items-center justify-end gap-5 px-4 py-2.5 text-[11px] text-[#8a8075] border-t border-[#e8ddd0]">
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium" style={{ color: '#3a8a2e' }}>↑</span> Predicts Approval
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium" style={{ color: '#c43a2b' }}>↓</span> Predicts Rejection
      </span>
    </div>
  )
}

function PastLegend() {
  return (
    <div className="flex items-center justify-end gap-5 px-4 py-2.5 text-[11px] text-[#8a8075] border-t border-[#e8ddd0]">
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium" style={{ color: '#3a8a2e' }}>✓</span> Correct Prediction
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium" style={{ color: '#c43a2b' }}>✗</span> Incorrect Prediction
      </span>
    </div>
  )
}

export function HomePageContent({ data }: { data: HomeData }) {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions } = data

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">
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

        <HeroSquares variant="bands-edge" />


        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-10 sm:pb-16">
          <div className="flex gap-6 sm:gap-8">
            {/* Left vertical accent rule */}
            <div className="hidden sm:block w-[3px] shrink-0 rounded-full self-stretch" style={{ background: 'linear-gradient(180deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }} />
            <div>
              <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-normal tracking-tight leading-[1.08] mb-5">
                The{' '}
                <span className="relative inline-block">
                  <span className="relative z-10">AI</span>
                  <span className="absolute inset-0 -inset-x-1 bottom-[0.1em] top-[0.55em] bg-[#C9A227]/15 -skew-x-1 rounded-sm" />
                </span>
                {' '}benchmark for{' '}
                <span className="relative inline-block">
                  <span className="relative z-10">real-world</span>
                  <span className="absolute inset-0 -inset-x-1 bottom-[0.1em] top-[0.55em] bg-[#C9A227]/15 -skew-x-1 rounded-sm" />
                </span>
                <br className="hidden sm:block" />
                FDA predictions.
              </h1>
              <p className="text-[#8a8075] text-base sm:text-lg max-w-xl leading-relaxed">
                A live test of whether frontier AI models can reason about biomedical science and predict real regulatory outcomes.
              </p>
            </div>
          </div>
        </div>

        {/* Gradient accent line */}
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }} />
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
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }}>
            <div className="bg-white/95 rounded-sm divide-y divide-[#e8ddd0]">
              {leaderboard.map((model, i) => {
                const color = MODEL_VARIANT_COLORS[model.id]
                const decided = model.total
                const barWidth = model.total > 0 ? model.accuracy : 0
                return (
                  <div key={model.id} className="px-4 sm:px-8 py-5 sm:py-6 hover:bg-[#f3ebe0]/30 transition-colors">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 text-[#8a8075] shrink-0">
                        <ModelIcon id={model.id} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sm:text-base text-[#1a1a1a]">{MODEL_DISPLAY_NAMES[model.id]}</div>
                        <div className="text-xs text-[#b5aa9e]">{model.correct}/{model.total} correct</div>
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                        <span className="text-2xl sm:text-3xl font-mono tracking-tight text-[#1a1a1a]">
                          {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                        </span>
                        <div className="hidden sm:block w-24 h-[3px] bg-[#e8ddd0] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
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
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }}>
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
            <div className="hidden sm:block overflow-x-auto [&_tr]:border-[#e8ddd0] [&_td]:text-[#8a8075] [&_td]:py-5 [&_tr:hover]:bg-[#f3ebe0]/30">
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
            <UpcomingLegend />
          </div>
          </div>{/* close gradient border wrapper */}
        </section>

        <SquareDivider className="mb-16" />

        {/* ── 5. PAST ── */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Past Decisions</h2>
              <HeaderDots />
            </div>
            <Link href="/fda-calendar" className="text-xs text-[#b5aa9e] hover:text-[#1a1a1a] transition-colors">View all →</Link>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }}>
          <div className="bg-white/95 rounded-sm">
            {/* Mobile */}
            <div className="sm:hidden divide-y divide-[#e8ddd0]">
              {recentFdaDecisions.map((event) => (
                <div key={event.id} className="p-4">
                  <BW2MobilePastCard event={event as any} />
                </div>
              ))}
              {recentFdaDecisions.length === 0 && (
                <div className="py-8 text-center text-[#b5aa9e]">No decisions yet</div>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto [&_tr]:border-[#e8ddd0] [&_td]:text-[#8a8075] [&_td]:py-5 [&_tr:hover]:bg-[#f3ebe0]/30">
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
                  {recentFdaDecisions.map((event) => (
                    <BW2PastRow key={event.id} event={event as any} />
                  ))}
                  {recentFdaDecisions.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-[#b5aa9e]">No decisions yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <PastLegend />
          </div>
          </div>{/* close gradient border wrapper */}
        </section>

        {/* ── 6. FOOTER ── */}
        <SquareDivider className="mb-0" />
      </main>
    </div>
  )
}
