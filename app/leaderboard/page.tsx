import type { ReactNode } from 'react'
import { MODEL_DISPLAY_NAMES, MODEL_IDS, MODEL_NAMES, type ModelId } from '@/lib/constants'
import { FDAIcon, ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { BW2MobilePastCard, BW2PastRow } from '@/app/rows'
import { BrandDecisionMark } from '@/components/site/BrandDecisionMark'
import { FooterGradientRule } from '@/components/site/chrome'
import { getLeaderboardData } from '@/lib/leaderboard-data'
import type { LeaderboardPredictionMode } from '@/lib/model-decision-snapshots'

export const dynamic = 'force-dynamic'

const RANK_ORDER_COLORS = ['#EF6F67', '#5DBB63', '#D39D2E', '#5BA5ED'] as const
const PAST_TABLE_FIXED_COLUMNS = 5
const PAST_MODEL_COLUMN_WIDTH = 50
const PAST_TABLE_MIN_WIDTH = 405 + (MODEL_IDS.length * PAST_MODEL_COLUMN_WIDTH)
const PAST_TABLE_EMPTY_COLSPAN = PAST_TABLE_FIXED_COLUMNS + MODEL_IDS.length

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">{children}</div>
}

function HeaderDots() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#EF6F67', opacity: 0.85 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#5DBB63', opacity: 0.85 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#D39D2E', opacity: 0.9 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#5BA5ED', opacity: 0.85 }} />
    </div>
  )
}

const SQ_COLORS = ['#EF6F67', '#5DBB63', '#D39D2E', '#5BA5ED'] as const

function SquareDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`w-full ${className}`}>
      <svg className="w-full" height="8" preserveAspectRatio="none">
        <rect x="22%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[0]} opacity="0.85" />
        <rect x="40%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[1]} opacity="0.85" />
        <rect x="58%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[2]} opacity="0.9" />
        <rect x="76%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[3]} opacity="0.85" />
      </svg>
    </div>
  )
}

function PastLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 px-1 text-[11px] text-[#8a8075]">
      <span className="flex items-center gap-1.5">
        <BrandDecisionMark variant="correct" className="h-3.5 w-3.5" /> Correct Prediction
      </span>
      <span className="flex items-center gap-1.5">
        <BrandDecisionMark variant="incorrect" className="h-3.5 w-3.5" /> Incorrect Prediction
      </span>
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

const MODEL_VERSION_PATTERN = /([A-Za-z]?\d+(?:\.\d+)*(?:\s+[A-Za-z][A-Za-z0-9.-]*)*)$/
const COMPARISON_COMPANY_LABELS: Record<ModelId, string> = {
  'claude-opus': 'Anthropic',
  'gpt-5.2': 'OpenAI',
  'grok-4': 'xAI',
  'gemini-2.5': 'Google',
  'gemini-3-pro': 'Google',
  'deepseek-v3.2': 'DeepSeek',
  'llama-4': 'Meta',
  'kimi-k2': 'Moonshot',
  'minimax-m2.5': 'MiniMax',
}

function splitModelNameAndVersion(fullName: string): { model: string; version: string } {
  const normalized = fullName.trim()
  const match = normalized.match(MODEL_VERSION_PATTERN)
  if (!match || match.index == null) {
    return {
      model: normalized,
      version: '—',
    }
  }

  const version = match[1].trim()
  const model = normalized
    .slice(0, match.index)
    .replace(/[-\s]+$/, '')
    .trim()

  return {
    model: model || normalized,
    version,
  }
}

function parseMode(value: string | string[] | undefined): LeaderboardPredictionMode {
  if (Array.isArray(value)) {
    return value[0] === 'first' ? 'first' : 'final'
  }
  return value === 'first' ? 'first' : 'final'
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ mode?: string | string[] }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const mode = parseMode(resolvedSearchParams.mode)
  const { leaderboard, moneyLeaderboard, humanLeaderboard, recentFdaDecisions } = await getLeaderboardData(mode)
  const comparisonModels = moneyLeaderboard
  const topHumanLeaderboard = humanLeaderboard.slice(0, 3)

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">

        {/* ── RANKINGS ── */}
        <div className="mb-12 sm:mb-16">
          <section className="space-y-4">
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">AI Accuracy Rankings</h2>
                  <HeaderDots />
                </div>
                <div className="inline-flex rounded-sm border border-[#e8ddd0] bg-white/80 p-1 text-[11px] uppercase tracking-[0.16em] text-[#8a8075]">
                  <a
                    href="/leaderboard?mode=final"
                    className={`rounded-sm px-2.5 py-1 ${mode === 'final' ? 'bg-[#1a1a1a] text-white' : 'hover:text-[#1a1a1a]'}`}
                  >
                    Final Call
                  </a>
                  <a
                    href="/leaderboard?mode=first"
                    className={`rounded-sm px-2.5 py-1 ${mode === 'first' ? 'bg-[#1a1a1a] text-white' : 'hover:text-[#1a1a1a]'}`}
                  >
                    First Call
                  </a>
                </div>
              </div>
              <p className="text-[#8a8075] text-sm sm:text-base max-w-2xl">
                Ranked by decided prediction accuracy using the {mode === 'first' ? 'earliest' : 'latest'} pre-outcome snapshot per model and event.
              </p>
            </div>

            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm">
                <div className="divide-y divide-[#e8ddd0] border-t border-[#e8ddd0]">
                  {leaderboard.map((model, i) => {
                    const rankColor = RANK_ORDER_COLORS[i % RANK_ORDER_COLORS.length]
                    return (
                      <div
                        key={model.id}
                        className="group relative px-4 sm:px-8 py-6 sm:py-8 hover:bg-[#f3ebe0]/30 transition-colors duration-150"
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                          style={{ backgroundColor: rankColor }}
                        />
                        <div className="flex items-center gap-3 sm:gap-4">
                          <span className="text-lg sm:text-xl font-mono shrink-0" style={{ color: rankColor }}>#{i + 1}</span>

                          <div className="w-5 h-5 sm:w-6 sm:h-6 text-[#8a8075] shrink-0 transition-transform duration-150 group-hover:scale-[1.03]">
                            <ModelIcon id={model.id} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-base sm:text-lg text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111]">
                              {MODEL_NAMES[model.id]}
                            </div>
                          </div>

                          <div className="text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                            <div className="text-2xl sm:text-3xl font-mono tracking-tight text-[#8a8075]">
                              {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <SquareDivider className="my-8 sm:my-10" />

          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">AI Money Rankings</h2>
                <HeaderDots />
              </div>
              <p className="text-[#8a8075] text-sm sm:text-base max-w-2xl">
                Current total equity rankings based on cash plus mark-to-market open positions.
              </p>
            </div>

            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm">
                <div className="divide-y divide-[#e8ddd0] border-t border-[#e8ddd0]">
                  {moneyLeaderboard.map((model, i) => {
                    const rankColor = RANK_ORDER_COLORS[i % RANK_ORDER_COLORS.length]
                    return (
                      <div
                        key={model.id}
                        className="group relative px-4 sm:px-8 py-6 sm:py-8 hover:bg-[#f3ebe0]/30 transition-colors duration-150"
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                          style={{ backgroundColor: rankColor }}
                        />
                        <div className="flex items-center gap-3 sm:gap-4">
                          <span className="text-lg sm:text-xl font-mono shrink-0" style={{ color: rankColor }}>#{i + 1}</span>

                          <div className="w-5 h-5 sm:w-6 sm:h-6 text-[#8a8075] shrink-0 transition-transform duration-150 group-hover:scale-[1.03]">
                            <ModelIcon id={model.id} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-base sm:text-lg text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111]">
                              {MODEL_NAMES[model.id]}
                            </div>
                          </div>

                          <div className="text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                            <div className="text-2xl sm:text-3xl font-mono tracking-tight text-[#8a8075]">
                              {model.totalEquity != null ? formatMoney(model.totalEquity) : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <SquareDivider className="my-8 sm:my-10" />

          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Top 3 Human Traders</h2>
                <HeaderDots />
              </div>
              <p className="text-[#8a8075] text-sm sm:text-base max-w-2xl">
                Verified human traders ranked by current total equity across cash and open positions.
              </p>
            </div>

            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm">
                {topHumanLeaderboard.length === 0 ? (
                  <div className="px-4 sm:px-8 py-8 text-sm text-center text-[#8a8075]">
                    No verified human traders on the leaderboard yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[#e8ddd0] border-t border-[#e8ddd0]">
                    {topHumanLeaderboard.map((human, i) => {
                      const rankColor = RANK_ORDER_COLORS[i % RANK_ORDER_COLORS.length]
                      return (
                        <div
                          key={human.userId}
                          className="group relative px-4 sm:px-8 py-6 sm:py-8 hover:bg-[#f3ebe0]/30 transition-colors duration-150"
                        >
                          <div
                            aria-hidden="true"
                            className="absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                            style={{ backgroundColor: rankColor }}
                          />
                          <div className="flex items-center gap-3 sm:gap-4">
                            <span className="text-lg sm:text-xl font-mono shrink-0" style={{ color: rankColor }}>#{i + 1}</span>

                            <div className="flex-1 min-w-0">
                              <div className="text-base sm:text-lg text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111]">
                                {human.displayName}
                              </div>
                              <div className="mt-1 text-xs sm:text-sm text-[#8a8075]">
                                Cash {formatMoney(human.cashBalance)} · Open {formatMoney(human.positionsValue)} ·{' '}
                                <span style={{ color: human.pnl >= 0 ? '#3a8a2e' : '#c43a2b' }}>
                                  P/L {human.pnl >= 0 ? '+' : '-'}{formatMoney(Math.abs(human.pnl))}
                                </span>
                              </div>
                            </div>

                            <div className="text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                              <div className="text-2xl sm:text-3xl font-mono tracking-tight text-[#8a8075]">
                                {formatMoney(human.totalEquity)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Divider */}
        <SquareDivider className="mb-12 sm:mb-16" />

        {/* ── COMPARISON TABLE ── */}
        <div className="mb-12 sm:mb-16">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Rankings Comparison</h2>
            <HeaderDots />
          </div>
          <p className="mb-4 text-[#8a8075] text-sm sm:text-base max-w-2xl">
            Columns follow the current money ranking order shown above.
          </p>

          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm overflow-x-auto sm:overflow-x-visible">
              <table className="w-full table-fixed">
                <colgroup>
                  <col style={{ width: '12rem' }} />
                  {comparisonModels.map((model) => (
                    <col key={`comparison-col-${model.id}`} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                    <th className="text-left px-3 sm:px-4 py-2.5 font-medium">Metric</th>
                    {comparisonModels.map((model) => (
                      <th key={model.id} className="text-center px-1.5 py-2.5 font-medium">
                        <div className="w-4 h-4 mx-auto mb-1 text-[#8a8075]" title={MODEL_NAMES[model.id]}>
                          <ModelIcon id={model.id} />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Company</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 text-[#8a8075] text-[13px] sm:text-sm leading-snug break-words">
                        {COMPARISON_COMPANY_LABELS[model.id]}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Model</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 text-[#8a8075] text-[13px] sm:text-sm leading-snug break-words">
                        {splitModelNameAndVersion(MODEL_NAMES[model.id]).model}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Version</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 text-[#8a8075] text-[13px] sm:text-sm leading-snug break-words">
                        {splitModelNameAndVersion(MODEL_NAMES[model.id]).version}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Accuracy</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[#8a8075] text-[13px] sm:text-sm">
                        {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Total equity</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[#8a8075] text-[13px] sm:text-sm">
                        {model.totalEquity != null ? formatMoney(model.totalEquity) : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">P/L</td>
                    {comparisonModels.map((model) => (
                      <td
                        key={model.id}
                        className="text-center px-1.5 py-3 font-mono text-[13px] sm:text-sm"
                        style={{ color: model.pnl == null ? '#8a8075' : model.pnl >= 0 ? '#3a8a2e' : '#c43a2b' }}
                      >
                        {model.pnl == null ? '—' : `${model.pnl >= 0 ? '+' : '-'}${formatMoney(Math.abs(model.pnl))}`}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Correct</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[13px] sm:text-sm" style={{ color: '#3a8a2e' }}>
                        {model.correct}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Wrong</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[13px] sm:text-sm" style={{ color: '#c43a2b' }}>
                        {model.wrong}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Pending</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[#b5aa9e] text-[13px] sm:text-sm">
                        {model.pending}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Avg confidence</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[#8a8075] text-[13px] sm:text-sm">
                        {model.total > 0 ? `${model.avgConfidence.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Confidence when correct</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[13px] sm:text-sm" style={{ color: '#3a8a2e' }}>
                        {model.correct > 0 ? `${model.avgConfidenceCorrect.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Confidence when wrong</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[13px] sm:text-sm" style={{ color: '#c43a2b' }}>
                        {model.wrong > 0 ? `${model.avgConfidenceWrong.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-3 sm:px-4 py-3 text-[#8a8075]">Total predictions</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-1.5 py-3 font-mono text-[#8a8075] text-[13px] sm:text-sm">
                        {model.total}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <SquareDivider className="mb-12 sm:mb-16" />

        {/* ── PAST DECISIONS ── */}
        <div className="mb-12 sm:mb-16">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Past Decisions</h2>
              <HeaderDots />
            </div>
          </div>

          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm">
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

              <div className="hidden sm:block overflow-x-auto overscroll-x-contain [&_tr]:border-[#e8ddd0] [&_td]:text-[#8a8075] [&_td]:py-5 [&_tr:hover]:bg-[#f3ebe0]/30">
                <table className="w-full table-fixed" style={{ minWidth: `${PAST_TABLE_MIN_WIDTH}px` }}>
                  <colgroup>
                    <col style={{width: '60px'}} />
                    <col style={{width: '130px'}} />
                    <col style={{width: '60px'}} />
                    <col style={{width: '65px'}} />
                    <col style={{width: '90px'}} />
                    {MODEL_IDS.map((modelId) => (
                      <col key={`leaderboard-past-col-${modelId}`} style={{ width: `${PAST_MODEL_COLUMN_WIDTH}px` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                      <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                      <th className="text-left px-3 py-3 font-medium">Drug</th>
                      <th className="text-left px-3 py-3 font-medium">Type</th>
                      <th className="text-left px-3 py-3 font-medium">Ticker</th>
                      <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-[#8a8075]" title="FDA"><FDAIcon /></div></th>
                      {MODEL_IDS.map((modelId) => (
                        <th key={`leaderboard-past-head-${modelId}`} className="text-center px-2 py-3">
                          <div className="w-4 h-4 mx-auto text-[#8a8075]" title={MODEL_DISPLAY_NAMES[modelId]}>
                            <ModelIcon id={modelId} />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentFdaDecisions.map((event) => (
                      <BW2PastRow key={event.id} event={event as any} />
                    ))}
                    {recentFdaDecisions.length === 0 && (
                      <tr><td colSpan={PAST_TABLE_EMPTY_COLSPAN} className="px-4 py-8 text-center text-[#b5aa9e]">No decisions yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <PastLegend />
        </div>

        {/* ── FOOTER ── */}
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
