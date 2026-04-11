import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { sql } from 'drizzle-orm'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import {
  FooterGradientRule,
  GradientBorder,
  HeaderDots,
  PageFrame,
  SquareDivider,
} from '@/components/site/chrome'
import { db, modelDecisionSnapshots, trialQuestions } from '@/lib/db'
import { MODEL_IDS } from '@/lib/constants'
import { getLeaderboardData } from '@/lib/leaderboard-data'
import { formatShortDateUtc, type OpenMarketRow } from '@/lib/markets/overview-shared'
import { buildNoIndexMetadata } from '@/lib/seo'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { PrintDeckButton } from './PrintDeckButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Investor Teaser',
  description: 'A five-slide investor teaser for Endpoint Arena as a signal terminal for biotech trial event risk.',
  path: '/deck',
})

type MetricCardTone = 'neutral' | 'coral' | 'green' | 'gold' | 'blue'

function getForecastSplit(market: OpenMarketRow) {
  let yesCount = 0
  let noCount = 0
  let pendingCount = 0

  for (const state of market.modelStates) {
    const binaryCall = state.latestDecision?.forecast.binaryCall
    if (binaryCall === 'yes') {
      yesCount += 1
      continue
    }
    if (binaryCall === 'no') {
      noCount += 1
      continue
    }
    pendingCount += 1
  }

  return {
    yesCount,
    noCount,
    pendingCount,
    activeCount: yesCount + noCount,
  }
}

function getSignalLabel(market: OpenMarketRow): string {
  const split = getForecastSplit(market)
  if (split.activeCount === 0) return 'Awaiting first runs'
  if (split.yesCount === split.noCount) return 'Models are split'
  if (split.yesCount > split.noCount) return 'Models lean yes'
  return 'Models lean no'
}

function getBalancedDisagreementScore(market: OpenMarketRow): number {
  const split = getForecastSplit(market)
  if (split.activeCount === 0) return 0
  return 1 - Math.abs(split.yesCount - split.noCount) / split.activeCount
}

function toneClasses(tone: MetricCardTone): string {
  switch (tone) {
    case 'coral':
      return 'border-[#ef6f67]/35 bg-[#ef6f67]/8'
    case 'green':
      return 'border-[#5dbb63]/35 bg-[#5dbb63]/8'
    case 'gold':
      return 'border-[#d39d2e]/35 bg-[#d39d2e]/8'
    case 'blue':
      return 'border-[#5ba5ed]/35 bg-[#5ba5ed]/8'
    default:
      return 'border-[#e8ddd0] bg-white/88'
  }
}

function Eyebrow({
  label,
  value,
}: {
  label: string
  value?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">{label}</span>
      <HeaderDots />
      {value ? (
        <span className="text-[11px] uppercase tracking-[0.18em] text-[#8a8075]">{value}</span>
      ) : null}
    </div>
  )
}

function Slide({
  number,
  title,
  subtitle,
  children,
}: {
  number: string
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <GradientBorder
      className="investor-slide"
      innerClassName="investor-slide-inner relative overflow-hidden border border-transparent bg-white/94 p-6 sm:p-8 lg:p-10"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 60% 60% at 15% 20%, #ef6f67, transparent), radial-gradient(ellipse 55% 55% at 82% 18%, #5ba5ed, transparent), radial-gradient(ellipse 50% 50% at 55% 88%, #5dbb63, transparent)',
        }}
      />

      <div className="relative flex h-full flex-col">
        <div className="mb-8 space-y-4">
          <Eyebrow label={`Slide ${number}`} value="Investor teaser" />
          <div className="max-w-4xl space-y-3">
            <h2 className="font-serif text-3xl leading-[1.05] tracking-tight text-[#1a1a1a] sm:text-4xl lg:text-[3.4rem]">
              {title}
            </h2>
            <p className="max-w-3xl text-base leading-relaxed text-[#8a8075] sm:text-lg">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex-1">{children}</div>
      </div>
    </GradientBorder>
  )
}

function MetricCard({
  label,
  category,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  category: string
  value: string
  detail: string
  tone?: MetricCardTone
}) {
  return (
    <div className={`border p-4 ${toneClasses(tone)}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
          {category}
        </span>
        <span className="h-[6px] w-[6px] bg-[#1a1a1a]" aria-hidden="true" />
      </div>
      <div className="text-sm font-medium text-[#1a1a1a]">{label}</div>
      <div className="mt-2 font-mono text-3xl tracking-tight text-[#1a1a1a]">{value}</div>
      <p className="mt-2 text-sm leading-relaxed text-[#8a8075]">{detail}</p>
    </div>
  )
}

function DetailCard({
  title,
  body,
  tone = 'neutral',
}: {
  title: string
  body: string
  tone?: MetricCardTone
}) {
  return (
    <div className={`border p-4 ${toneClasses(tone)}`}>
      <h3 className="text-base font-medium text-[#1a1a1a]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#8a8075]">{body}</p>
    </div>
  )
}

function StepCard({
  step,
  title,
  body,
}: {
  step: string
  title: string
  body: string
}) {
  return (
    <div className="border border-[#e8ddd0] bg-white/88 p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center border border-[#e8ddd0] bg-[#f7f3ee] font-mono text-sm text-[#1a1a1a]">
          {step}
        </div>
        <h3 className="text-base font-medium text-[#1a1a1a]">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-[#8a8075]">{body}</p>
    </div>
  )
}

export default async function InvestorTeaserPage() {
  const [overview, leaderboardData, trialQuestionCountRows, snapshotCountRows] = await Promise.all([
    getTrialsOverviewData({
      includeResolved: true,
      includeAccounts: false,
      includeEquityHistory: false,
      includeRecentRuns: false,
    }),
    getLeaderboardData('first'),
    db.select({ count: sql<number>`count(*)` }).from(trialQuestions),
    db.select({ count: sql<number>`count(*)` }).from(modelDecisionSnapshots),
  ])

  const openMarketCount = overview.openMarkets.length
  const resolvedMarketCount = overview.resolvedMarkets.length
  const trialQuestionCount = Number(trialQuestionCountRows[0]?.count ?? 0)
  const decisionSnapshotCount = Number(snapshotCountRows[0]?.count ?? 0)
  const resolvedPerModel = Math.max(0, ...leaderboardData.leaderboard.map((entry) => entry.decided))
  const pendingPerModel = Math.max(0, ...leaderboardData.leaderboard.map((entry) => entry.pending))
  const modelCount = MODEL_IDS.length

  const productBoardRows = [...overview.openMarkets]
    .sort((left, right) => {
      const volumeGap = (right.totalVolumeUsd ?? 0) - (left.totalVolumeUsd ?? 0)
      if (volumeGap !== 0) return volumeGap
      return String(left.event?.decisionDate ?? '').localeCompare(String(right.event?.decisionDate ?? ''))
    })
    .slice(0, 5)

  const disagreementMarkets = [...overview.openMarkets]
    .map((market) => ({
      market,
      score: getBalancedDisagreementScore(market),
      split: getForecastSplit(market),
    }))
    .filter((item) => item.split.activeCount > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.split.activeCount !== left.split.activeCount) {
        return right.split.activeCount - left.split.activeCount
      }
      return (right.market.totalActionsCount ?? 0) - (left.market.totalActionsCount ?? 0)
    })
    .slice(0, 3)

  const scoringSetLine = resolvedPerModel > 0
    ? `The live leaderboard is still an early scoring set: ${resolvedPerModel} resolved outcomes and ${pendingPerModel} pending per model.`
    : 'The live leaderboard is still mostly pre-resolution, which is useful as execution proof but not yet a mature accuracy claim.'

  return (
    <PageFrame>
      <style>{`
        @media print {
          nav,
          [data-print-hidden="true"] {
            display: none !important;
          }

          body {
            background: #f5f2ed !important;
          }

          .investor-deck-shell {
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }

          .investor-slide {
            margin: 0 !important;
            box-shadow: none !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .investor-slide:not(:last-child) {
            break-after: page;
            page-break-after: always;
          }

          .investor-slide-inner {
            min-height: 10.15in !important;
          }
        }
      `}</style>

      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="investor-deck-shell mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
        <section
          data-print-hidden="true"
          className="mb-8 border border-[#e8ddd0] bg-white/88 p-5 sm:p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Eyebrow label="Endpoint Arena" value="Specialist biotech fund version" />
              <div className="max-w-3xl space-y-2">
                <h1 className="font-serif text-3xl leading-tight tracking-tight text-[#1a1a1a] sm:text-4xl">
                  Investor teaser built around the live trial product.
                </h1>
                <p className="text-base leading-relaxed text-[#8a8075]">
                  This replaces the older FDA one-pager narrative with a five-slide deck for a paid signal terminal
                  focused on biotech trial event-risk.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <PrintDeckButton />
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center border border-[#e8ddd0] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f7f3ee]"
              >
                Open product
              </Link>
            </div>
          </div>
        </section>

        <div className="space-y-8">
          <Slide
            number="1"
            title="A live signal terminal for biotech trial event-risk."
            subtitle="Endpoint Arena gives biotech hedge funds quantified probabilities, model disagreement, and continuously updated trial intelligence before outcomes land."
          >
            <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="space-y-6">
                <div className="border border-[#e8ddd0] bg-[#f7f3ee]/70 p-5">
                  <p className="text-lg leading-relaxed text-[#1a1a1a]">
                    The wedge is simple: replace fragmented catalyst workups with one board that tracks live clinical trial
                    readouts, surfaces model disagreement, and preserves scored history for the next decision.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <MetricCard
                    category="Product scope"
                    label="Open trial markets"
                    value={openMarketCount.toLocaleString('en-US')}
                    detail="Live opportunities already visible on the public product board."
                    tone="coral"
                  />
                  <MetricCard
                    category="Product scope"
                    label="Trial questions tracked"
                    value={trialQuestionCount.toLocaleString('en-US')}
                    detail="A growing trial monitoring set rather than a static research memo."
                    tone="green"
                  />
                  <MetricCard
                    category="Execution proof"
                    label="Models scored side by side"
                    value={modelCount.toLocaleString('en-US')}
                    detail="All models are evaluated on the same structured context and archived over time."
                    tone="gold"
                  />
                  <MetricCard
                    category="Execution proof"
                    label="Current scoring set"
                    value={`${resolvedPerModel}/${pendingPerModel}`}
                    detail={`${resolvedPerModel} resolved and ${pendingPerModel} pending per model. Early proof of system operation, not mature traction.`}
                    tone="blue"
                  />
                </div>
              </div>

              <GradientBorder className="h-full" innerClassName="h-full border border-transparent bg-white/92 p-0">
                <div className="border-b border-[#e8ddd0] px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                        Live trial board
                      </div>
                      <div className="mt-1 text-lg font-medium text-[#1a1a1a]">
                        Current public product core
                      </div>
                    </div>
                    <div className="border border-[#e8ddd0] bg-[#f7f3ee] px-3 py-1 font-mono text-sm text-[#1a1a1a]">
                      {openMarketCount} live
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1.5fr)_auto_auto] gap-3 border-b border-[#e8ddd0] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                  <div>Trial</div>
                  <div>Date</div>
                  <div>AI split</div>
                </div>

                <div className="divide-y divide-[#e8ddd0]">
                  {productBoardRows.map((market) => {
                    const split = getForecastSplit(market)
                    return (
                      <Link
                        key={market.marketId}
                        href={`/trials/${encodeURIComponent(market.marketId)}`}
                        className="grid grid-cols-[minmax(0,1.5fr)_auto_auto] gap-3 px-5 py-4 transition-colors hover:bg-[#f7f3ee]/60"
                      >
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-medium leading-snug text-[#1a1a1a]">
                            {market.event?.drugName || 'Clinical trial'}
                          </div>
                          <div className="mt-1 line-clamp-1 text-xs text-[#8a8075]">
                            {market.event?.companyName || 'Sponsor unknown'}
                          </div>
                          <div className="mt-2 text-xs text-[#b5aa9e]">{getSignalLabel(market)}</div>
                        </div>
                        <div className="self-start font-mono text-sm text-[#1a1a1a]">
                          {formatShortDateUtc(market.event?.decisionDate)}
                        </div>
                        <div className="self-start text-right text-sm">
                          <span className="font-mono text-[#2f7b40]">{split.yesCount} yes</span>
                          <span className="mx-1 text-[#b5aa9e]">/</span>
                          <span className="font-mono text-[#9b3028]">{split.noCount} no</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </GradientBorder>
            </div>
          </Slide>

          <Slide
            number="2"
            title="Biotech funds still price binary catalysts through fragmented, manual workflows."
            subtitle="The pain is not a lack of opinions. It is slow synthesis, weak calibration, poor comparability across names, and no durable scoring loop after a readout lands."
          >
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailCard
                  title="Slow synthesis"
                  body="Every catalyst starts from scratch: protocol details, endpoint quality, prior data, sponsor language, and readout timing all get rebuilt manually."
                  tone="coral"
                />
                <DetailCard
                  title="Weak calibration"
                  body="Teams collect narratives, not scored probabilities tied to a resolved history of who was right before the answer existed."
                  tone="green"
                />
                <DetailCard
                  title="Poor comparability"
                  body="Cross-name judgment becomes inconsistent because each trial gets analyzed through a slightly different internal frame."
                  tone="gold"
                />
                <DetailCard
                  title="No persistent scoring loop"
                  body="When a readout lands, the insight is gone. It rarely becomes a reusable performance archive that improves the next position."
                  tone="blue"
                />
              </div>

              <div className="space-y-4">
                <div className="border border-[#e8ddd0] bg-white/88 p-5">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                    Buyer
                  </div>
                  <p className="mt-3 text-2xl leading-tight text-[#1a1a1a]">
                    Specialist biotech PMs and analysts pricing narrative-heavy trial catalysts.
                  </p>
                </div>

                <div className="border border-[#e8ddd0] bg-[#f7f3ee]/70 p-5">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                    What the desk actually needs
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-3">
                      <span className="mt-1 h-[7px] w-[7px] bg-[#ef6f67]" aria-hidden="true" />
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        One institutional workflow for tracking live trial event-risk instead of one-off trial memos.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="mt-1 h-[7px] w-[7px] bg-[#5dbb63]" aria-hidden="true" />
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        Quantified priors with comparable structure across names, dates, and disease areas.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="mt-1 h-[7px] w-[7px] bg-[#d39d2e]" aria-hidden="true" />
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        Alerts when disagreement changes, not just another static research dashboard.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="mt-1 h-[7px] w-[7px] bg-[#5ba5ed]" aria-hidden="true" />
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        A scored archive that compounds institutional memory after each real-world outcome.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Slide>

          <Slide
            number="3"
            title="The paid product is a signal terminal, not a benchmark company."
            subtitle="The public site is the product core today. The institutional version layers on private watchlists, alerting, exports, and team workflow without changing the underlying signal engine."
          >
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.1fr]">
              <div className="space-y-4">
                <DetailCard
                  title="Current public product core"
                  body="Live trial board, trial detail pages, side-by-side model calls, methodology transparency, and a resolved leaderboard that proves the system is already operating."
                  tone="green"
                />
                <DetailCard
                  title="Institutional extension"
                  body="Private watchlists, portfolio-specific alerts, desk notes, exports, and persistent history turn the same signal engine into a workflow product that hedge funds can pay for."
                  tone="blue"
                />
                <div className="border border-[#e8ddd0] bg-[#f7f3ee]/70 p-5">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                    Product promise
                  </div>
                  <p className="mt-3 text-lg leading-relaxed text-[#1a1a1a]">
                    One place to track readouts, compare calibrated views, spot disagreement, and carry the scored history
                    forward into the next catalyst.
                  </p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StepCard
                    step="1"
                    title="Track"
                    body="Trial opportunities enter a live watchboard instead of scattered analyst notes."
                  />
                  <StepCard
                    step="2"
                    title="Compare"
                    body="Models are evaluated on the same structured context for each market and each date."
                  />
                  <StepCard
                    step="3"
                    title="Triage"
                    body="The desk focuses on disagreement, timing shifts, and edge rather than re-reading every trial from scratch."
                  />
                  <StepCard
                    step="4"
                    title="Archive"
                    body="When readouts land, every prior view becomes part of the institutional memory layer."
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="border border-[#e8ddd0] bg-white/88 p-5">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                      What a desk pays for
                    </div>
                    <div className="mt-4 space-y-3">
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        - Private watchlists by portfolio, indication, sponsor, or timing bucket.
                      </p>
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        - Alerts when a market becomes interesting because disagreement spikes or timing changes.
                      </p>
                      <p className="text-sm leading-relaxed text-[#8a8075]">
                        - Team workflows, notes, exports, and eventually API hooks into internal models.
                      </p>
                    </div>
                  </div>

                  <div className="border border-[#e8ddd0] bg-white/88 p-5">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                      Signals the desk can act on
                    </div>
                    <div className="mt-4 space-y-3">
                      {disagreementMarkets.length > 0 ? (
                        disagreementMarkets.map(({ market, split }) => (
                          <div key={market.marketId} className="border border-[#e8ddd0] bg-[#f7f3ee]/60 p-3">
                            <div className="line-clamp-2 text-sm font-medium leading-snug text-[#1a1a1a]">
                              {market.event?.drugName || 'Clinical trial'}
                            </div>
                            <div className="mt-1 text-xs text-[#8a8075]">
                              {formatShortDateUtc(market.event?.decisionDate)} | {split.yesCount} yes / {split.noCount} no
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm leading-relaxed text-[#8a8075]">
                          As more model runs accumulate, disagreement alerts become one of the clearest institutional
                          hooks for daily workflow.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Slide>

          <Slide
            number="4"
            title="The moat is the live unresolved-outcome dataset plus continuous scoring."
            subtitle="This is where benchmarking and market mechanics matter. They are not the product category. They are the trust engine, update engine, and memory engine behind the signal terminal."
          >
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailCard
                  title="Trust layer: public benchmark"
                  body="Endpoint Arena measures who was right before the answer existed. That is much harder to fake than a static benchmark score."
                  tone="coral"
                />
                <DetailCard
                  title="Update layer: market mechanics"
                  body="The prediction-market layer gives the system a living price, participation loop, and continuous updates instead of a one-time forecast."
                  tone="green"
                />
                <DetailCard
                  title="Memory layer: resolved history"
                  body="Every real-world readout turns prior forecasts into scored historical context that compounds into a better institutional workflow."
                  tone="gold"
                />
                <DetailCard
                  title="Why it is defensible"
                  body="Others can generate biotech opinions. Few can operate a live, unresolved, continuously scored system and preserve the full trail of changing views."
                  tone="blue"
                />
              </div>

              <div className="space-y-4">
                <MetricCard
                  category="Product scope"
                  label="Resolved trial markets"
                  value={resolvedMarketCount.toLocaleString('en-US')}
                  detail="The archive is still early, but it already exists inside the live product rather than in a slideware claim."
                  tone="neutral"
                />
                <MetricCard
                  category="Execution proof"
                  label="Decision snapshots recorded"
                  value={decisionSnapshotCount.toLocaleString('en-US')}
                  detail="Every stored forecast becomes part of the scored memory layer once outcomes land."
                  tone="gold"
                />
                <div className="border border-[#e8ddd0] bg-[#f7f3ee]/70 p-5">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                    Important caveat
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-[#8a8075]">
                    {scoringSetLine}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-[#8a8075]">
                    That is why the deck uses these numbers as execution proof and product scope, not as traction.
                  </p>
                </div>
              </div>
            </div>
          </Slide>

          <Slide
            number="5"
            title="Why now: models are improving, but biotech event-risk still lacks a category-defining terminal."
            subtitle="The company-building case is to turn the public trial product core into the institutional workflow for science-risk intelligence."
          >
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <DetailCard
                  title="Why now"
                  body="Frontier models are finally good enough to produce structured, repeatable pre-readout views, but funds still do not have a durable product layer for acting on them."
                  tone="coral"
                />
                <DetailCard
                  title="Wedge"
                  body="Start with biotech hedge funds, where the pain is acute, the readouts are binary, and the workflow value is obvious."
                  tone="green"
                />
                <DetailCard
                  title="Expansion path"
                  body="Move from public board to institutional watchlists, alerts, desk collaboration, exports, and eventually the default system of record for science-risk intelligence."
                  tone="blue"
                />
              </div>

              <div className="space-y-5">
                <div className="border border-[#e8ddd0] bg-white/88 p-6">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#b5aa9e]">
                    What investors are backing
                  </div>
                  <p className="mt-3 text-3xl leading-tight tracking-tight text-[#1a1a1a]">
                    The institutional terminal for science-risk intelligence.
                  </p>
                  <p className="mt-4 text-base leading-relaxed text-[#8a8075]">
                    Endpoint Arena already proves the signal engine can operate in public. The fundraise case is to
                    turn that engine into a paid institutional workflow product for biotech desks.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <StepCard
                    step="A"
                    title="Monitor"
                    body="Own the daily board for live trial catalysts."
                  />
                  <StepCard
                    step="B"
                    title="Workflow"
                    body="Own the desk workflow around alerts, triage, and scoring."
                  />
                  <StepCard
                    step="C"
                    title="Category"
                    body="Own the institutional memory layer for science-risk decisions."
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/contact"
                    className="inline-flex min-h-11 items-center justify-center border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                  >
                    Contact for investor conversations
                  </Link>
                  <Link
                    href="/method"
                    className="inline-flex min-h-11 items-center justify-center border border-[#e8ddd0] bg-white px-4 py-2 text-sm font-medium text-[#8a8075] transition-colors hover:bg-[#f7f3ee] hover:text-[#1a1a1a]"
                  >
                    Review methodology
                  </Link>
                </div>
              </div>
            </div>
          </Slide>
        </div>

        <div className="mt-10 space-y-10" data-print-hidden="true">
          <SquareDivider />
          <FooterGradientRule />
        </div>
      </main>
    </PageFrame>
  )
}
