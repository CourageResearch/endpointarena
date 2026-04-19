'use client'

import Link from 'next/link'
import { startTransition, useEffect, useEffectEvent, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSendTransaction, useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import { createPublicClient, encodeFunctionData, http, maxUint256, parseUnits, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { TrialOracleRunsPanel } from '@/components/TrialOracleRunsPanel'
import { MarketDecisionSnapshotsPanel } from '@/components/markets/dashboard/decision-snapshots-panel'
import { MarketDetailsPanel, MarketResolutionPanel } from '@/components/markets/dashboard/details-panel'
import {
  MarketModelPositionsPanel,
  type MarketPositionRow,
  type PositionSortKey,
  type PositionSortDirection,
  type PositionSortState,
} from '@/components/markets/dashboard/model-positions-panel'
import {
  APPROVE_TEXT_CLASS,
  DASHBOARD_META_TEXT_CLASS,
  DASHBOARD_SECTION_LABEL_CLASS,
  DETAILS_BODY_TEXT_CLASS,
  DETAILS_CARD_BORDER_STYLE,
  DETAILS_TOP_LABEL_CLASS,
  DETAILS_TOP_VALUE_CLASS,
  REJECT_TEXT_CLASS,
  type MarketDashboardDecisionRow,
} from '@/components/markets/dashboard/shared'
import { MarketDetailChart } from '@/components/markets/marketOverviewCharts'
import { Season4WalletProvisionButton } from '@/components/season4/Season4WalletProvisionButton'
import { HeaderDots } from '@/components/site/chrome'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { dispatchAccountBalanceUpdated } from '@/lib/account-balance-events'
import { useAuth } from '@/lib/auth/use-auth'
import { abbreviateType } from '@/lib/constants'
import { glossaryLookupAnchor } from '@/lib/glossary'
import { getSeason4ModelInfo, getSeason4PositionModelLabel } from '@/lib/season4-model-labels'
import { resolveSeason4TrialTab, type Season4TrialTab } from '@/lib/season4-trial-tabs'
import { MOCK_USDC_ABI, PREDICTION_MARKET_MANAGER_ABI } from '@/lib/onchain/abi'
import type { Season4MarketDetail, Season4TradeRow, Season4ViewerState } from '@/lib/season4-market-data'
import type { OpenMarketRow } from '@/lib/markets/overview-shared'
import { getMarketQuestion, isMarketClosedToTrading } from '@/lib/markets/overview-shared'
import type { TrialOracleTabData } from '@/lib/trial-oracle-types'
import { cn } from '@/lib/utils'

type TradeDirection = 'buy' | 'sell'
type TradeOutcome = 'yes' | 'no'

const BASESCAN_TX_BASE_URL = 'https://sepolia.basescan.org/tx'
const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim())
const TRADE_DIRECTION_TAB_CLASS = 'relative -mb-px inline-flex h-9 items-center justify-center border-b-2 px-3 font-medium uppercase transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:border-transparent disabled:text-[#b8aa99]'
const TRADE_DIRECTION_TAB_LABEL_CLASS = 'text-[11px] tracking-[0.12em]'
const APPROVE_TX_GAS_LIMIT = BigInt(90_000)
const TRADE_TX_GAS_LIMIT = BigInt(500_000)
const ALLOWANCE_POLL_ATTEMPTS = 12
const ALLOWANCE_POLL_DELAY_MS = 1500

function useOptionalPrivyTrading(): {
  wallets: ConnectedWallet[]
  walletsReady: boolean
  sendTransaction: ReturnType<typeof useSendTransaction>['sendTransaction']
} {
  if (!PRIVY_ENABLED) {
    return {
      wallets: [],
      walletsReady: true,
      sendTransaction: async () => {
        throw new Error('Privy is not configured for this environment')
      },
    }
  }

  const { wallets, ready } = useWallets()
  const { sendTransaction } = useSendTransaction()

  return {
    wallets,
    walletsReady: ready,
    sendTransaction,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTokenAllowance(readAllowance: () => Promise<bigint>, amountAtomic: bigint): Promise<boolean> {
  for (let attempt = 0; attempt < ALLOWANCE_POLL_ATTEMPTS; attempt += 1) {
    try {
      const allowance = await readAllowance()
      if (allowance >= amountAtomic) return true
    } catch {
      // RPC reads can lag briefly right after the approval receipt lands.
    }

    await sleep(ALLOWANCE_POLL_DELAY_MS)
  }

  return false
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function formatCents(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}¢`
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, value))
}

function formatCompactUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$0'
  const abs = Math.abs(value)
  if (abs >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  }

  return formatUsd(value)
}

function formatShares(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function formatTradeAmountInput(value: number): string {
  const rounded = Math.round(Math.max(0, value) * 1_000_000) / 1_000_000
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function stepTradeAmountInput(currentValue: string, delta: number, maxValue: number): string {
  const current = Number.parseFloat(currentValue)
  const base = Number.isFinite(current) ? current : 0
  const next = Math.max(0, base + delta)
  const bounded = Number.isFinite(maxValue) && maxValue > 0
    ? Math.min(next, maxValue)
    : next
  return formatTradeAmountInput(bounded)
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  })
}

function formatEthBalance(value: string | null | undefined): string {
  if (!value) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value
  return `${numeric.toFixed(5)} ETH`
}

function txUrl(hash: string): string {
  return `${BASESCAN_TX_BASE_URL}/${hash}`
}

function getTradeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const normalizedMessage = message.toLowerCase()
  if (normalizedMessage.includes('gas sponsorship') && normalizedMessage.includes('not enabled')) {
    return 'Privy gas sponsorship is not enabled for Base Sepolia yet. Enable Wallet Infrastructure -> Gas sponsorship in the Privy Dashboard, then try the trade again.'
  }
  if (normalizedMessage.includes('allowance_exceeded')) {
    return 'Your approval is still syncing on Base Sepolia. Wait a few seconds, then try the trade again.'
  }
  if (normalizedMessage.includes('replacement transaction underpriced')) {
    return 'Your wallet already has a pending Base Sepolia transaction. Wait for it to finish, then try again.'
  }

  return error instanceof Error ? error.message : 'Failed to send the trade transaction'
}

function tickerQuoteUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.toLowerCase() : null
}

function truncateMiddle(value: string | null | undefined, start = 8, end = 6): string {
  if (!value) return '—'
  if (value.length <= start + end + 1) return value
  return `${value.slice(0, start)}…${value.slice(-end)}`
}

function statusLabel(detail: Season4MarketDetail): string {
  if (detail.market.status === 'resolved' && detail.market.resolvedOutcome) {
    return `Resolved ${detail.market.resolvedOutcome}`
  }

  if (detail.market.status === 'closed') return 'Closed'
  if (detail.market.status === 'deployed') return 'Live'
  return detail.market.status
}

function isTradingClosed(detail: Season4MarketDetail): boolean {
  return detail.market.status === 'closed' || detail.market.status === 'resolved'
}

function getInitialPositionSortDirection(key: PositionSortKey): PositionSortDirection {
  if (key === 'model' || key === 'view') return 'asc'
  return 'desc'
}

function GradientCard({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
}) {
  return (
    <div className={cn('rounded-none', className)}>
      <div
        className={cn('rounded-none border border-transparent px-4 py-4 sm:px-5 sm:py-5', innerClassName)}
        style={DETAILS_CARD_BORDER_STYLE}
      >
        {children}
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  subvalue = null,
  valueClassName,
  className,
}: {
  label: ReactNode
  value: ReactNode
  subvalue?: ReactNode
  valueClassName?: string
  className?: string
}) {
  return (
    <GradientCard className={className} innerClassName="h-full min-h-[5.5rem] flex flex-col justify-between px-4 py-3 sm:px-5 sm:py-3.5">
      <div className={DETAILS_TOP_LABEL_CLASS}>{label}</div>
      <div className="mt-3 space-y-1.5">
        <div className={cn(DETAILS_TOP_VALUE_CLASS, valueClassName)}>{value}</div>
        {subvalue ? <div className={DASHBOARD_META_TEXT_CLASS}>{subvalue}</div> : null}
      </div>
    </GradientCard>
  )
}

function TradeBadge({ trade }: { trade: Season4TradeRow }) {
  const outcomeLabel = trade.isYes ? 'YES' : 'NO'
  const toneClass = trade.isYes ? APPROVE_TEXT_CLASS : REJECT_TEXT_CLASS

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5 font-medium text-[#6d645a]">
      <span className={cn('text-[12px] leading-none', trade.isBuy ? APPROVE_TEXT_CLASS : REJECT_TEXT_CLASS)} aria-hidden="true">
        {trade.isBuy ? '↗' : '↘'}
      </span>
      <span className="capitalize">{trade.isBuy ? 'buy' : 'sell'}</span>
      <span className={toneClass}>{outcomeLabel}</span>
    </span>
  )
}

function TradesFeed({
  trades,
  showHeader = true,
}: {
  trades: Season4TradeRow[]
  showHeader?: boolean
}) {
  return (
    <section className="space-y-4 px-1">
      {showHeader ? (
        <div className="flex items-center gap-3">
          <div className={DASHBOARD_SECTION_LABEL_CLASS}>Trades</div>
          <HeaderDots />
        </div>
      ) : null}

      {trades.length === 0 ? (
        <GradientCard>
          <p className={DETAILS_BODY_TEXT_CLASS}>No onchain trades have been mirrored into the index yet.</p>
        </GradientCard>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => (
            <GradientCard key={trade.txHash} innerClassName="p-3 sm:p-3.5">
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex flex-1 items-center gap-2">
                    <div className="min-w-0 flex items-baseline gap-3 sm:gap-4">
                      <div className="min-w-0 truncate text-[13px] leading-tight font-medium text-[#2f2a24]" title={trade.traderLabel}>
                        {trade.traderLabel}
                      </div>
                      <div className={DASHBOARD_META_TEXT_CLASS}>
                        <TradeBadge trade={trade} />
                      </div>
                    </div>
                  </div>
                  <div className={cn('shrink-0 text-right tabular-nums', DASHBOARD_META_TEXT_CLASS)}>
                    <LocalDateTime value={trade.createdAt} emptyLabel="Unknown time" />
                  </div>
                </div>

                <dl className={cn('mt-1.5 grid grid-cols-1 gap-y-1.5', DASHBOARD_META_TEXT_CLASS)}>
                  <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <dt className={cn('shrink-0', DETAILS_TOP_LABEL_CLASS)}>Size:</dt>
                    <dd className="shrink-0 break-words tabular-nums text-[#6d645a]">{formatUsd(trade.collateralAmountDisplay)}</dd>
                    <dt className={cn('ml-2 shrink-0', DETAILS_TOP_LABEL_CLASS)}>Shares:</dt>
                    <dd className="shrink-0 break-words tabular-nums text-[#6d645a]">{formatShares(trade.shareDeltaDisplay)}</dd>
                    <dt className={cn('ml-2 shrink-0', DETAILS_TOP_LABEL_CLASS)}>YES:</dt>
                    <dd className="min-w-0 flex-1 break-words font-medium tabular-nums text-[#6d645a]">{formatPercent(trade.priceYes)}</dd>
                  </div>
                </dl>

                <div className="mt-2">
                  <div className={cn('mb-0.5', DETAILS_TOP_LABEL_CLASS)}>Transaction</div>
                  <a
                    href={txUrl(trade.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(DETAILS_BODY_TEXT_CLASS, 'break-all text-[#3f392f] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]')}
                  >
                    {trade.txHash}
                  </a>
                </div>
              </div>
            </GradientCard>
          ))}
        </div>
      )}
    </section>
  )
}

function WalletTab({
  detail,
  safeCallbackUrl,
  showHeader = true,
}: {
  detail: Season4MarketDetail
  safeCallbackUrl: string
  showHeader?: boolean
}) {
  const viewer = detail.viewer

  return (
    <div className="space-y-4 px-1">
      {showHeader ? (
        <div className="flex items-center gap-3">
          <div className={DASHBOARD_SECTION_LABEL_CLASS}>Wallet</div>
          <HeaderDots />
        </div>
      ) : null}

      {viewer ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Cash" value={formatUsd(viewer.collateralBalanceDisplay)} />
            <MetricCard label="Gas Balance" value={formatEthBalance(viewer.gasBalanceEth)} />
            <MetricCard label="YES Shares" value={formatShares(viewer.yesShares)} valueClassName={APPROVE_TEXT_CLASS} />
            <MetricCard label="NO Shares" value={formatShares(viewer.noShares)} valueClassName={REJECT_TEXT_CLASS} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              label="Address"
              value={truncateMiddle(viewer.walletAddress, 10, 8)}
              subvalue={viewer.walletAddress ? <span className="break-all">{viewer.walletAddress}</span> : 'No wallet linked'}
              className="sm:col-span-2"
            />
            <MetricCard label="Provisioning" value={viewer.walletProvisioningStatus} />
            <MetricCard
              label="Funding"
              value="Manage on profile"
              subvalue={(
                <Link
                  href="/profile"
                  className="underline decoration-dotted decoration-[#ddd2c5] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                >
                  Open profile
                </Link>
              )}
            />
          </div>

        </>
      ) : (
        <GradientCard>
          <p className={DETAILS_BODY_TEXT_CLASS}>
            Sign in to see your season 4 wallet, funding status, and mirrored YES/NO balances on this page.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/login?callbackUrl=${safeCallbackUrl}`}
              className="inline-flex h-10 items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
            >
              Sign in
            </Link>
            <Link
              href={`/signup?callbackUrl=${safeCallbackUrl}`}
              className="inline-flex h-10 items-center justify-center rounded-sm border border-[#d9ccbc] bg-white px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
            >
              Create account
            </Link>
          </div>
        </GradientCard>
      )}
    </div>
  )
}

function TradeSidebar({
  className,
  detail,
  marketQuestion,
  sessionStatus,
  safeCallbackUrl,
  direction,
  outcome,
  amount,
  busyAction,
  notice,
  error,
  showHeader = true,
  onDirectionChange,
  onOutcomeChange,
  onAmountChange,
  onTrade,
  onWalletProvisioned,
}: {
  className?: string
  detail: Season4MarketDetail
  marketQuestion: string
  sessionStatus: 'authenticated' | 'unauthenticated' | 'loading'
  safeCallbackUrl: string
  direction: TradeDirection
  outcome: TradeOutcome
  amount: string
  busyAction: 'trade' | null
  notice: string | null
  error: string | null
  showHeader?: boolean
  onDirectionChange: (value: TradeDirection) => void
  onOutcomeChange: (value: TradeOutcome) => void
  onAmountChange: (value: string) => void
  onTrade: () => void
  onWalletProvisioned: () => Promise<void>
}) {
  const currentPriceYes = typeof detail.market.priceYes === 'number' ? detail.market.priceYes : 0.5
  const currentPriceNo = typeof detail.market.priceNo === 'number' ? detail.market.priceNo : 1 - currentPriceYes
  const isResolved = detail.market.status === 'resolved'
  const tradingClosed = isTradingClosed(detail)
  const viewer = detail.viewer
  const hasWallet = Boolean(viewer?.walletAddress)
  const canClaimFromFaucet = Boolean(viewer?.canClaimFromFaucet)
  const collateralBalance = Math.max(0, viewer?.collateralBalanceDisplay ?? 0)
  const availableShares = outcome === 'yes'
    ? Math.max(0, viewer?.yesShares ?? 0)
    : Math.max(0, viewer?.noShares ?? 0)
  const maxTradeAmount = direction === 'buy' ? collateralBalance : availableShares
  const parsedAmount = Number.parseFloat(amount)
  const amountAriaValue = Number.isFinite(parsedAmount) ? Math.max(0, parsedAmount) : undefined
  const needsFunding = collateralBalance <= 0.0001
  const tradeBlocked = busyAction !== null || (direction === 'buy' ? needsFunding : availableShares <= 0.0001)
  const handleAmountKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return

    event.preventDefault()
    const step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
    const delta = event.key === 'ArrowUp' ? step : -step
    onAmountChange(stepTradeAmountInput(amount, delta, maxTradeAmount))
  }

  return (
    <section className={cn('space-y-3', className)}>
      {showHeader ? (
        <div className="px-1">
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>{isResolved ? 'Resolution' : 'Trade'}</div>
            <HeaderDots />
          </div>
        </div>
      ) : null}

      <GradientCard>
        <div className="-mx-4 -mt-4 mb-4 border-b border-[#e8ddd0] bg-[#f8f3ec]/45 px-4 sm:-mx-5 sm:px-5">
          {tradingClosed ? (
            <div className="flex items-center justify-between gap-3 py-[9px]">
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8a8075]">
                {statusLabel(detail)}
              </span>
              {detail.market.resolvedOutcome ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em]',
                    detail.market.resolvedOutcome === 'YES'
                      ? 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b40]'
                      : 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#9b3028]',
                  )}
                >
                  {detail.market.resolvedOutcome}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="py-3">
              <p className="text-[0.92rem] font-normal leading-[1.45] text-[#4f4942]">{marketQuestion}</p>
              <div className="mt-3 grid grid-cols-2 border-b border-[#e7ddd0]">
                <button
                  type="button"
                  disabled={sessionStatus !== 'authenticated' || !hasWallet}
                  onClick={() => onDirectionChange('buy')}
                  className={cn(
                    TRADE_DIRECTION_TAB_CLASS,
                    direction === 'buy'
                      ? sessionStatus === 'authenticated' && hasWallet
                        ? 'border-[#5DBB63] text-[#2f7b40]'
                        : 'border-[#d6c8b7] text-[#b8aa99]'
                      : sessionStatus === 'authenticated' && hasWallet
                        ? 'border-transparent text-[#9d9184] hover:border-[#5DBB63]/55 hover:text-[#45934a]'
                        : 'text-[#b8aa99]',
                  )}
                >
                  <span className={TRADE_DIRECTION_TAB_LABEL_CLASS}>Buy</span>
                </button>
                <button
                  type="button"
                  disabled={sessionStatus !== 'authenticated' || !hasWallet}
                  onClick={() => onDirectionChange('sell')}
                  className={cn(
                    TRADE_DIRECTION_TAB_CLASS,
                    direction === 'sell'
                      ? sessionStatus === 'authenticated' && hasWallet
                        ? 'border-[#EF6F67] text-[#c43a2b]'
                        : 'border-[#d6c8b7] text-[#b8aa99]'
                      : sessionStatus === 'authenticated' && hasWallet
                        ? 'border-transparent text-[#9d9184] hover:border-[#EF6F67]/55 hover:text-[#c86a63]'
                        : 'text-[#b8aa99]',
                  )}
                >
                  <span className={TRADE_DIRECTION_TAB_LABEL_CLASS}>Sell</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {tradingClosed ? (
          <p className="mb-3 text-[0.86rem] leading-[1.45] text-[#675d52] sm:text-[0.9rem]">{marketQuestion}</p>
        ) : null}

        {isResolved ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div
                className={cn(
                  'rounded-sm border px-3 py-3 text-center text-base font-medium',
                  detail.market.resolvedOutcome === 'YES'
                    ? 'border-[#5DBB63] bg-[#5DBB63]/15 text-[#2f7b40]'
                    : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075]',
                )}
              >
                Yes {detail.market.resolvedOutcome === 'YES' ? '100¢' : '0¢'}
              </div>
              <div
                className={cn(
                  'rounded-sm border px-3 py-3 text-center text-base font-medium',
                  detail.market.resolvedOutcome === 'NO'
                    ? 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                    : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075]',
                )}
              >
                No {detail.market.resolvedOutcome === 'NO' ? '100¢' : '0¢'}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2.5">
                <div className={DETAILS_TOP_LABEL_CLASS}>Chain</div>
                <div className="mt-1 text-sm font-medium text-[#3b342c]">{detail.chain.chainName}</div>
              </div>
              <div className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2.5">
                <div className={DETAILS_TOP_LABEL_CLASS}>Close Time</div>
                <LocalDateTime value={detail.market.closeTime} className="mt-1 block text-sm font-medium text-[#3b342c]" />
              </div>
            </div>
          </>
        ) : sessionStatus !== 'authenticated' ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled
                className={cn(
                  'rounded-sm border px-3 py-3 text-center text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-65',
                  outcome === 'yes'
                    ? direction === 'buy'
                      ? 'border-[#5DBB63] bg-[#5DBB63]/15 text-[#2f7b40]'
                      : 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                    : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075]',
                )}
              >
                Yes {formatCents(currentPriceYes)}
              </button>
              <button
                type="button"
                disabled
                className={cn(
                  'rounded-sm border px-3 py-3 text-center text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-65',
                  outcome === 'no'
                    ? 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                    : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075]',
                )}
              >
                No {formatCents(currentPriceNo)}
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">
                  Amount (USD)
                </span>
                <input
                  value="1"
                  readOnly
                  inputMode="decimal"
                  disabled
                  className="h-10 w-full rounded-sm border border-[#e4dbd0] bg-[#f4eee6] px-3 text-sm text-[#b5aa9e] placeholder:text-[#cfc4b7] outline-none disabled:cursor-not-allowed"
                  placeholder="1"
                />
              </label>

              <div className="inline-flex items-center rounded-full border border-[#d9cdbf] bg-[#f8f3ec] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#8a8075]">
                Paper Trading
              </div>

              <Link
                href={`/signup?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`}
                className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
              >
                Create account to trade
              </Link>
            </div>
          </>
        ) : !hasWallet ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-[#6f665b]">
              Your season 4 account is ready, but the embedded wallet is not linked yet. Create it here, then finish funding from your profile and come back to trade.
            </p>
            <div className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2.5">
              <div className={DETAILS_TOP_LABEL_CLASS}>Wallet Status</div>
              <div className="mt-1 text-sm font-medium text-[#3b342c]">{viewer?.walletProvisioningStatus ?? 'not_started'}</div>
            </div>
            <Season4WalletProvisionButton
              label="Create embedded wallet"
              busyLabel="Creating wallet…"
              onProvisioned={onWalletProvisioned}
              className="inline-flex h-10 items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onOutcomeChange('yes')}
                className={cn(
                  'rounded-sm border px-3 py-3 text-center text-base font-medium transition-colors',
                  outcome === 'yes'
                    ? direction === 'buy'
                      ? 'border-[#5DBB63] bg-[#5DBB63]/15 text-[#2f7b40]'
                      : 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                    : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075] hover:bg-[#f3ebe0]',
                )}
              >
                Yes {formatCents(currentPriceYes)}
              </button>
              <button
                type="button"
                onClick={() => onOutcomeChange('no')}
                className={cn(
                  'rounded-sm border px-3 py-3 text-center text-base font-medium transition-colors',
                  outcome === 'no'
                    ? 'border-[#EF6F67] bg-[#EF6F67]/15 text-[#9b3028]'
                    : 'border-[#e8ddd0] bg-[#f7f2eb] text-[#8a8075] hover:bg-[#f3ebe0]',
                )}
              >
                No {formatCents(currentPriceNo)}
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-[#8a8075]">
                  {direction === 'buy' ? 'Amount (Testnet USDC)' : 'Shares to sell'}
                </span>
                <input
                  value={amount}
                  onChange={(event) => onAmountChange(event.target.value)}
                  onKeyDown={handleAmountKeyDown}
                  inputMode="decimal"
                  role="spinbutton"
                  aria-label={direction === 'buy' ? 'Amount in testnet USDC' : 'Shares to sell'}
                  aria-valuemin={0}
                  aria-valuemax={maxTradeAmount > 0 ? maxTradeAmount : undefined}
                  aria-valuenow={amountAriaValue}
                  autoComplete="off"
                  className="h-10 w-full rounded-sm border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891]"
                  placeholder="10"
                />
              </label>

              <button
                type="button"
                onClick={onTrade}
                disabled={tradeBlocked}
                className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-[#d9ccbc] bg-[#f7f2eb] px-4 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0] disabled:cursor-not-allowed disabled:border-[#e4dbd0] disabled:bg-[#f4eee6] disabled:text-[#b5aa9e]"
              >
                {busyAction === 'trade'
                  ? 'Sending onchain trade…'
                  : `${direction === 'buy' ? 'Buy' : 'Sell'} ${outcome.toUpperCase()}`}
              </button>
            </div>

            {needsFunding || canClaimFromFaucet ? (
              <div className="mt-3 px-1">
                <p className={cn('text-xs leading-relaxed', needsFunding ? 'text-[#EF6F67]' : 'text-[#7a7065]')}>
                  {needsFunding ? (
                    <>
                      Add money to your wallet using the faucet in{' '}
                      <Link
                        href="/profile"
                        className="underline decoration-dotted decoration-[#EF6F67] underline-offset-4 transition-colors hover:text-[#d85d55] hover:decoration-[#d85d55]"
                      >
                        Account
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      Need more buying power? Use the faucet in{' '}
                      <Link
                        href="/profile"
                        className="underline decoration-dotted decoration-[#d7cab8] underline-offset-4 transition-colors hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                      >
                        Account
                      </Link>
                      .
                    </>
                  )}
                </p>
              </div>
            ) : null}
          </>
        )}

        {notice ? (
          <p className="mt-3 rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 px-3 py-2 text-sm text-[#2f7b40]">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">
            {error}
          </p>
        ) : null}

      </GradientCard>

      {!isResolved && sessionStatus === 'authenticated' && hasWallet ? (
        <div className="px-1">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span className={DETAILS_TOP_LABEL_CLASS}>YES Shares</span>
              <span className="text-sm font-medium tabular-nums text-[#6f665b]">{formatShares(viewer?.yesShares)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={DETAILS_TOP_LABEL_CLASS}>NO Shares</span>
              <span className="text-sm font-medium tabular-nums text-[#6f665b]">{formatShares(viewer?.noShares)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function DetailFallback({
  detail,
  showHeader = true,
}: {
  detail: Season4MarketDetail
  showHeader?: boolean
}) {
  const trial = detail.trial

  return (
    <div className="space-y-6 px-1">
      <section className="space-y-4">
        {showHeader ? (
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>Details</div>
            <HeaderDots />
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Primary Completion" value={formatShortDate(trial?.estPrimaryCompletionDate ?? null)} />
          <MetricCard label="Study Completion" value={formatShortDate(trial?.estStudyCompletionDate ?? null)} />
          <MetricCard
            label="Sponsor"
            value={trial?.sponsorName ?? '—'}
            subvalue={trial?.sponsorTicker ? (
              <a
                href={tickerQuoteUrl(trial.sponsorTicker)}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted decoration-[#ddd2c5] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
              >
                ${trial.sponsorTicker}
              </a>
            ) : null}
          />
          <MetricCard
            label="Type"
            value={trial?.exactPhase ? (
              <Link
                href={`/glossary#term-${glossaryLookupAnchor(trial.exactPhase)}`}
                className="underline decoration-dotted decoration-[#ddd2c5] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
              >
                {trial.exactPhase}
              </Link>
            ) : '—'}
          />
          <MetricCard label="Trial Status" value={trial?.currentStatus ?? '—'} />
          <MetricCard
            label="Trial Size"
            value={typeof trial?.estEnrollment === 'number' ? trial.estEnrollment.toLocaleString('en-US') : 'Unavailable'}
          />
          <MetricCard label="Volume" value={formatCompactUsd(detail.market.totalVolumeDisplay)} />
          <MetricCard
            label="NCT"
            value={trial?.nctNumber ? (
              <a
                href={`https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctNumber)}`}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted decoration-[#ddd2c5] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
              >
                {trial.nctNumber}
              </a>
            ) : '—'}
            className="sm:col-span-2 xl:col-span-1"
          />
        </div>

        {trial ? (
          <GradientCard>
            <div className={DETAILS_TOP_LABEL_CLASS}>Trial Description</div>
            <p className={cn('mt-3', DETAILS_BODY_TEXT_CLASS)}>
              {trial.briefSummary}
            </p>
          </GradientCard>
        ) : (
          <GradientCard>
            <div className={DETAILS_TOP_LABEL_CLASS}>Market Status</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Status" value={statusLabel(detail)} />
              <MetricCard label="Chain" value={detail.chain.chainName} />
              <MetricCard label="Market ID" value={detail.market.onchainMarketId ?? '—'} />
              <MetricCard label="Close Time" value={<LocalDateTime value={detail.market.closeTime} />} />
            </div>
          </GradientCard>
        )}
      </section>

      {detail.market.resolvedOutcome ? (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>Oracle</div>
            <HeaderDots />
          </div>

          <GradientCard>
            <div className={DETAILS_TOP_LABEL_CLASS}>Resolved Outcome</div>
            <p className={cn('mt-3', DETAILS_BODY_TEXT_CLASS)}>
              This market has resolved {detail.market.resolvedOutcome}. Open the Oracle tab for the full resolution workflow and evidence trail.
            </p>
          </GradientCard>
        </section>
      ) : null}
    </div>
  )
}

export function Season4MarketPage({
  initialDetail,
  initialSelectedMarket,
  activeTab,
  oracleTabData,
}: {
  initialDetail: Season4MarketDetail
  initialSelectedMarket: OpenMarketRow
  activeTab: Season4TrialTab
  oracleTabData: TrialOracleTabData | null
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session, status: sessionStatus, fetchWithAuth } = useAuth()
  const { wallets, walletsReady, sendTransaction } = useOptionalPrivyTrading()

  const [detail, setDetail] = useState(initialDetail)
  const [direction, setDirection] = useState<TradeDirection>('buy')
  const [outcome, setOutcome] = useState<TradeOutcome>('yes')
  const [amount, setAmount] = useState('10')
  const [busyAction, setBusyAction] = useState<'trade' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [positionSort, setPositionSort] = useState<PositionSortState | null>(null)

  const safeCallbackUrl = encodeURIComponent(pathname || `/trials/${detail.market.marketSlug}`)
  const activeWallet = useMemo(() => {
    const preferredAddress = normalizeAddress(detail.viewer?.walletAddress ?? session?.user.embeddedWalletAddress ?? null)
    return wallets.find((wallet) => normalizeAddress(wallet.address) === preferredAddress) ?? wallets[0] ?? null
  }, [detail.viewer?.walletAddress, session?.user.embeddedWalletAddress, wallets])

  const refreshDetail = useEffectEvent(async (): Promise<Season4MarketDetail | null> => {
    try {
      const response = await fetchWithAuth(`/api/season4/markets/${encodeURIComponent(detail.market.marketSlug)}`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        return null
      }

      const payload = await response.json() as Season4MarketDetail
      setDetail(payload)
      dispatchAccountBalanceUpdated()
      return payload
    } catch {
      return null
    }
  })

  const attachApprovalTxToTrade = useEffectEvent(async (tradeTxHash: string, approvalTxHash: string): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetchWithAuth('/api/season4/trades/metadata', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tradeTxHash,
            approvalTxHash,
          }),
        })
        if (response.ok) {
          const payload = await response.json().catch(() => null) as { linked?: boolean } | null
          if (payload?.linked) return
        }
      } catch {
        // This only enriches the activity table; the trade itself already landed.
      }
      await sleep(1000)
    }
  })

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return
    void refreshDetail()
  }, [refreshDetail, sessionStatus])

  const pollForTradeIndex = async (txHash: string) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(1750)
      const next = await refreshDetail()
      if (next?.recentTrades.some((trade) => trade.txHash.toLowerCase() === txHash.toLowerCase())) {
        return true
      }
    }

    return false
  }

  const handleTrade = async () => {
    if (!detail.market.onchainMarketId) {
      setError('This market is not deployed onchain yet')
      return
    }
    if (isTradingClosed(detail)) {
      setError('This market is no longer open for trading')
      return
    }
    if (sessionStatus !== 'authenticated') {
      setError('Please sign in first')
      return
    }
    if (!detail.viewer?.walletAddress) {
      setError('This account does not have a season 4 wallet linked yet')
      return
    }
    if (!activeWallet || !walletsReady) {
      setError('Your embedded wallet is still loading. Please wait a moment and try again.')
      return
    }
    if (!detail.chain.managerAddress || !detail.chain.collateralTokenAddress) {
      setError('Season 4 onchain contracts are not configured')
      return
    }

    const numericAmount = Number.parseFloat(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid trade amount')
      return
    }

    if (direction === 'buy') {
      const availableCollateral = Math.max(0, detail.viewer.collateralBalanceDisplay)
      if (availableCollateral <= 0.0001) {
        setError('Your balance is $0. Open your profile to claim the faucet or add funds before buying.')
        return
      }
      if (numericAmount > availableCollateral) {
        setError(`You only have ${formatUsd(availableCollateral)} available. Open your profile to fund your wallet before buying more.`)
        return
      }
    }

    if (direction === 'sell') {
      const availableShares = outcome === 'yes' ? detail.viewer.yesShares : detail.viewer.noShares
      if (numericAmount > availableShares) {
        setError(`You only have ${availableShares.toFixed(2)} ${outcome.toUpperCase()} shares available`)
        return
      }
    }

    setBusyAction('trade')
    setError(null)
    setNotice(null)

    try {
      await activeWallet.switchChain(detail.chain.chainId)

      const marketId = BigInt(detail.market.onchainMarketId)
      const amountAtomic = parseUnits(amount, 6)
      const walletAddress = detail.viewer.walletAddress as Address
      const managerAddress = detail.chain.managerAddress as Address
      const collateralAddress = detail.chain.collateralTokenAddress as Address
      let approvalTxHash: string | null = null
      const sponsoredTransactionOptions = {
        address: walletAddress,
        sponsor: true,
      } as const
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      })
      const readAllowance = async (): Promise<bigint> => {
        const allowance = await publicClient.readContract({
          address: collateralAddress,
          abi: MOCK_USDC_ABI,
          functionName: 'allowance',
          args: [walletAddress, managerAddress],
        })
        return allowance as bigint
      }

      if (direction === 'buy') {
        let needsApproval = true
        try {
          const allowance = await readAllowance()
          needsApproval = allowance < amountAtomic
        } catch {
          needsApproval = true
        }

        if (needsApproval) {
          const approveData = encodeFunctionData({
            abi: MOCK_USDC_ABI,
            functionName: 'approve',
            args: [managerAddress, maxUint256],
          })

          setNotice('Approval submitted. Waiting for Base Sepolia confirmation...')
          const approveResult = await sendTransaction({
            from: walletAddress,
            to: collateralAddress,
            data: approveData,
            chainId: detail.chain.chainId,
            gasLimit: APPROVE_TX_GAS_LIMIT,
          }, sponsoredTransactionOptions)
          approvalTxHash = approveResult.hash
          await publicClient.waitForTransactionReceipt({ hash: approveResult.hash as `0x${string}` })
        }

        setNotice(needsApproval
          ? 'Approval confirmed. Waiting for Base Sepolia to sync allowance...'
          : 'Checking your Base Sepolia allowance before sending the trade...'
        )
        const allowanceReady = await waitForTokenAllowance(readAllowance, amountAtomic)
        if (!allowanceReady) {
          throw new Error('Your approval was confirmed, but Base Sepolia has not reflected it yet. Wait a few seconds, then try again.')
        }
      }

      const functionName = direction === 'buy'
        ? (outcome === 'yes' ? 'buyYes' : 'buyNo')
        : (outcome === 'yes' ? 'sellYes' : 'sellNo')
      const tradeData = encodeFunctionData({
        abi: PREDICTION_MARKET_MANAGER_ABI,
        functionName,
        args: [marketId, amountAtomic, BigInt(0)],
      })

      const tradeResult = await sendTransaction({
        from: walletAddress,
        to: managerAddress,
        data: tradeData,
        chainId: detail.chain.chainId,
        gasLimit: TRADE_TX_GAS_LIMIT,
      }, sponsoredTransactionOptions)

      startTransition(() => {
        dispatchAccountBalanceUpdated()
      })

      setNotice(direction === 'buy'
        ? 'Trade submitted. Waiting for Base Sepolia confirmation...'
        : 'Sell submitted. Waiting for Base Sepolia confirmation...')

      await publicClient.waitForTransactionReceipt({ hash: tradeResult.hash as `0x${string}` })

      setNotice(direction === 'buy'
        ? 'Trade confirmed. Waiting for the indexer to mirror your new position...'
        : 'Sell confirmed. Waiting for the mirrored balances to refresh...')

      const indexed = await pollForTradeIndex(tradeResult.hash)
      if (approvalTxHash) {
        await attachApprovalTxToTrade(tradeResult.hash, approvalTxHash)
      }
      if (indexed) {
        setNotice(direction === 'buy' ? 'Buy completed onchain.' : 'Sell completed onchain.')
      } else {
        setNotice('Transaction submitted onchain. The UI may need one more refresh to show the new balances.')
      }
    } catch (tradeError) {
      setError(getTradeErrorMessage(tradeError))
    } finally {
      setBusyAction(null)
    }
  }

  const currentPriceYes = useMemo(() => {
    if (detail.market.resolvedOutcome === 'YES') return 1
    if (detail.market.resolvedOutcome === 'NO') return 0
    return detail.market.priceYes ?? initialSelectedMarket.priceYes ?? 0.5
  }, [detail.market.priceYes, detail.market.resolvedOutcome, initialSelectedMarket.priceYes])

  const isResolvedMarket = detail.market.resolvedOutcome != null
    || detail.trial?.questionOutcome === 'YES'
    || detail.trial?.questionOutcome === 'NO'
  const liveQuestionPrompt = detail.trial?.questionPrompt
    ? detail.trial.questionPrompt
    : initialSelectedMarket.event?.questionPrompt

  const selectedMarket = useMemo(() => {
    return {
      ...initialSelectedMarket,
      status: isResolvedMarket
        ? 'RESOLVED'
        : initialSelectedMarket.status,
      priceYes: currentPriceYes,
      priceNo: Math.max(0, 1 - currentPriceYes),
      openedAt: detail.market.openedAt ?? initialSelectedMarket.openedAt,
      event: initialSelectedMarket.event
        ? {
            ...initialSelectedMarket.event,
            outcome: detail.trial?.questionOutcome ?? initialSelectedMarket.event.outcome,
            questionPrompt: liveQuestionPrompt,
          }
        : initialSelectedMarket.event,
      priceHistory: detail.priceHistory.length > 0 ? detail.priceHistory : initialSelectedMarket.priceHistory,
    } satisfies OpenMarketRow
  }, [
    currentPriceYes,
    detail.market.openedAt,
    detail.priceHistory,
    detail.trial?.questionOutcome,
    initialSelectedMarket,
    isResolvedMarket,
    liveQuestionPrompt,
  ])

  const applicationTypeMeta = selectedMarket.event?.applicationType
    ? abbreviateType(selectedMarket.event.applicationType)
    : null
  const primaryTicker = selectedMarket.event?.symbols?.split(',')[0]?.trim() || detail.trial?.sponsorTicker || ''
  const questionText = getMarketQuestion(selectedMarket)
  const chartHistory = detail.priceHistory.length
    ? detail.priceHistory
    : selectedMarket.priceHistory.length
      ? selectedMarket.priceHistory
      : (detail.market.openedAt ? [{ snapshotDate: detail.market.openedAt, priceYes: currentPriceYes }] : [])
  const chartCurrentPrice = currentPriceYes
  const chartOpeningPrice = selectedMarket.openingProbability ?? chartHistory[0]?.priceYes ?? null
  const chartOpenedAt = detail.market.openedAt ?? selectedMarket.openedAt ?? null

  const positionRows = useMemo(() => {
    return selectedMarket.modelStates.map((state, index) => {
      const model = getSeason4ModelInfo(state.modelId)
      const yesShares = Math.max(0, state.yesShares)
      const noShares = Math.max(0, state.noShares)
      const positionValueUsd = (yesShares * currentPriceYes) + (noShares * (1 - currentPriceYes))
      const pnlUsd = positionValueUsd - (state.costBasisUsd || 0)
      const derivedBinaryCall = yesShares > noShares
        ? 'yes'
        : noShares > yesShares
          ? 'no'
          : null
      const binaryCall = state.latestDecision?.forecast.binaryCall ?? derivedBinaryCall
      const viewDisplayLabel =
        binaryCall === 'yes'
          ? 'Yes'
          : binaryCall === 'no'
            ? 'No'
            : 'Pending'
      const viewTextClass =
        binaryCall === 'yes'
          ? APPROVE_TEXT_CLASS
          : binaryCall === 'no'
            ? REJECT_TEXT_CLASS
            : 'text-[#7c7267]'
      const viewSortRank =
        binaryCall === 'yes'
          ? 0
          : binaryCall === 'no'
            ? 1
            : 2

      return {
        index,
        fullName: model.fullName,
        modelId: state.modelId,
        displayLabel: getSeason4PositionModelLabel(state.modelId),
        compactLabel: model.provider === 'OpenAI' ? 'GPT' : model.name,
        yesShares,
        noShares,
        positionValueUsd,
        pnlUsd,
        viewDisplayLabel,
        viewTextClass,
        sortValues: {
          model: model.fullName.toLowerCase(),
          view: viewSortRank,
          yesShares,
          noShares,
          position: positionValueUsd,
          pnl: pnlUsd,
        } as Record<PositionSortKey, string | number>,
      }
    })
  }, [currentPriceYes, selectedMarket])

  const sortedPositionRows = useMemo(() => {
    if (positionSort == null) return positionRows

    return [...positionRows].sort((a, b) => {
      const aValue = a.sortValues[positionSort.key]
      const bValue = b.sortValues[positionSort.key]

      let cmp = 0
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        cmp = aValue - bValue
      } else {
        cmp = String(aValue).localeCompare(String(bValue))
      }

      if (cmp !== 0) {
        return positionSort.direction === 'asc' ? cmp : -cmp
      }

      const modelCmp = a.fullName.localeCompare(b.fullName)
      if (modelCmp !== 0) return modelCmp
      return a.index - b.index
    })
  }, [positionRows, positionSort])

  const visiblePositionRows: MarketPositionRow[] = useMemo(() => {
    return sortedPositionRows.map((row) => ({
      modelId: row.modelId,
      fullName: row.fullName,
      displayLabel: row.displayLabel,
      compactLabel: row.compactLabel,
      yesShares: row.yesShares,
      noShares: row.noShares,
      positionValueUsd: row.positionValueUsd,
      pnlUsd: row.pnlUsd,
      viewDisplayLabel: row.viewDisplayLabel,
      viewTextClass: row.viewTextClass,
    }))
  }, [sortedPositionRows])

  const decisionRows: MarketDashboardDecisionRow[] = useMemo(() => {
    return selectedMarket.modelStates.map((state) => {
      const model = getSeason4ModelInfo(state.modelId)
      const latestDecision = state.latestDecision
      const history = state.decisionHistory
      const binaryCall = latestDecision?.forecast.binaryCall ?? null
      const callToneClass =
        binaryCall === 'yes'
          ? APPROVE_TEXT_CLASS
          : binaryCall === 'no'
            ? REJECT_TEXT_CLASS
            : 'text-[#7c7267]'

      return {
        state,
        model,
        latestDecision,
        history,
        callLabel:
          binaryCall === 'yes'
            ? 'Yes'
            : binaryCall === 'no'
              ? 'No'
              : 'Pending',
        callToneClass,
      }
    })
  }, [selectedMarket])

  const visibleTabs = useMemo(() => {
    const tabs: Array<{
      id: Season4TrialTab
      label: string
      borderClass: string
      activeTextClass: string
      hoverClass: string
    }> = [
      {
        id: 'details',
        label: 'Details',
        borderClass: 'border-[#EF6F67]',
        activeTextClass: 'text-[#EF6F67]',
        hoverClass: 'hover:border-[#EF6F67]/55 hover:text-[#c86a63]',
      },
      {
        id: 'positions',
        label: 'Model Positions',
        borderClass: 'border-[#D39D2E]',
        activeTextClass: 'text-[#D39D2E]',
        hoverClass: 'hover:border-[#D39D2E]/55 hover:text-[#b8841f]',
      },
      {
        id: 'snapshots',
        label: 'Model Snapshots',
        borderClass: 'border-[#5DBB63]',
        activeTextClass: 'text-[#5DBB63]',
        hoverClass: 'hover:border-[#5DBB63]/55 hover:text-[#45934a]',
      },
      {
        id: 'oracles',
        label: 'Oracle',
        borderClass: 'border-[#5BA5ED]',
        activeTextClass: 'text-[#5BA5ED]',
        hoverClass: 'hover:border-[#5BA5ED]/55 hover:text-[#4a8cca]',
      },
    ]

    return tabs
  }, [])

  const resolvedActiveTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : resolveSeason4TrialTab('details')

  const buildTabHref = (tabId: Season4TrialTab, extraParams?: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('tab', tabId)

    if (tabId !== 'snapshots') {
      params.delete('model')
    }

    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
    }

    return `${pathname || `/trials/${encodeURIComponent(detail.market.marketSlug)}`}?${params.toString()}`
  }

  const tabContent = (() => {
    switch (resolvedActiveTab) {
      case 'positions':
        return (
          <MarketModelPositionsPanel
            className="px-1"
            marketId={selectedMarket.marketId}
            rows={visiblePositionRows}
            sortState={positionSort}
            onSort={(key) => {
              startTransition(() => {
                setPositionSort((current) => {
                  if (!current || current.key !== key) {
                    return { key, direction: getInitialPositionSortDirection(key) }
                  }
                  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                })
              })
            }}
            getModelHref={(modelId) => buildTabHref('snapshots', { model: modelId })}
            showHeader={false}
          />
        )
      case 'snapshots':
        return (
          <MarketDecisionSnapshotsPanel
            className="px-1"
            selectedMarketId={selectedMarket.marketId}
            decisionRows={decisionRows}
            showHeader={false}
          />
        )
      case 'oracles':
        if (!oracleTabData?.available) {
          return (
            <section className="space-y-4 px-1">
              <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
                {oracleTabData?.unavailableReason ?? 'Oracle data is unavailable for this trial right now.'}
              </div>
            </section>
          )
        }

        return (
          <div className="px-1">
            <TrialOracleRunsPanel
              selectedMarket={oracleTabData.selectedMarket ?? selectedMarket}
              allFindings={oracleTabData.allFindings}
              runHistory={oracleTabData.runHistory}
              historyEntries={oracleTabData.historyEntries}
              embedded
            />
          </div>
        )
      case 'trades':
        return <TradesFeed trades={detail.recentTrades} showHeader={false} />
      case 'wallet':
        return (
          <WalletTab
            detail={detail}
            safeCallbackUrl={safeCallbackUrl}
            showHeader={false}
          />
        )
      case 'details':
      default:
        return (
          <div className="space-y-6 px-1">
            <MarketDetailsPanel
              selectedMarket={selectedMarket}
              totalVolumeUsd={detail.market.totalVolumeDisplay}
              applicationTypeMeta={applicationTypeMeta}
              primaryTicker={primaryTicker}
              showHeader={false}
            />
            {isMarketClosedToTrading(selectedMarket) ? (
              <MarketResolutionPanel selectedMarket={selectedMarket} />
            ) : null}
          </div>
        )
    }
  })()

  const title = selectedMarket.event?.drugName || detail.trial?.shortTitle || detail.market.title

  return (
    <div className="space-y-5">
      <section className="space-y-4">
        <header className="px-1">
          <div>
            <h1 className="text-xl font-semibold leading-tight text-[#171717] sm:text-2xl">
              {title}
            </h1>
          </div>
        </header>

        <div>
          <div className="grid grid-cols-1 gap-4">
            <div className="min-w-0 px-1 lg:grid lg:grid-cols-[minmax(0,2.25fr)_minmax(18rem,0.85fr)] lg:items-start lg:gap-4">
              <div className="min-w-0 px-1">
                <div className="mb-4 flex items-center gap-3">
                  <div className={DASHBOARD_SECTION_LABEL_CLASS}>Market</div>
                  <HeaderDots />
                </div>

                <MarketDetailChart
                  history={chartHistory}
                  currentPrice={chartCurrentPrice}
                  openingPrice={chartOpeningPrice}
                  openedAt={chartOpenedAt}
                  className="rounded-none border-0 bg-transparent p-0"
                  showDateRangeFooter={false}
                />

              </div>

              <div className="mt-6 px-1 lg:mt-0 lg:sticky lg:top-20">
                <div className="mb-3 px-1">
                  <div className="flex items-center gap-3">
                    <div className={DASHBOARD_SECTION_LABEL_CLASS}>Trade</div>
                    <HeaderDots />
                  </div>
                </div>

                <TradeSidebar
                  detail={detail}
                  marketQuestion={questionText}
                  sessionStatus={sessionStatus}
                  safeCallbackUrl={safeCallbackUrl}
                  direction={direction}
                  outcome={outcome}
                  amount={amount}
                  busyAction={busyAction}
                  notice={notice}
                  error={error}
                  showHeader={false}
                  onDirectionChange={setDirection}
                  onOutcomeChange={setOutcome}
                  onAmountChange={setAmount}
                  onTrade={() => void handleTrade()}
                  onWalletProvisioned={async () => {
                    await refreshDetail()
                    setNotice('Wallet linked. Open your profile to fund it, then come back here to trade.')
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-10 space-y-6 px-1">
            <div className="mx-1 inline-flex w-fit flex-wrap items-end gap-5 self-start border-b border-[#e7ddd0]">
              {visibleTabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={buildTabHref(tab.id)}
                  scroll={false}
                  className={cn(
                    'relative -mb-px inline-flex items-center border-b-2 pb-3 font-medium uppercase transition-colors focus-visible:outline-none',
                    resolvedActiveTab === tab.id
                      ? cn(tab.borderClass, tab.activeTextClass)
                      : cn('border-transparent text-[#9d9184]', tab.hoverClass),
                  )}
                  aria-current={resolvedActiveTab === tab.id ? 'page' : undefined}
                >
                  <span className={cn('tracking-[0.1em]', resolvedActiveTab === tab.id ? 'text-[11px]' : 'text-[10px]')}>
                    {tab.label}
                  </span>
                </Link>
              ))}
            </div>

            {tabContent}
          </div>
        </div>
      </section>
    </div>
  )
}
