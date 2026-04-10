'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react'
import { HeaderDots } from '@/components/site/chrome'
import { useTrialsBrowseData } from '@/components/trials/useTrialsBrowseData'
import { formatCompactMoney, formatPercent, formatShortDateUtc } from '@/lib/markets/overview-shared'
import type { TrialsBrowseResponse, TrialsBrowseRow } from '@/lib/trials-browse-shared'
import { cn } from '@/lib/utils'

type TrialsBrowseTab = 'upcoming' | 'resolved'
type TrialsBrowseSortKey = 'market' | 'primaryCompletion' | 'resolvedAt' | 'outcome' | 'yes' | 'no' | 'volume' | 'aiYes' | 'aiNo'
type TrialsBrowseSortDirection = 'asc' | 'desc'
type TrialsBrowseSortState = {
  key: TrialsBrowseSortKey
  direction: TrialsBrowseSortDirection
} | null

type IndexedTrialsBrowseRow = TrialsBrowseRow & {
  searchText: string
  normalizedSearchText: string
}

const PAGE_SIZE = 10
const ALL_TYPES_FILTER = '__all_types__'
const TYPE_FILTER_PARAM = 'type'
const TAB_FILTER_PARAM = 'tab'
const FROM_FILTER_PARAM = 'from'
const TO_FILTER_PARAM = 'to'
const PANEL_GRADIENT = 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)'
const PANEL_FRAME_STYLE = {
  border: '1px solid transparent',
  backgroundImage: `linear-gradient(rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.95)), ${PANEL_GRADIENT}`,
  backgroundOrigin: 'border-box',
  backgroundClip: 'padding-box, border-box',
} as const
const SEARCH_INPUT_CLASS_NAME = 'w-full rounded-none border border-[#e7ddd0] bg-white/92 px-3.5 py-2.5 text-[14px] leading-tight text-[#2f2a24] placeholder:text-[#b7aa98] focus:border-[#8a8075] focus:bg-white focus:outline-none'
const DATE_INPUT_CLASS_NAME = 'w-full rounded-none border border-[#e7ddd0] bg-white/92 px-3 py-2 text-[13px] leading-tight text-[#2f2a24] focus:border-[#8a8075] focus:bg-white focus:outline-none'
const SORT_SELECT_CLASS_NAME = `${SEARCH_INPUT_CLASS_NAME} min-w-[12rem] appearance-none pr-10 text-[#2f2a24]`
const SEARCH_INPUT_STYLE = {
  fontSize: '14px',
}
const SORT_SELECT_STYLE = {
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27none%27 stroke=%27%232b2b2b%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 7.5l5 5 5-5%27/%3E%3C/svg%3E")',
  backgroundPosition: 'right 0.9rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px 16px',
} as const
const UPCOMING_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'default', label: 'Default order' },
  { value: 'market:asc', label: 'Trial A-Z' },
  { value: 'market:desc', label: 'Trial Z-A' },
  { value: 'primaryCompletion:asc', label: 'Date earliest first' },
  { value: 'primaryCompletion:desc', label: 'Date latest first' },
  { value: 'yes:desc', label: 'Yes highest first' },
  { value: 'yes:asc', label: 'Yes lowest first' },
  { value: 'no:desc', label: 'No highest first' },
  { value: 'no:asc', label: 'No lowest first' },
  { value: 'volume:desc', label: 'Volume highest first' },
  { value: 'volume:asc', label: 'Volume lowest first' },
  { value: 'aiYes:desc', label: 'AI yes highest first' },
  { value: 'aiYes:asc', label: 'AI yes lowest first' },
  { value: 'aiNo:desc', label: 'AI no highest first' },
  { value: 'aiNo:asc', label: 'AI no lowest first' },
]
const RESOLVED_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'default', label: 'Default order' },
  { value: 'market:asc', label: 'Trial A-Z' },
  { value: 'market:desc', label: 'Trial Z-A' },
  { value: 'resolvedAt:desc', label: 'Resolved newest first' },
  { value: 'resolvedAt:asc', label: 'Resolved oldest first' },
  { value: 'outcome:asc', label: 'Outcome A-Z' },
  { value: 'outcome:desc', label: 'Outcome Z-A' },
  { value: 'volume:desc', label: 'Volume highest first' },
  { value: 'volume:asc', label: 'Volume lowest first' },
  { value: 'aiYes:desc', label: 'AI yes highest first' },
  { value: 'aiYes:asc', label: 'AI yes lowest first' },
  { value: 'aiNo:desc', label: 'AI no highest first' },
  { value: 'aiNo:asc', label: 'AI no lowest first' },
]

function isLocalhostHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseSortableTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function parseFilterDateValue(value: string | null | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null

  const parsed = new Date(`${trimmed}T00:00:00.000Z`).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getRowFilterTimestamp(row: TrialsBrowseRow, tab: TrialsBrowseTab): number | null {
  const rawValue = tab === 'resolved' ? row.resolvedAt : row.decisionDate
  const parsed = parseSortableTimestamp(rawValue)
  if (parsed === null) return null

  const date = new Date(parsed)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function compareNullableNumbers(a: number | null | undefined, b: number | null | undefined, direction: TrialsBrowseSortDirection): number {
  const aIsMissing = a === null || a === undefined || Number.isNaN(a)
  const bIsMissing = b === null || b === undefined || Number.isNaN(b)

  if (aIsMissing && bIsMissing) return 0
  if (aIsMissing) return 1
  if (bIsMissing) return -1

  return direction === 'asc' ? a - b : b - a
}

function compareStrings(a: string, b: string, direction: TrialsBrowseSortDirection): number {
  const comparison = a.localeCompare(b, 'en', { sensitivity: 'base' })
  return direction === 'asc' ? comparison : -comparison
}

function findMatchingTypeOption(rawType: string | null, typeOptions: string[]): string {
  if (!rawType) return ALL_TYPES_FILTER

  const normalizedRawType = rawType.trim().toLowerCase()
  if (!normalizedRawType) return ALL_TYPES_FILTER

  return typeOptions.find((typeOption) => typeOption.toLowerCase() === normalizedRawType) ?? ALL_TYPES_FILTER
}

function normalizeTabValue(rawTab: string | null): TrialsBrowseTab {
  return rawTab?.trim().toLowerCase() === 'resolved' ? 'resolved' : 'upcoming'
}

function getInitialSortDirection(key: TrialsBrowseSortKey): TrialsBrowseSortDirection {
  if (key === 'market' || key === 'primaryCompletion') return 'asc'
  if (key === 'resolvedAt') return 'desc'
  if (key === 'outcome') return 'asc'
  return 'desc'
}

function getSortOptions(tab: TrialsBrowseTab): ReadonlyArray<{ value: string; label: string }> {
  return tab === 'resolved' ? RESOLVED_SORT_OPTIONS : UPCOMING_SORT_OPTIONS
}

function getSortControlValue(sortState: TrialsBrowseSortState, tab: TrialsBrowseTab): string {
  if (!sortState) return 'default'

  const value = `${sortState.key}:${sortState.direction}`
  return getSortOptions(tab).some((option) => option.value === value) ? value : 'default'
}

function parseSortControlValue(value: string, tab: TrialsBrowseTab): TrialsBrowseSortState {
  if (value === 'default') return null

  const matchingOption = getSortOptions(tab).find((option) => option.value === value)
  if (!matchingOption) return null

  const [key, direction] = value.split(':') as [TrialsBrowseSortKey, TrialsBrowseSortDirection]
  return { key, direction }
}

function sortUpcomingRows(rows: IndexedTrialsBrowseRow[]): IndexedTrialsBrowseRow[] {
  const copy = [...rows]
  return copy.sort((a, b) => {
    const aDays = a.daysUntil ?? Number.POSITIVE_INFINITY
    const bDays = b.daysUntil ?? Number.POSITIVE_INFINITY
    if (aDays !== bDays) return aDays - bDays
    if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount
    return b.absMove - a.absMove
  })
}

function sortResolvedRows(rows: IndexedTrialsBrowseRow[]): IndexedTrialsBrowseRow[] {
  const copy = [...rows]
  return copy.sort((a, b) => {
    const dateComparison = compareNullableNumbers(
      parseSortableTimestamp(a.resolvedAt),
      parseSortableTimestamp(b.resolvedAt),
      'desc',
    )
    if (dateComparison !== 0) return dateComparison
    if (b.volumeUsd !== a.volumeUsd) return b.volumeUsd - a.volumeUsd
    return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
  })
}

function sortRows(
  rows: IndexedTrialsBrowseRow[],
  sortState: TrialsBrowseSortState,
  tab: TrialsBrowseTab,
): IndexedTrialsBrowseRow[] {
  if (!sortState) {
    return tab === 'resolved' ? sortResolvedRows(rows) : sortUpcomingRows(rows)
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      let comparison = 0

      switch (sortState.key) {
        case 'market':
          comparison = compareStrings(a.row.title, b.row.title, sortState.direction)
          if (comparison === 0) {
            comparison = compareStrings(a.row.companyName, b.row.companyName, sortState.direction)
          }
          break
        case 'primaryCompletion':
          comparison = compareNullableNumbers(
            parseSortableTimestamp(a.row.decisionDate),
            parseSortableTimestamp(b.row.decisionDate),
            sortState.direction,
          )
          break
        case 'resolvedAt':
          comparison = compareNullableNumbers(
            parseSortableTimestamp(a.row.resolvedAt),
            parseSortableTimestamp(b.row.resolvedAt),
            sortState.direction,
          )
          break
        case 'outcome':
          comparison = compareStrings(
            a.row.resolvedOutcome ?? '—',
            b.row.resolvedOutcome ?? '—',
            sortState.direction,
          )
          break
        case 'yes':
          comparison = compareNullableNumbers(a.row.yesPrice, b.row.yesPrice, sortState.direction)
          break
        case 'no':
          comparison = compareNullableNumbers(a.row.noPrice, b.row.noPrice, sortState.direction)
          break
        case 'volume':
          comparison = compareNullableNumbers(a.row.volumeUsd, b.row.volumeUsd, sortState.direction)
          break
        case 'aiYes':
          comparison = compareNullableNumbers(a.row.aiApproveCount, b.row.aiApproveCount, sortState.direction)
          break
        case 'aiNo':
          comparison = compareNullableNumbers(a.row.aiRejectCount, b.row.aiRejectCount, sortState.direction)
          break
        default:
          comparison = 0
      }

      if (comparison === 0 && tab === 'resolved' && sortState.key !== 'resolvedAt') {
        comparison = compareNullableNumbers(
          parseSortableTimestamp(a.row.resolvedAt),
          parseSortableTimestamp(b.row.resolvedAt),
          'desc',
        )
      }

      return comparison !== 0 ? comparison : a.index - b.index
    })
    .map(({ row }) => row)
}

function SortableTrialsTableHeader({
  label,
  sortKey,
  sortState,
  onSort,
  align = 'left',
  className,
}: {
  label: string
  sortKey: TrialsBrowseSortKey
  sortState: TrialsBrowseSortState
  onSort: (key: TrialsBrowseSortKey) => void
  align?: 'left' | 'center'
  className?: string
}) {
  const isActive = sortState?.key === sortKey
  const direction = isActive ? sortState.direction : null
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
  const icon = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : null

  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        'py-2.5 whitespace-nowrap font-sans text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]',
        align === 'left' ? 'text-left' : 'text-center',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex w-full cursor-pointer items-center bg-transparent p-0 font-sans text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] hover:text-[#3a342d] focus-visible:outline-none',
          align === 'left' ? 'justify-start text-left' : 'justify-center text-center',
        )}
        title={`Sort by ${label}`}
      >
        <span className="leading-[1.3]">{label}</span>
        {icon ? <span className="ml-1.5 text-[11px] leading-none text-[#8a8075]">{icon}</span> : null}
      </button>
    </th>
  )
}

function TrialsBrowseSearchControls({
  fromDateValue,
  onClearDateRange,
  onDateRangeChange,
  selectedTab,
  toDateValue,
  onTabChange,
  onAppliedSearchQueryChange,
  sortState,
  onSortStateChange,
}: {
  fromDateValue: string
  onClearDateRange: () => void
  onDateRangeChange: (range: { from: string; to: string }) => void
  selectedTab: TrialsBrowseTab
  toDateValue: string
  onTabChange: (tab: TrialsBrowseTab) => void
  onAppliedSearchQueryChange: (value: string) => void
  sortState: TrialsBrowseSortState
  onSortStateChange: (next: TrialsBrowseSortState) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const sortOptions = getSortOptions(selectedTab)

  useEffect(() => {
    startTransition(() => {
      onAppliedSearchQueryChange(deferredSearchQuery)
    })
  }, [deferredSearchQuery, onAppliedSearchQueryChange])

  return (
    <div className="space-y-3">
      <div className="inline-flex w-fit flex-wrap items-end gap-5 self-start border-b border-[#e7ddd0]">
        <button
          type="button"
          onClick={() => onTabChange('upcoming')}
          className={cn(
            'relative -mb-px inline-flex items-center pb-3 font-medium uppercase transition-colors focus-visible:outline-none',
            selectedTab === 'upcoming'
              ? 'text-[#1a1a1a] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:rounded-full after:[background:linear-gradient(90deg,_#EF6F67,_#5DBB63,_#D39D2E,_#5BA5ED)]'
              : 'text-[#9d9184] hover:text-[#3a342d]',
          )}
        >
          <span className={cn('tracking-[0.1em]', selectedTab === 'upcoming' ? 'text-[11px]' : 'text-[10px]')}>
            Open
          </span>
        </button>
        <button
          type="button"
          onClick={() => onTabChange('resolved')}
          className={cn(
            'relative -mb-px inline-flex items-center pb-3 font-medium uppercase transition-colors focus-visible:outline-none',
            selectedTab === 'resolved'
              ? 'text-[#1a1a1a] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:rounded-full after:[background:linear-gradient(90deg,_#EF6F67,_#5DBB63,_#D39D2E,_#5BA5ED)]'
              : 'text-[#9d9184] hover:text-[#3a342d]',
          )}
        >
          <span className={cn('tracking-[0.1em]', selectedTab === 'resolved' ? 'text-[11px]' : 'text-[10px]')}>
            Resolved
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-[26rem]">
          <label className="sr-only" htmlFor="trials-browse-search">
            Search all trials
          </label>
          <input
            id="trials-browse-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search all trials..."
            className={SEARCH_INPUT_CLASS_NAME}
            style={SEARCH_INPUT_STYLE}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-[12rem]">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]" htmlFor="trials-browse-sort">
              Sort
            </label>
            <select
              id="trials-browse-sort"
              value={getSortControlValue(sortState, selectedTab)}
              onChange={(event) => onSortStateChange(parseSortControlValue(event.target.value, selectedTab))}
              className={SORT_SELECT_CLASS_NAME}
              style={SORT_SELECT_STYLE}
              aria-label={selectedTab === 'resolved' ? 'Sort resolved trials' : 'Sort open trials'}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem]">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]" htmlFor="trials-browse-date-from">
              From
            </label>
            <input
              id="trials-browse-date-from"
              type="date"
              value={fromDateValue}
              onChange={(event) => onDateRangeChange({ from: event.target.value, to: toDateValue })}
              className={DATE_INPUT_CLASS_NAME}
            />
          </div>

          <div className="min-w-[10rem]">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]" htmlFor="trials-browse-date-to">
              To
            </label>
            <input
              id="trials-browse-date-to"
              type="date"
              value={toDateValue}
              onChange={(event) => onDateRangeChange({ from: fromDateValue, to: event.target.value })}
              className={DATE_INPUT_CLASS_NAME}
            />
          </div>

          <button
            type="button"
            onClick={onClearDateRange}
            disabled={!fromDateValue && !toDateValue}
            className="inline-flex min-w-[6rem] items-center justify-center rounded-none border border-[#e7ddd0] bg-white px-3 py-2 text-xs text-[#5b5148] transition-colors hover:border-[#d7c8b6] hover:bg-[#fbf8f4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

const TrialsBrowsePagination = memo(function TrialsBrowsePagination({
  currentPage,
  pageCount,
  pageSize,
  totalRows,
  onPageChange,
}: {
  currentPage: number
  pageCount: number
  pageSize: number
  totalRows: number
  onPageChange: (page: number) => void
}) {
  if (totalRows === 0) return null

  const startRow = (currentPage - 1) * pageSize + 1
  const endRow = Math.min(currentPage * pageSize, totalRows)

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-[#8a8075]">
        Showing {startRow}-{endRow} of {totalRows.toLocaleString('en-US')}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="inline-flex min-w-[5.5rem] items-center justify-center rounded-none border border-[#e7ddd0] bg-white px-3 py-2 text-xs text-[#5b5148] transition-colors hover:border-[#d7c8b6] hover:bg-[#fbf8f4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <div className="min-w-[6rem] text-center text-xs text-[#8a8075]">
          Page {currentPage} of {pageCount}
        </div>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= pageCount}
          className="inline-flex min-w-[5.5rem] items-center justify-center rounded-none border border-[#e7ddd0] bg-white px-3 py-2 text-xs text-[#5b5148] transition-colors hover:border-[#d7c8b6] hover:bg-[#fbf8f4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  )
})

const TrialsBrowseTableSection = memo(function TrialsBrowseTableSection({
  rows,
  selectedTab,
  sortState,
  onSort,
  detailBasePath,
  totalFilteredRows,
  currentPage,
  pageCount,
  onPageChange,
  refreshing,
}: {
  rows: IndexedTrialsBrowseRow[]
  selectedTab: TrialsBrowseTab
  sortState: TrialsBrowseSortState
  onSort: (key: TrialsBrowseSortKey) => void
  detailBasePath: string
  totalFilteredRows: number
  currentPage: number
  pageCount: number
  onPageChange: (page: number) => void
  refreshing: boolean
}) {
  const router = useRouter()

  function navigateToMarket(href: string) {
    router.push(href)
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, href: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToMarket(href)
  }

  const emptyMessage = selectedTab === 'resolved'
    ? 'No resolved trials match the current filters.'
    : 'No open trials match the current filters.'

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Phase 2 Trials</h2>
          <HeaderDots />
          {refreshing ? <span className="text-[11px] text-[#b5aa9e]">Refreshing...</span> : null}
        </div>

        <div className="text-xs text-[#b5aa9e] sm:ml-auto">
          {totalFilteredRows.toLocaleString('en-US')} rows
        </div>
      </div>

      <div className="overflow-hidden rounded-sm" style={PANEL_FRAME_STYLE}>
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-[#8a8075]">{emptyMessage}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full table-fixed border-collapse">
                  {selectedTab === 'resolved' ? (
                    <colgroup>
                      <col className="w-[48%]" />
                      <col className="w-[12%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                    </colgroup>
                  ) : (
                    <colgroup>
                      <col className="w-[44%]" />
                      <col className="w-[13%]" />
                      <col className="w-[6%]" />
                      <col className="w-[6%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10.5%]" />
                      <col className="w-[10.5%]" />
                    </colgroup>
                  )}
                  <thead>
                    <tr className="border-b border-[#e8ddd0]">
                      <SortableTrialsTableHeader
                        label="Trial"
                        sortKey="market"
                        sortState={sortState}
                        onSort={onSort}
                        align="left"
                        className="px-4"
                      />
                      <SortableTrialsTableHeader
                        label={selectedTab === 'resolved' ? 'Resolved' : 'Date'}
                        sortKey={selectedTab === 'resolved' ? 'resolvedAt' : 'primaryCompletion'}
                        sortState={sortState}
                        onSort={onSort}
                        align="center"
                        className="px-2"
                      />
                      {selectedTab === 'resolved' ? (
                        <SortableTrialsTableHeader
                          label="Outcome"
                          sortKey="outcome"
                          sortState={sortState}
                          onSort={onSort}
                          align="center"
                          className="px-1.5"
                        />
                      ) : (
                        <>
                          <SortableTrialsTableHeader
                            label="Yes"
                            sortKey="yes"
                            sortState={sortState}
                            onSort={onSort}
                            align="center"
                            className="px-1.5"
                          />
                          <SortableTrialsTableHeader
                            label="No"
                            sortKey="no"
                            sortState={sortState}
                            onSort={onSort}
                            align="center"
                            className="px-1.5"
                          />
                        </>
                      )}
                      <SortableTrialsTableHeader
                        label="Volume"
                        sortKey="volume"
                        sortState={sortState}
                        onSort={onSort}
                        align="center"
                        className="px-1.5"
                      />
                      <SortableTrialsTableHeader
                        label="AI Yes"
                        sortKey="aiYes"
                        sortState={sortState}
                        onSort={onSort}
                        align="center"
                        className="px-3"
                      />
                      <SortableTrialsTableHeader
                        label="AI No"
                        sortKey="aiNo"
                        sortState={sortState}
                        onSort={onSort}
                        align="center"
                        className="px-3"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const marketHref = `${detailBasePath}/${encodeURIComponent(row.marketId)}`
                      const isAwaitingFirstRun = row.aiApproveCount === 0 && row.aiRejectCount === 0

                      return (
                        <tr
                          key={`trials-browse-row-${row.marketId}`}
                          tabIndex={0}
                          role="link"
                          aria-label={`Open ${row.title}`}
                          onClick={() => navigateToMarket(marketHref)}
                          onKeyDown={(event) => handleRowKeyDown(event, marketHref)}
                          className="cursor-pointer border-b border-[#e8ddd0] align-top transition-colors last:border-b-0 hover:bg-[#f7f1e8]/45 focus-visible:bg-[#f7f1e8]/45 focus-visible:outline-none"
                        >
                          <td className="px-4 py-3.5">
                            <Link href={marketHref} className="block">
                              <div className="text-base font-medium text-[#1a1a1a] hover:text-[#111111]">
                                {row.title}
                              </div>
                              <div className="mt-1 text-sm text-[#5b5148]">{row.companyName}</div>
                              <div className="mt-1.5 max-w-[28rem] text-xs leading-relaxed text-[#8a8075]">
                                {row.description}
                              </div>
                            </Link>
                          </td>
                          <td className="px-2 py-3.5 text-center">
                            <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#5b5148]">
                              {selectedTab === 'resolved'
                                ? formatShortDateUtc(row.resolvedAt)
                                : formatShortDateUtc(row.decisionDate)}
                            </div>
                          </td>
                          {selectedTab === 'resolved' ? (
                            <td className="px-1.5 py-3.5 text-center">
                              <div
                                className={cn(
                                  'flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35]',
                                  row.resolvedOutcome === 'YES'
                                    ? 'text-[#3a8a2e]'
                                    : row.resolvedOutcome === 'NO'
                                      ? 'text-[#c43a2b]'
                                      : 'text-[#8a8075]',
                                )}
                              >
                                {row.resolvedOutcome ?? '—'}
                              </div>
                            </td>
                          ) : (
                            <>
                              <td className="px-1.5 py-3.5 text-center">
                                <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#3a8a2e]">
                                  {formatPercent(row.yesPrice, 0)}
                                </div>
                              </td>
                              <td className="px-1.5 py-3.5 text-center">
                                <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#c43a2b]">
                                  {formatPercent(row.noPrice, 0)}
                                </div>
                              </td>
                            </>
                          )}
                          <td className="px-1.5 py-3.5 text-center">
                            <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#5b5148]">
                              {formatCompactMoney(row.volumeUsd)}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <div className={`flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] ${isAwaitingFirstRun ? 'text-[#8a8075]' : 'text-[#2f7b40]'}`}>
                              {isAwaitingFirstRun ? '—' : row.aiApproveCount}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <div className={`flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] ${isAwaitingFirstRun ? 'text-[#8a8075]' : 'text-[#9b3028]'}`}>
                              {isAwaitingFirstRun ? '—' : row.aiRejectCount}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
              </table>
            </div>

          </>
        )}
      </div>

      {rows.length > 0 ? (
        <TrialsBrowsePagination
          currentPage={currentPage}
          pageCount={pageCount}
          pageSize={PAGE_SIZE}
          totalRows={totalFilteredRows}
          onPageChange={onPageChange}
        />
      ) : null}
    </section>
  )
})

export function TrialsBrowseTable({
  initialData = null,
  initialFromDate = null,
  initialTypeFilter = null,
  initialStatusTab = null,
  initialToDate = null,
  detailBasePath = '/trials',
  includeResolved = true,
}: {
  initialData?: TrialsBrowseResponse | null
  initialFromDate?: string | null
  initialTypeFilter?: string | null
  initialStatusTab?: string | null
  initialToDate?: string | null
  detailBasePath?: string
  includeResolved?: boolean
}) {
  const { data, error, loading, refreshing } = useTrialsBrowseData(initialData, { includeResolved })
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('')
  const [selectedFromDateParam, setSelectedFromDateParam] = useState<string | null>(initialFromDate)
  const [selectedTypeParam, setSelectedTypeParam] = useState<string | null>(initialTypeFilter)
  const [selectedTabParam, setSelectedTabParam] = useState<string | null>(initialStatusTab)
  const [selectedToDateParam, setSelectedToDateParam] = useState<string | null>(initialToDate)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortState, setSortState] = useState<TrialsBrowseSortState>(null)

  const indexedUpcomingRows = useMemo(() => {
    return (data?.openMarkets || []).map((row) => {
      const searchText = [
        row.title,
        row.question,
        row.companyName,
        row.sponsorName,
        row.nctId,
        row.applicationTypeLabel,
        row.description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return {
        ...row,
        searchText,
        normalizedSearchText: normalizeSearchValue(searchText),
      }
    })
  }, [data?.openMarkets])

  const indexedResolvedRows = useMemo(() => {
    return (data?.resolvedMarkets || []).map((row) => {
      const searchText = [
        row.title,
        row.question,
        row.companyName,
        row.sponsorName,
        row.nctId,
        row.applicationTypeLabel,
        row.description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return {
        ...row,
        searchText,
        normalizedSearchText: normalizeSearchValue(searchText),
      }
    })
  }, [data?.resolvedMarkets])

  const selectedTab = useMemo(() => normalizeTabValue(selectedTabParam), [selectedTabParam])
  const rows = selectedTab === 'resolved' ? indexedResolvedRows : indexedUpcomingRows
  const normalizedSearchQuery = useMemo(
    () => appliedSearchQuery.trim().replace(/\s+/g, ' '),
    [appliedSearchQuery],
  )

  const typeOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => row.applicationTypeLabel).filter((label) => label && label !== '—')),
    ).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  }, [rows])

  const selectedType = useMemo(() => {
    return findMatchingTypeOption(selectedTypeParam, typeOptions)
  }, [selectedTypeParam, typeOptions])

  useEffect(() => {
    setSelectedFromDateParam(searchParams.get(FROM_FILTER_PARAM))
  }, [searchParams])

  useEffect(() => {
    setSelectedTypeParam(searchParams.get(TYPE_FILTER_PARAM))
  }, [searchParams])

  useEffect(() => {
    setSelectedTabParam(searchParams.get(TAB_FILTER_PARAM))
  }, [searchParams])

  useEffect(() => {
    setSelectedToDateParam(searchParams.get(TO_FILTER_PARAM))
  }, [searchParams])

  useEffect(() => {
    setCurrentPage(1)
  }, [normalizedSearchQuery, selectedType, selectedTab])

  useEffect(() => {
    setSortState(null)
  }, [selectedTab])

  function handleTabChange(nextTab: TrialsBrowseTab) {
    const nextParams = new URLSearchParams(searchParams.toString())
    const nextTabParam = nextTab === 'resolved' ? 'resolved' : null

    setSelectedTabParam(nextTabParam)

    if (!nextTabParam) {
      nextParams.delete(TAB_FILTER_PARAM)
    } else {
      nextParams.set(TAB_FILTER_PARAM, nextTabParam)
    }

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  function handleSort(nextKey: TrialsBrowseSortKey) {
    setSortState((current) => {
      if (!current || current.key !== nextKey) {
        return {
          key: nextKey,
          direction: getInitialSortDirection(nextKey),
        }
      }

      return {
        key: nextKey,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      }
    })
  }

  function updateQueryParamState(next: { from?: string | null; to?: string | null; tab?: string | null }) {
    const nextParams = new URLSearchParams(searchParams.toString())

    if ('from' in next) {
      const nextFrom = next.from?.trim() ?? ''
      setSelectedFromDateParam(nextFrom || null)
      if (!nextFrom) nextParams.delete(FROM_FILTER_PARAM)
      else nextParams.set(FROM_FILTER_PARAM, nextFrom)
    }

    if ('to' in next) {
      const nextTo = next.to?.trim() ?? ''
      setSelectedToDateParam(nextTo || null)
      if (!nextTo) nextParams.delete(TO_FILTER_PARAM)
      else nextParams.set(TO_FILTER_PARAM, nextTo)
    }

    if ('tab' in next) {
      const nextTab = next.tab?.trim() ?? ''
      setSelectedTabParam(nextTab || null)
      if (!nextTab) nextParams.delete(TAB_FILTER_PARAM)
      else nextParams.set(TAB_FILTER_PARAM, nextTab)
    }

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  const filteredRows = useMemo(() => {
    const query = normalizedSearchQuery.toLowerCase()
    const normalizedQuery = normalizeSearchValue(query)
    const parsedFrom = parseFilterDateValue(selectedFromDateParam)
    const parsedTo = parseFilterDateValue(selectedToDateParam)
    const minDate = parsedFrom === null || parsedTo === null ? parsedFrom : Math.min(parsedFrom, parsedTo)
    const maxDate = parsedFrom === null || parsedTo === null ? parsedTo : Math.max(parsedFrom, parsedTo)

    return rows.filter((row) => {
      if (selectedType !== ALL_TYPES_FILTER && row.applicationTypeLabel !== selectedType) {
        return false
      }

      if (minDate !== null || maxDate !== null) {
        const rowTimestamp = getRowFilterTimestamp(row, selectedTab)
        if (rowTimestamp === null) return false
        if (minDate !== null && rowTimestamp < minDate) return false
        if (maxDate !== null && rowTimestamp > maxDate) return false
      }

      if (!query) return true
      if (row.searchText.includes(query)) return true

      return normalizedQuery.length > 0 && row.normalizedSearchText.includes(normalizedQuery)
    })
  }, [normalizedSearchQuery, rows, selectedFromDateParam, selectedTab, selectedToDateParam, selectedType])

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, sortState, selectedTab)
  }, [filteredRows, selectedTab, sortState])

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pageCount))
  }, [pageCount])

  const visibleRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return sortedRows.slice(start, start + PAGE_SIZE)
  }, [currentPage, sortedRows])

  useEffect(() => {
    if (normalizedSearchQuery.length < 2) return
    if (typeof window === 'undefined') return
    if (isLocalhostHostname(window.location.hostname)) return

    const storageKey = `trial-search:${pathname}:${normalizedSearchQuery.toLowerCase()}`

    try {
      if (window.sessionStorage.getItem(storageKey) === '1') {
        return
      }
    } catch {
      // Ignore storage failures and continue without dedupe persistence.
    }

    const timer = window.setTimeout(() => {
      const payload = JSON.stringify({
        events: [{
          type: 'trial_search',
          url: pathname,
          referrer: typeof document !== 'undefined' ? document.referrer : undefined,
          elementId: 'trials-browse-search',
          searchQuery: normalizedSearchQuery,
          resultCount: sortedRows.length,
        }],
      })

      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics', payload)
      } else {
        fetch('/api/analytics', {
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {})
      }

      try {
        window.sessionStorage.setItem(storageKey, '1')
      } catch {
        // Ignore storage failures and continue without dedupe persistence.
      }
    }, 500)

    return () => window.clearTimeout(timer)
  }, [normalizedSearchQuery, pathname, sortedRows.length])

  if (loading) {
    return (
      <div className="overflow-hidden rounded-sm p-6 text-sm text-[#8a8075]" style={PANEL_FRAME_STYLE}>Loading trials...</div>
    )
  }

  if (error && !data) {
    return (
      <div className="overflow-hidden rounded-sm p-6" style={PANEL_FRAME_STYLE}>
        <div className="border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Failed to load trials: {error}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="overflow-hidden rounded-sm p-6 text-sm text-[#8a8075]" style={PANEL_FRAME_STYLE}>No trial data.</div>
    )
  }

  return (
    <div className="space-y-4">
      <TrialsBrowseSearchControls
        fromDateValue={selectedFromDateParam ?? ''}
        onClearDateRange={() => updateQueryParamState({ from: null, to: null })}
        onDateRangeChange={(range) => updateQueryParamState(range)}
        selectedTab={selectedTab}
        toDateValue={selectedToDateParam ?? ''}
        onTabChange={handleTabChange}
        onAppliedSearchQueryChange={setAppliedSearchQuery}
        sortState={sortState}
        onSortStateChange={setSortState}
      />

      <TrialsBrowseTableSection
        rows={visibleRows}
        selectedTab={selectedTab}
        sortState={sortState}
        onSort={handleSort}
        detailBasePath={detailBasePath}
        totalFilteredRows={sortedRows.length}
        currentPage={currentPage}
        pageCount={pageCount}
        onPageChange={setCurrentPage}
        refreshing={refreshing}
      />
    </div>
  )
}
