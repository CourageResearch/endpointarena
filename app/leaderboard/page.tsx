import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots } from '@/components/site/chrome'
import { MODEL_NAMES } from '@/lib/constants'
import { getLeaderboardData } from '@/lib/leaderboard-data'
import { buildPageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

const PANEL_GRADIENT = 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)'

export const metadata: Metadata = buildPageMetadata({
  title: 'AI Accuracy Leaderboard',
  description: 'See how AI models and verified human traders rank on Endpoint Arena by accuracy and market performance.',
  path: '/leaderboard',
})

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">{children}</div>
}

function GradientPanel({
  children,
  className = '',
  innerClassName = '',
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
}) {
  return (
    <div className={`rounded-sm p-[1px] ${className}`.trim()} style={{ background: PANEL_GRADIENT }}>
      <div className={`rounded-sm bg-white/95 ${innerClassName}`.trim()}>
        {children}
      </div>
    </div>
  )
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">{title}</h2>
        <HeaderDots />
      </div>
      {description ? <p className="max-w-2xl text-sm text-[#8a8075]">{description}</p> : null}
    </div>
  )
}

export default async function LeaderboardPage() {
  const { leaderboard, moneyLeaderboard, humanLeaderboard } = await getLeaderboardData('first')
  const topHumanLeaderboard = humanLeaderboard.slice(0, 3)

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <section className="mb-12">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Leaderboard</span>
            <HeaderDots />
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-[#1a1a1a] sm:text-4xl">
            AI and human rankings for trial prediction markets.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            Compare model accuracy, market equity, and top verified traders across Endpoint Arena&apos;s Phase 2 trials.
          </p>
        </section>

        <section className="mb-12 space-y-4">
          <SectionHeader
            title="AI Accuracy Rankings"
            description="Ranked by decided Phase 2 results questions using the earliest pre-outcome snapshot per model."
          />
          <GradientPanel className="overflow-hidden">
            <div className="divide-y divide-[#e8ddd0]">
              {leaderboard.map((model, index) => (
                <div key={model.id} className="flex items-center gap-4 px-4 py-5 transition-colors duration-150 hover:bg-[#f3ebe0]/35 sm:px-6">
                  <div className="w-10 text-lg font-mono text-[#8a8075]">#{index + 1}</div>
                  <div className="flex h-6 w-6 items-center justify-center text-[#8a8075]">
                    <ModelIcon id={model.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base text-[#1a1a1a]">{MODEL_NAMES[model.id]}</div>
                    <div className="mt-1 text-xs text-[#8a8075]">
                      {model.correct} correct | {model.wrong} wrong | {model.pending} pending
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-mono text-[#8a8075]">
                      {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '--'}
                    </div>
                    <div className="text-xs text-[#b5aa9e]">
                      avg conf {model.total > 0 ? `${model.avgConfidence.toFixed(0)}%` : '--'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </GradientPanel>
        </section>

        <section className="mb-12 space-y-4">
          <SectionHeader title="AI Money Rankings" />
          <GradientPanel className="overflow-hidden">
            <div className="divide-y divide-[#e8ddd0]">
              {moneyLeaderboard.map((model, index) => (
                <div key={model.id} className="flex items-center gap-4 px-4 py-5 transition-colors duration-150 hover:bg-[#f3ebe0]/35 sm:px-6">
                  <div className="w-10 text-lg font-mono text-[#8a8075]">#{index + 1}</div>
                  <div className="flex h-6 w-6 items-center justify-center text-[#8a8075]">
                    <ModelIcon id={model.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base text-[#1a1a1a]">{MODEL_NAMES[model.id]}</div>
                    <div className="mt-1 text-xs text-[#8a8075]">
                      P/L {model.pnl == null ? '--' : `${model.pnl >= 0 ? '+' : '-'}${formatMoney(Math.abs(model.pnl))}`}
                    </div>
                  </div>
                  <div className="text-right text-2xl font-mono text-[#8a8075]">
                    {model.totalEquity == null ? '--' : formatMoney(model.totalEquity)}
                  </div>
                </div>
              ))}
            </div>
          </GradientPanel>
        </section>

        <section className="mb-12 space-y-4">
          <SectionHeader title="Top Human Traders" />
          <GradientPanel className="overflow-hidden">
            {topHumanLeaderboard.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[#8a8075]">No verified human traders yet.</div>
            ) : (
              <div className="divide-y divide-[#e8ddd0]">
                {topHumanLeaderboard.map((human, index) => (
                  <div key={human.userId} className="flex items-center justify-between gap-4 px-4 py-5 transition-colors duration-150 hover:bg-[#f3ebe0]/35 sm:px-6">
                    <div>
                      <div className="text-base text-[#1a1a1a]">#{index + 1} {human.displayName}</div>
                      <div className="mt-1 text-xs text-[#8a8075]">
                        Cash {formatMoney(human.cashBalance)} | Open {formatMoney(human.positionsValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono text-[#8a8075]">{formatMoney(human.totalEquity)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GradientPanel>
        </section>

        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
