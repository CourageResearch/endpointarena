'use client'

import type { FormEvent } from 'react'
import Link from 'next/link'
import { HeaderDots } from '@/components/site/chrome'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  DASHBOARD_META_TEXT_CLASS,
  DASHBOARD_SECTION_LABEL_CLASS,
  DETAILS_BODY_TEXT_CLASS,
  DETAILS_TOP_LABEL_CLASS,
  DETAILS_CARD_BORDER_STYLE,
  formatShares,
  type HumanTradeDirection,
  type HumanTradeOutcome,
  type TraderSnapshot,
  type TweetVerificationStatus,
} from '@/components/markets/dashboard/shared'

const TRADE_DIRECTION_TAB_CLASS = 'relative inline-flex h-7 items-end px-0 pb-[6px] !font-sans !text-[11px] !font-medium uppercase tracking-[0.18em] !leading-none transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:scale-x-0 after:rounded-full after:bg-current after:transition-transform focus-visible:outline-none disabled:cursor-not-allowed'

export function MarketTradePanel({
  className,
  marketQuestion,
  sessionStatus,
  verificationStatus,
  safeCallbackUrl,
  isTradeVerified,
  tradeDirection,
  tradeOutcome,
  yesPriceCents,
  noPriceCents,
  tradeAmountUsd,
  canSubmitTrade,
  tradeSubmitting,
  tradeError,
  tradeNotice,
  traderSnapshot,
  traderSnapshotLoading,
  onTradeDirectionChange,
  onTradeOutcomeChange,
  onTradeAmountChange,
  onSubmit,
}: {
  className?: string
  marketQuestion: string
  sessionStatus: 'authenticated' | 'unauthenticated' | 'loading'
  verificationStatus: TweetVerificationStatus | null
  safeCallbackUrl: string
  isTradeVerified: boolean
  tradeDirection: HumanTradeDirection
  tradeOutcome: HumanTradeOutcome
  yesPriceCents: number
  noPriceCents: number
  tradeAmountUsd: string
  canSubmitTrade: boolean
  tradeSubmitting: boolean
  tradeError: string | null
  tradeNotice: string | null
  traderSnapshot: TraderSnapshot | null
  traderSnapshotLoading: boolean
  onTradeDirectionChange: (direction: HumanTradeDirection) => void
  onTradeOutcomeChange: (outcome: HumanTradeOutcome) => void
  onTradeAmountChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const showVerificationPrompt = sessionStatus === 'authenticated' && verificationStatus && !verificationStatus.verified

  const gatedTradeAction = sessionStatus === 'unauthenticated'
    ? {
        href: `/signup?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`,
        label: 'Create account to trade',
        body: 'Create your account to place paper trades and track your points.',
      }
    : showVerificationPrompt
      ? {
          href: `/profile?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`,
          label: 'Complete verification',
          body: verificationStatus.connected
            ? 'Post one verification tweet to unlock trading.'
            : 'Connect your X account and post one verification tweet to unlock trading.',
        }
      : null

  return (
    <section className={cn('space-y-3', className)}>
      <div className="px-1">
        <div className="flex items-center gap-3">
          <div className={DASHBOARD_SECTION_LABEL_CLASS}>Trade</div>
          <HeaderDots />
        </div>
      </div>

      <div className="rounded-none">
        <div className="rounded-none border border-transparent p-4" style={DETAILS_CARD_BORDER_STYLE}>
          <div className="-mx-4 -mt-4 mb-4 border-b border-[#e8ddd0] bg-[#f8f3ec]/45 px-4">
            <div className="flex items-center gap-0">
              <button
                type="button"
                disabled={!isTradeVerified}
                onClick={() => onTradeDirectionChange('buy')}
                className={cn(
                  TRADE_DIRECTION_TAB_CLASS,
                  tradeDirection === 'buy'
                    ? isTradeVerified
                      ? 'text-[#61584e] after:scale-x-100'
                      : 'text-[#b8aa99] after:scale-x-100'
                    : isTradeVerified
                      ? 'text-[#978a7b] hover:text-[#7f7468]'
                      : 'text-[#b8aa99]',
                )}
              >
                Buy
              </button>
              <button
                type="button"
                disabled={!isTradeVerified}
                onClick={() => onTradeDirectionChange('sell')}
                className={cn(
                  'ml-3',
                  TRADE_DIRECTION_TAB_CLASS,
                  tradeDirection === 'sell'
                    ? isTradeVerified
                      ? 'text-[#61584e] after:scale-x-100'
                      : 'text-[#b8aa99] after:scale-x-100'
                    : isTradeVerified
                      ? 'text-[#978a7b] hover:text-[#7f7468]'
                      : 'text-[#b8aa99]',
                )}
              >
                Sell
              </button>
            </div>
          </div>

          <p className={cn('mb-3', DETAILS_BODY_TEXT_CLASS)}>
            {marketQuestion}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!isTradeVerified}
              onClick={() => onTradeOutcomeChange('yes')}
              className={cn(
                'rounded-sm border px-3 py-3 text-center text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-65',
                tradeOutcome === 'yes'
                  ? tradeDirection === 'buy'
                    ? 'border-[#5DBB63] bg-[#5DBB63]/15 text-[#2f7b40]'
                    : 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                  : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075] hover:bg-[#f3ebe0]',
              )}
            >
              Yes {yesPriceCents}¢
            </button>
            <button
              type="button"
              disabled={!isTradeVerified}
              onClick={() => onTradeOutcomeChange('no')}
              className={cn(
                'rounded-sm border px-3 py-3 text-center text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-65',
                tradeOutcome === 'no'
                  ? 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                  : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075] hover:bg-[#f3ebe0]',
              )}
            >
              No {noPriceCents}¢
            </button>
          </div>

          <form className="mt-3 space-y-3" onSubmit={onSubmit}>
            <label className="block">
              <span className={cn(
                'mb-1 block text-[10px] font-medium uppercase tracking-[0.16em]',
                isTradeVerified ? 'text-[#8a8075]' : 'text-[#b5aa9e]',
              )}>
                Amount (USD)
              </span>
              <input
                value={tradeAmountUsd}
                onChange={(event) => onTradeAmountChange(event.target.value)}
                inputMode="decimal"
                disabled={!isTradeVerified}
                className="h-10 w-full rounded-sm border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] disabled:cursor-not-allowed disabled:border-[#e4dbd0] disabled:bg-[#f4eee6] disabled:text-[#b5aa9e] disabled:placeholder:text-[#cfc4b7]"
                placeholder="1"
              />
            </label>

            <div className="inline-flex items-center rounded-full border border-[#d9cdbf] bg-[#f8f3ec] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#8a8075]">
              Paper Trading
            </div>

            {gatedTradeAction ? (
              <>
                <p className="text-sm leading-relaxed text-[#6f665b]">
                  {gatedTradeAction.body}
                </p>
                <Link
                  href={gatedTradeAction.href}
                  className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
                >
                  {gatedTradeAction.label}
                </Link>
              </>
            ) : (
              <button
                type="submit"
                disabled={!canSubmitTrade}
                className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0] disabled:cursor-not-allowed disabled:border-[#e4dbd0] disabled:bg-[#f4eee6] disabled:text-[#b5aa9e]"
              >
                {tradeSubmitting ? 'Submitting...' : `Trade ${tradeDirection === 'buy' ? 'Buy' : 'Sell'}`}
              </button>
            )}
          </form>

          {tradeError ? (
            <p className="mt-3 rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
              {tradeError}
            </p>
          ) : null}

          {tradeNotice ? (
            <p className="mt-3 rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 px-3 py-2 text-sm text-[#2f7b40]">
              {tradeNotice}
            </p>
          ) : null}
        </div>
      </div>

      {isTradeVerified ? (
        <>
          <dl className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-1', DASHBOARD_META_TEXT_CLASS)}>
            <div className="inline-flex items-baseline gap-1.5">
              <dt className={DETAILS_TOP_LABEL_CLASS}>Cash</dt>
              <dd className={DASHBOARD_META_TEXT_CLASS}>{formatCompactMoney(traderSnapshot?.cashBalance ?? 0)}</dd>
            </div>
            <div className="inline-flex items-baseline gap-1.5">
              <dt className={DETAILS_TOP_LABEL_CLASS}>YES Shares</dt>
              <dd className={DASHBOARD_META_TEXT_CLASS}>{formatShares(traderSnapshot?.yesShares ?? 0)}</dd>
            </div>
            <div className="inline-flex items-baseline gap-1.5">
              <dt className={DETAILS_TOP_LABEL_CLASS}>NO Shares</dt>
              <dd className={DASHBOARD_META_TEXT_CLASS}>{formatShares(traderSnapshot?.noShares ?? 0)}</dd>
            </div>
          </dl>
          {traderSnapshotLoading ? (
            <p className="px-1 text-[11px] text-[#8a8075]">Refreshing balances...</p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
