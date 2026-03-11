'use client'

import type { FormEvent } from 'react'
import Link from 'next/link'
import { HeaderDots } from '@/components/site/chrome'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  DETAILS_CARD_BORDER_STYLE,
  formatShares,
  type HumanTradeDirection,
  type HumanTradeOutcome,
  type TraderSnapshot,
  type TweetVerificationStatus,
} from '@/components/markets/dashboard/shared'

export function MarketTradePanel({
  className,
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
  return (
    <section className={cn('space-y-3', className)}>
      <div className="px-1">
        <div className="flex items-center gap-3">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#aa9d8d]">Trade</div>
          <HeaderDots />
        </div>
      </div>

      {sessionStatus === 'unauthenticated' ? (
        <div className="rounded-sm border border-[#ef6f67] bg-[#fdfbf8] px-3 py-2 text-sm text-[#6f665b]">
          <p className="font-medium text-[#1a1a1a]">Create an account to trade.</p>
          <p className="mt-1">Create your account to place paper trades and track your points.</p>
          <Link
            href={`/signup?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`}
            className="mt-2 inline-flex rounded-sm border border-[#d9cdbf] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] hover:bg-[#f5eee5]"
          >
            Create account
          </Link>
        </div>
      ) : null}

      {sessionStatus === 'authenticated' && verificationStatus && !verificationStatus.verified ? (
        <div className="rounded-sm border border-[#ef6f67] bg-[#fdfbf8] px-3 py-2 text-sm text-[#6f665b]">
          <p className="font-medium text-[#1a1a1a]">Complete one-time X verification to trade.</p>
          <p className="mt-1">
            {verificationStatus.connected
              ? 'Post one verification tweet to unlock trading.'
              : 'Connect your X account and post one verification tweet to unlock trading.'}
          </p>
          <Link
            href={`/profile?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`}
            className="mt-2 inline-flex rounded-sm border border-[#d9cdbf] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] hover:bg-[#f5eee5]"
          >
            Complete verification
          </Link>
        </div>
      ) : null}

      <div className="rounded-md p-[1px]" style={DETAILS_CARD_BORDER_STYLE}>
        <div className="rounded-md bg-white/95 p-4">
          <div className="-mx-4 -mt-4 mb-4 border-b border-[#e8ddd0] bg-[#f8f3ec]/45 px-4">
            <div className="flex items-center gap-0">
              <button
                type="button"
                disabled={!isTradeVerified}
                onClick={() => onTradeDirectionChange('buy')}
                style={{ transform: 'scale(0.58)', transformOrigin: 'left bottom' }}
                className={cn(
                  'inline-flex items-end border-b px-0 pb-0.5 pt-2 text-xs font-medium uppercase tracking-[0.16em] leading-none font-sans transition-colors focus-visible:outline-none disabled:cursor-not-allowed',
                  tradeDirection === 'buy'
                    ? isTradeVerified
                      ? 'border-[#1a1a1a] text-[#1a1a1a]'
                      : 'border-[#b5aa9e] text-[#b5aa9e]'
                    : isTradeVerified
                      ? 'border-transparent text-[#8a8075] hover:border-[#d9ccbc] hover:text-[#1a1a1a]'
                      : 'border-transparent text-[#b5aa9e]',
                )}
              >
                Buy
              </button>
              <button
                type="button"
                disabled={!isTradeVerified}
                onClick={() => onTradeDirectionChange('sell')}
                style={{ transform: 'scale(0.58)', transformOrigin: 'left bottom' }}
                className={cn(
                  'inline-flex items-end border-b px-0 pb-0.5 pt-2 text-xs font-medium uppercase tracking-[0.16em] leading-none font-sans transition-colors focus-visible:outline-none disabled:cursor-not-allowed',
                  tradeDirection === 'sell'
                    ? isTradeVerified
                      ? 'border-[#1a1a1a] text-[#1a1a1a]'
                      : 'border-[#b5aa9e] text-[#b5aa9e]'
                    : isTradeVerified
                      ? 'border-transparent text-[#8a8075] hover:border-[#d9ccbc] hover:text-[#1a1a1a]'
                      : 'border-transparent text-[#b5aa9e]',
                )}
              >
                Sell
              </button>
            </div>
          </div>

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
                'mb-1 block text-[11px] uppercase tracking-[0.16em]',
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

            <button
              type="submit"
              disabled={!canSubmitTrade}
              className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0] disabled:cursor-not-allowed disabled:border-[#e4dbd0] disabled:bg-[#f4eee6] disabled:text-[#b5aa9e]"
            >
              {tradeSubmitting ? 'Submitting...' : `Trade ${tradeDirection === 'buy' ? 'Buy' : 'Sell'}`}
            </button>
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
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm text-[#7c7267]">
            <div className="inline-flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-[#a89b8c]">Cash</dt>
              <dd className="text-[13px] font-normal text-[#6d645a]">{formatCompactMoney(traderSnapshot?.cashBalance ?? 0)}</dd>
            </div>
            <div className="inline-flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-[#a89b8c]">YES Shares</dt>
              <dd className="text-[13px] font-normal text-[#6d645a]">{formatShares(traderSnapshot?.yesShares ?? 0)}</dd>
            </div>
            <div className="inline-flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-[#a89b8c]">NO Shares</dt>
              <dd className="text-[13px] font-normal text-[#6d645a]">{formatShares(traderSnapshot?.noShares ?? 0)}</dd>
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
