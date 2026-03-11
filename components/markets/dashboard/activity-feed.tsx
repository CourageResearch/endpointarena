'use client'

import { ModelIcon } from '@/components/ModelIcon'
import { HeaderDots } from '@/components/site/chrome'
import { MODEL_INFO } from '@/lib/constants'
import { formatPercent, type RecentMarketActionRow } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  APPROVE_TEXT_CLASS,
  formatDateTimeLocalCompact,
  REJECT_TEXT_CLASS,
  type ActivityFilterOption,
} from '@/components/markets/dashboard/shared'

function getActionBadge(action: RecentMarketActionRow):
  | { kind: 'trade'; verb: 'buy' | 'sell'; outcome: 'Yes' | 'No'; outcomeTone: 'approve' | 'reject' }
  | { kind: 'status'; label: 'Hold' | 'Error' | 'Skipped'; tone: 'neutral' | 'warning' | 'muted' } {
  if (action.status === 'error') {
    return { kind: 'status', label: 'Error', tone: 'warning' }
  }
  if (action.status === 'skipped') {
    return { kind: 'status', label: 'Skipped', tone: 'muted' }
  }
  if (action.action === 'BUY_YES') {
    return { kind: 'trade', verb: 'buy', outcome: 'Yes', outcomeTone: 'approve' }
  }
  if (action.action === 'BUY_NO') {
    return { kind: 'trade', verb: 'buy', outcome: 'No', outcomeTone: 'reject' }
  }
  if (action.action === 'SELL_YES') {
    return { kind: 'trade', verb: 'sell', outcome: 'Yes', outcomeTone: 'approve' }
  }
  if (action.action === 'SELL_NO') {
    return { kind: 'trade', verb: 'sell', outcome: 'No', outcomeTone: 'reject' }
  }
  return { kind: 'status', label: 'Hold', tone: 'neutral' }
}

function getReasonText(action: RecentMarketActionRow): string {
  if (action.status === 'error') {
    return action.error || action.errorDetails || action.explanation || 'Action failed without details'
  }
  if (action.status === 'skipped') {
    return action.explanation || 'Skipped this market in the run'
  }
  return action.explanation || 'No explanation provided'
}

function MarketCommentCard({ action }: { action: RecentMarketActionRow }) {
  const model = MODEL_INFO[action.modelId]
  const badge = getActionBadge(action)
  const reason = getReasonText(action)
  const priceMove = action.priceAfter - action.priceBefore
  const hasPriceMove = Math.abs(priceMove) >= 0.0001
  const moveTone = priceMove > 0.0001 ? 'up' : priceMove < -0.0001 ? 'down' : 'default'
  const changeText = hasPriceMove ? `${priceMove >= 0 ? '+' : '-'}${(Math.abs(priceMove) * 100).toFixed(1)} pts` : 'No change'
  const changeClass =
    moveTone === 'up'
      ? APPROVE_TEXT_CLASS
      : moveTone === 'down'
        ? REJECT_TEXT_CLASS
        : 'text-[#6d645a]'
  const probabilityRangeText = `${formatPercent(action.priceBefore, 1)} → ${formatPercent(action.priceAfter, 1)}`
  const sizeText = action.usdAmount > 0 ? action.usdAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—'
  const actionValue =
    badge.kind === 'trade' ? (
      <span className="inline-flex flex-wrap items-baseline gap-1.5 font-medium text-[#6d645a]">
        <span
          className={cn(
            'text-[12px] leading-none',
            badge.verb === 'buy' ? APPROVE_TEXT_CLASS : REJECT_TEXT_CLASS,
          )}
          aria-hidden="true"
        >
          {badge.verb === 'buy' ? '↗' : '↘'}
        </span>
        <span className="capitalize">{badge.verb}</span>
        <span className={badge.outcomeTone === 'approve' ? APPROVE_TEXT_CLASS : REJECT_TEXT_CLASS}>
          {badge.outcome}
        </span>
      </span>
    ) : (
      <span
        className={cn(
          'font-medium',
          badge.tone === 'warning'
            ? 'text-amber-600'
            : badge.tone === 'muted'
              ? 'text-zinc-500'
              : 'text-[#5f79a6]',
        )}
      >
        {badge.label}
      </span>
    )

  return (
    <article
      data-reasoning-card="true"
      className="w-full rounded-none p-px"
      style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}
    >
      <div className="rounded-none bg-white/95 p-3 sm:p-3.5">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex flex-1 items-center gap-2">
              <div className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[#9a9084]" aria-hidden="true">
                <ModelIcon id={action.modelId} className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex items-baseline gap-3 sm:gap-4">
                <div className="min-w-0 truncate text-[14px] leading-tight font-medium text-[#2f2a24]" title={model.fullName}>
                  {model.fullName}
                </div>
                <div className="shrink-0 text-[13px] leading-[1.3]">
                  {actionValue}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right text-[12px] leading-tight font-medium tabular-nums text-[#8f8478]">
              {formatDateTimeLocalCompact(action.createdAt || action.runDate)}
            </div>
          </div>

          <dl className="mt-1.5 grid grid-cols-1 gap-y-1.5 text-[13px] leading-[1.35]">
            <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <dt className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">Size:</dt>
              <dd className="shrink-0 break-words font-medium tabular-nums text-[#6d645a]">{sizeText}</dd>
              <dt className="ml-2 shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">Delta:</dt>
              <dd className="min-w-0 flex-1 break-words font-medium tabular-nums">
                <span className={cn('font-medium tabular-nums', changeClass)}>{changeText}</span>
                <span className="text-[#6d645a]"> ({probabilityRangeText})</span>
              </dd>
            </div>
          </dl>

          <div className="mt-2">
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">
              {action.status === 'error' ? 'Error Note' : action.status === 'skipped' ? 'Skip Note' : 'Reasoning'}
            </div>
            <p className="truncate-wrap whitespace-pre-wrap text-[13px] leading-[1.45] text-[#3f392f]">{reason}</p>
          </div>
        </div>
      </div>
    </article>
  )
}

export function MarketActivityFeed({
  className,
  scrubbedChartDayKey,
  scrubbedChartDayLabel,
  allModelsSelected,
  filterOptions,
  commentSort,
  selectedMarketActions,
  visibleActivityActions,
  hasMoreActivity,
  showAllActivity,
  onSelectAllModels,
  onToggleModel,
  onToggleSort,
  onToggleShowAll,
}: {
  className?: string
  scrubbedChartDayKey: string | null
  scrubbedChartDayLabel: string | null
  allModelsSelected: boolean
  filterOptions: ActivityFilterOption[]
  commentSort: 'newest' | 'oldest'
  selectedMarketActions: RecentMarketActionRow[]
  visibleActivityActions: RecentMarketActionRow[]
  hasMoreActivity: boolean
  showAllActivity: boolean
  onSelectAllModels: () => void
  onToggleModel: (modelId: ActivityFilterOption['id']) => void
  onToggleSort: () => void
  onToggleShowAll: () => void
}) {
  return (
    <section className={cn('min-w-0 space-y-2', className)}>
      <div className="px-1 py-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#a89b8c]">Activity Feed</div>
          <HeaderDots />
          <span
            className={cn(
              'inline-flex h-6 w-[10.5rem] items-center justify-center rounded-full border bg-white/85 px-2.5 text-[11px] text-[#7c7267] transition-opacity',
              scrubbedChartDayKey && scrubbedChartDayLabel
                ? 'border-[#d9ccbc] opacity-100'
                : 'border-transparent opacity-0',
            )}
            aria-hidden={!scrubbedChartDayKey || !scrubbedChartDayLabel}
          >
            {scrubbedChartDayKey && scrubbedChartDayLabel ? `Chart day: ${scrubbedChartDayLabel}` : 'Chart day: --'}
          </span>
        </div>

        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex flex-1 flex-col gap-1.5">
            <div className="min-w-0 flex flex-wrap items-center gap-0.5">
              <button
                type="button"
                onClick={onSelectAllModels}
                aria-pressed={allModelsSelected}
                aria-label="All Models"
                title="All Models"
                style={{ fontSize: '12px', lineHeight: 1.1 }}
                className={cn(
                  'inline-flex h-7 items-center justify-center whitespace-nowrap border-b px-1 font-medium transition',
                  allModelsSelected
                    ? 'border-[#1a1a1a] text-[#1a1a1a]'
                    : 'border-transparent text-[#8a8075] hover:border-[#d9ccbc] hover:text-[#1a1a1a]',
                )}
              >
                <span>All</span>
              </button>

              {filterOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onToggleModel(option.id)}
                  aria-label={option.label}
                  title={option.label}
                  aria-pressed={option.active}
                  style={{ fontSize: '12px', lineHeight: 1.1 }}
                  className={cn(
                    'inline-flex h-7 items-center justify-center whitespace-nowrap border-b px-1 font-medium transition',
                    option.active
                      ? 'border-[#1a1a1a] text-[#1a1a1a]'
                      : 'border-transparent text-[#8a8075] hover:border-[#d9ccbc] hover:text-[#1a1a1a]',
                  )}
                >
                  <span>{option.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={onToggleSort}
                aria-label={commentSort === 'newest' ? 'Sort newest first' : 'Sort oldest first'}
                title={commentSort === 'newest' ? 'Sorting: newest first' : 'Sorting: oldest first'}
                className="ml-auto inline-flex h-7 w-7 items-center justify-center text-sm font-medium text-[#8a8075] transition-colors hover:text-[#1a1a1a]"
              >
                <span className="text-sm leading-none" aria-hidden="true">
                  {commentSort === 'newest' ? '↓' : '↑'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-2">
        {selectedMarketActions.length === 0 ? (
          <div className="rounded-xl border border-[#eadfce] bg-[#faf7f2] p-4 text-sm text-[#6f665b]">
            No activity entries match the current filters
            {scrubbedChartDayLabel ? ` for ${scrubbedChartDayLabel}` : ''}
            {' '}for this market.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {visibleActivityActions.map((action) => (
                <MarketCommentCard key={action.id} action={action} />
              ))}
            </div>
            {hasMoreActivity ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={onToggleShowAll}
                  className="inline-flex items-center justify-center rounded-md border border-[#dfd3c3] bg-white/95 px-3 py-1.5 text-xs font-medium text-[#8a8075] transition-colors hover:border-[#c8b7a2] hover:text-[#1a1a1a]"
                >
                  {showAllActivity ? 'Show less' : `Show more (${selectedMarketActions.length - visibleActivityActions.length})`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
