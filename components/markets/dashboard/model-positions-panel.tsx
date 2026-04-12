'use client'

import { ModelIcon } from '@/components/ModelIcon'
import { HeaderDots } from '@/components/site/chrome'
import type { ModelId } from '@/lib/constants'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  DASHBOARD_SECTION_LABEL_CLASS,
  DETAILS_CARD_BORDER_STYLE,
} from '@/components/markets/dashboard/shared'

export type PositionSortKey = 'model' | 'netStance' | 'yesShares' | 'noShares' | 'position' | 'pnl'
export type PositionSortDirection = 'asc' | 'desc'
export type PositionSortState = { key: PositionSortKey; direction: PositionSortDirection }

export type MarketPositionRow = {
  modelId: ModelId
  fullName: string
  displayLabel: string
  compactLabel: string
  yesShares: number
  noShares: number
  hasBothSides: boolean
  positionValueUsd: number
  pnlUsd: number
  netDisplayLabel: string
  netTextClass: string
}

function formatShares(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function getSignedMoneyClass(value: number): string {
  if (value > 0.01) return 'text-emerald-700'
  if (value < -0.01) return 'text-rose-700'
  return 'text-[#7c7267]'
}

function formatSignedCompactMoney(value: number): string {
  if (Math.abs(value) < 0.01) return '$0'
  const absFormatted = formatCompactMoney(Math.abs(value))
  return value > 0 ? `+${absFormatted}` : `-${absFormatted}`
}

function SortablePositionHeader({
  label,
  sortKey,
  sortState,
  onSort,
  align = 'left',
  className,
}: {
  label: string
  sortKey: PositionSortKey
  sortState: PositionSortState | null
  onSort: (key: PositionSortKey) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = sortState?.key === sortKey
  const direction = isActive ? sortState.direction : null
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
  const icon = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'

  return (
    <th aria-sort={ariaSort} className={cn('py-3 font-medium whitespace-nowrap', className, align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex w-full cursor-pointer items-center text-inherit hover:text-[#3a342d] focus-visible:outline-none',
          align === 'right' ? 'justify-end' : 'justify-start',
        )}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span className={cn('ml-1.5 text-[11px] leading-none', isActive ? 'text-[#8a8075]' : 'text-[#d4c9bc]')} aria-hidden="true">
          {icon}
        </span>
      </button>
    </th>
  )
}

export function MarketModelPositionsPanel({
  className,
  marketId,
  rows,
  sortState,
  onSort,
  variant = 'default',
  showHeader = true,
}: {
  className?: string
  marketId: string
  rows: MarketPositionRow[]
  sortState: PositionSortState | null
  onSort: (key: PositionSortKey) => void
  variant?: 'default' | 'compact'
  showHeader?: boolean
}) {
  const compact = variant === 'compact'

  return (
    <section className={cn(className)}>
      {showHeader ? (
        <div className="mb-2 px-1">
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>Model Positions</div>
            <HeaderDots />
          </div>
        </div>
      ) : null}

      <div className="mx-1 rounded-none">
        <div className="overflow-hidden rounded-none border border-transparent" style={DETAILS_CARD_BORDER_STYLE}>
          <div className="hide-scrollbar overflow-x-auto overscroll-x-contain px-1 [&_tr]:border-[#e8ddd0] [&_td]:text-[#82786d]">
            <table className={cn('w-full table-fixed', compact ? 'min-w-[420px]' : 'min-w-[560px] sm:min-w-[620px] xl:min-w-0')}>
              <colgroup>
                <col style={{ width: compact ? '82px' : '140px' }} />
                <col style={{ width: compact ? '68px' : '92px' }} />
                <col style={{ width: compact ? '58px' : '70px' }} />
                <col style={{ width: compact ? '58px' : '70px' }} />
                <col style={{ width: compact ? '58px' : '82px' }} />
                <col style={{ width: compact ? '74px' : '82px' }} />
              </colgroup>
              <thead>
                <tr
                  className={cn(
                    'border-b border-[#e8ddd0] uppercase text-[#b5aa9e]',
                    compact ? 'text-[9px] tracking-[0.14em]' : 'text-[10px] tracking-[0.2em]',
                  )}
                >
                  <SortablePositionHeader
                    label="Model"
                    sortKey="model"
                    sortState={sortState}
                    onSort={onSort}
                    className={compact ? 'px-1.5' : 'pl-[2.625rem] pr-5'}
                  />
                  <SortablePositionHeader
                    label="View"
                    sortKey="netStance"
                    sortState={sortState}
                    onSort={onSort}
                    className={compact ? 'px-1' : 'px-1.5'}
                  />
                  <SortablePositionHeader
                    label="Yes"
                    sortKey="yesShares"
                    sortState={sortState}
                    onSort={onSort}
                    align="right"
                    className={compact ? 'px-1' : 'px-1.5'}
                  />
                  <SortablePositionHeader
                    label="No"
                    sortKey="noShares"
                    sortState={sortState}
                    onSort={onSort}
                    align="right"
                    className={compact ? 'px-1' : 'px-1.5'}
                  />
                  <SortablePositionHeader
                    label="Pos"
                    sortKey="position"
                    sortState={sortState}
                    onSort={onSort}
                    align="right"
                    className={compact ? 'px-1' : 'px-1.5'}
                  />
                  <SortablePositionHeader
                    label="P/L"
                    sortKey="pnl"
                    sortState={sortState}
                    onSort={onSort}
                    align="right"
                    className={compact ? 'px-1.5' : 'px-5'}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${marketId}-${row.modelId}`} className="border-b border-[#e8ddd0] last:border-b-0">
                    <td className={cn('align-top', compact ? 'px-1.5 py-3' : 'px-5 py-4')}>
                      <div className="flex items-center gap-1.5">
                        {!compact ? (
                          <span
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#8a8075]"
                            aria-hidden="true"
                          >
                            <ModelIcon id={row.modelId} className="h-4 w-4 grayscale" />
                          </span>
                        ) : null}
                        <span className="truncate text-[13px] font-medium text-[#1a1a1a]" title={row.fullName}>
                          {compact ? row.compactLabel : row.displayLabel}
                        </span>
                      </div>
                    </td>
                    <td className={cn('align-top', compact ? 'px-1 py-3' : 'px-1.5 py-4')}>
                      <div className="flex items-center gap-1.5">
                        <span className={cn('text-xs font-medium tracking-[0.02em]', row.netTextClass)}>
                          {row.netDisplayLabel}
                        </span>
                        {row.hasBothSides && !compact ? (
                          <span className="text-[10px] text-[#9a8f82]">mixed</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={cn('text-right align-top text-xs tabular-nums', compact ? 'px-1 py-3' : 'px-1.5 py-4')}>
                      {formatShares(row.yesShares)}
                    </td>
                    <td className={cn('text-right align-top text-xs tabular-nums', compact ? 'px-1 py-3' : 'px-1.5 py-4')}>
                      {formatShares(row.noShares)}
                    </td>
                    <td className={cn('text-right align-top text-xs tabular-nums', compact ? 'px-1 py-3' : 'px-1.5 py-4')}>
                      {formatCompactMoney(row.positionValueUsd)}
                    </td>
                    <td className={cn('text-right align-top text-xs font-medium tabular-nums', compact ? 'px-1.5 py-3' : 'px-5 py-4', getSignedMoneyClass(row.pnlUsd))}>
                      {formatSignedCompactMoney(row.pnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
