'use client'

import type { ModelId } from '@/lib/constants'
import type { OpenMarketRow } from '@/lib/markets/overview-shared'

export const APPROVE_TEXT_CLASS = 'text-[#2f7b63]'
export const REJECT_TEXT_CLASS = 'text-[#b3566b]'
export const DETAILS_CARD_SHELL_CLASS = 'rounded-sm p-[1px]'
export const DETAILS_CARD_INNER_CLASS = 'h-full rounded-sm bg-white/95 px-3 py-2'
export const DETAILS_CARD_BORDER_STYLE = {
  background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)',
} as const
export const DASHBOARD_SECTION_LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-[0.18em] text-[#aa9d8d]'
export const DETAILS_TOP_LABEL_CLASS = 'text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]'
export const DETAILS_TOP_VALUE_CLASS = 'text-[1rem] font-normal leading-[1.4] text-[#675d52] sm:text-[1.08rem]'
export const DETAILS_BODY_TEXT_CLASS = 'text-[0.97rem] font-normal leading-[1.55] text-[#675d52] sm:text-[1rem]'
export const DASHBOARD_META_TEXT_CLASS = 'text-[12px] font-normal leading-[1.4] text-[#7c7267]'

export type TweetVerificationStatus = {
  authenticated: boolean
  connected: boolean
  verified: boolean
  username: string | null
  mustStayUntil: string | null
  profile: {
    pointsBalance: number
    rank: number
  } | null
}

export type TraderSnapshot = {
  cashBalance: number
  yesShares: number
  noShares: number
}

export type HumanTradeDirection = 'buy' | 'sell'
export type HumanTradeOutcome = 'yes' | 'no'

export type MarketDashboardDecisionRow = {
  state: OpenMarketRow['modelStates'][number]
  model: {
    fullName: string
  }
  latestDecision: OpenMarketRow['modelStates'][number]['latestDecision']
  history: OpenMarketRow['modelStates'][number]['decisionHistory']
  callLabel: string
  callToneClass: string
}

export type ActivityFilterOption = {
  id: ModelId
  label: string
  active: boolean
}

export function formatDateUtcCompact(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
  })
}

export function clipText(value: string | null | undefined, maxChars: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'No details'
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars).replace(/[ ,;:]+$/, '')}...`
}

export function formatShares(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}
