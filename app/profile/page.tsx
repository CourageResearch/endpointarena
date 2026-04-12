import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { ProfileHandleCard } from '@/components/ProfileHandleCard'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { LogoutButton } from '@/components/LogoutButton'
import { ProfileVerificationPanel } from '@/components/ProfileVerificationPanel'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { XInlineMark } from '@/components/XMark'
import { authOptions } from '@/lib/auth'
import { db, marketActions, marketActors, marketPositions, predictionMarkets, trialQuestions, users } from '@/lib/db'
import { DISPLAY_NAME_MAX_LENGTH, getGeneratedDisplayName, resolveDisplayName } from '@/lib/display-name'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import { ensureHumanTradingAccount, getCanonicalHumanStartingCash } from '@/lib/human-cash'
import { getXVerificationStatusForUser } from '@/lib/x-status'
import { filterSupportedTrialQuestions } from '@/lib/trial-questions'
import { userColumns } from '@/lib/users/query-shapes'
import { buildNoIndexMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Profile',
  description: 'Private Endpoint Arena profile and account data.',
  path: '/profile',
})

const PROFILE_TRADE_ACTIONS = ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO'] as const
type ProfileTradeAction = (typeof PROFILE_TRADE_ACTIONS)[number]

type ProfileHoldingRow = {
  marketId: string
  marketHref: string | null
  drugName: string
  companyName: string
  ticker: string
  yesShares: number
  noShares: number
  markValueUsd: number
  decisionDate: Date | null
}

type ProfileTradeRow = {
  id: string
  timestamp: Date
  marketId: string
  marketHref: string | null
  drugName: string
  companyName: string
  ticker: string
  action: ProfileTradeAction
  usdAmount: number
  shares: number
  priceAfter: number
  status: string
}

function formatShortDate(value: Date | null | undefined): string {
  if (!value) return '-'
  return value.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  })
}

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(safe)
}

function formatShares(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  return safe.toFixed(4).replace(/\.?0+$/, '') || '0'
}

function formatPricePercent(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  return `${(safe * 100).toFixed(1).replace(/\.0$/, '')}%`
}

function toTradeActionLabel(action: ProfileTradeAction): 'Buy Yes' | 'Buy No' | 'Sell Yes' | 'Sell No' {
  switch (action) {
    case 'BUY_YES':
      return 'Buy Yes'
    case 'BUY_NO':
      return 'Buy No'
    case 'SELL_YES':
      return 'Sell Yes'
    case 'SELL_NO':
      return 'Sell No'
  }
}

function toTicker(symbols: string | null | undefined): string {
  if (!symbols) return '-'
  const first = symbols.split(',')[0]?.trim()
  return first || '-'
}

async function getProfileTradingData(actorId: string, tradingCashBalance: number): Promise<{
  tradingCashBalance: number
  positionsValue: number
  totalEquity: number
  holdings: ProfileHoldingRow[]
  trades: ProfileTradeRow[]
}> {
  const [rawPositions, rawActions] = await Promise.all([
    db.query.marketPositions.findMany({
      where: and(
        eq(marketPositions.actorId, actorId),
        or(gt(marketPositions.yesShares, 0), gt(marketPositions.noShares, 0)),
      ),
    }),
    db.query.marketActions.findMany({
      where: and(
        eq(marketActions.actorId, actorId),
        eq(marketActions.actionSource, 'human'),
        eq(marketActions.status, 'ok'),
        inArray(marketActions.action, [...PROFILE_TRADE_ACTIONS]),
      ),
      orderBy: [desc(marketActions.createdAt)],
      limit: 50,
    }),
  ])

  const referencedMarketIds = new Set<string>()
  for (const position of rawPositions) {
    referencedMarketIds.add(position.marketId)
  }
  for (const action of rawActions) {
    referencedMarketIds.add(action.marketId)
  }

  const marketIds = Array.from(referencedMarketIds)
  const markets = marketIds.length > 0
    ? await db.query.predictionMarkets.findMany({
        columns: predictionMarketColumns,
        where: inArray(predictionMarkets.id, marketIds),
      })
    : []

  const questionIds = Array.from(new Set(
    markets
      .map((market) => market.trialQuestionId)
      .filter((value): value is string => Boolean(value)),
  ))
  const rawQuestions = questionIds.length > 0
    ? await db.query.trialQuestions.findMany({
        where: inArray(trialQuestions.id, questionIds),
        with: {
          trial: true,
        },
      })
    : []
  const supportedQuestionIds = new Set(filterSupportedTrialQuestions(rawQuestions).map((question) => question.id))
  const marketById = new Map(markets.map((market) => [market.id, market]))
  const openMarketById = new Map(markets.filter((market) => market.status === 'OPEN').map((market) => [market.id, market]))
  const questionById = new Map(rawQuestions.map((question) => [question.id, question]))

  const getMarketDisplay = (market: typeof markets[number]) => {
    const question = market.trialQuestionId ? questionById.get(market.trialQuestionId) : null
    return {
        marketHref: market.trialQuestionId && supportedQuestionIds.has(market.trialQuestionId) ? `/trials/${market.id}` : null,
        drugName: question?.trial.shortTitle?.trim() || 'Unknown trial',
        companyName: question?.trial.sponsorName?.trim() || '-',
        ticker: question?.trial.sponsorTicker?.trim() || '-',
        decisionDate: question?.trial.estPrimaryCompletionDate ?? null,
      }

  }

  const holdings = rawPositions
    .flatMap<ProfileHoldingRow>((position) => {
      const market = openMarketById.get(position.marketId)
      if (!market) return []

      const yesShares = Math.max(0, position.yesShares)
      const noShares = Math.max(0, position.noShares)
      if (yesShares <= 0 && noShares <= 0) return []

      const display = getMarketDisplay(market)
      const priceYes = market.priceYes
      const priceNo = 1 - market.priceYes
      const markValueUsd = (yesShares * priceYes) + (noShares * priceNo)

      return [{
        marketId: market.id,
        marketHref: display.marketHref,
        drugName: display.drugName,
        companyName: display.companyName,
        ticker: display.ticker,
        yesShares,
        noShares,
        markValueUsd,
        decisionDate: display.decisionDate,
      }]
    })
    .sort((a, b) => b.markValueUsd - a.markValueUsd)

  const trades = rawActions
    .flatMap<ProfileTradeRow>((action) => {
      if (!PROFILE_TRADE_ACTIONS.includes(action.action as ProfileTradeAction)) return []

      const market = marketById.get(action.marketId)
      const display = market ? getMarketDisplay(market) : {
        marketHref: null,
        drugName: 'Unknown market',
        companyName: '-',
        ticker: '-',
        decisionDate: null,
      }
      const timestamp = action.createdAt ?? action.runDate

      return [{
        id: action.id,
        timestamp,
        marketId: action.marketId,
        marketHref: display.marketHref,
        drugName: display.drugName,
        companyName: display.companyName,
        ticker: display.ticker,
        action: action.action as ProfileTradeAction,
        usdAmount: Math.max(0, action.usdAmount),
        shares: Math.abs(action.sharesDelta),
        priceAfter: action.priceAfter,
        status: action.status,
      }]
    })
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

  const positionsValue = holdings.reduce((sum, holding) => sum + holding.markValueUsd, 0)

  return {
    tradingCashBalance,
    positionsValue,
    totalEquity: tradingCashBalance + positionsValue,
    holdings,
    trades,
  }
}

async function updateProfileName(formData: FormData) {
  'use server'

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/profile')
  }

  const rawName = formData.get('name')
  const nextName = typeof rawName === 'string'
    ? resolveDisplayName(rawName, session.user.email ?? session.user.id)
    : getGeneratedDisplayName(session.user.email ?? session.user.id)

  await db.update(users)
    .set({ name: nextName })
    .where(eq(users.id, session.user.id))

  await db.update(marketActors)
    .set({
      displayName: nextName,
      updatedAt: new Date(),
    })
    .where(and(
      eq(marketActors.actorType, 'human'),
      eq(marketActors.userId, session.user.id),
    ))

  revalidatePath('/profile')
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/profile')
  }

  const user = await db.query.users.findFirst({
    columns: userColumns,
    where: eq(users.id, session.user.id),
  })

  if (!user) {
    redirect('/login?callbackUrl=/profile')
  }

  const { actor, account } = await ensureHumanTradingAccount({
    userId: user.id,
    displayName: user.name,
    startingCash: getCanonicalHumanStartingCash(Boolean(user.xVerifiedAt)),
  })

  const [{ tradingCashBalance, positionsValue, totalEquity, holdings, trades }, verificationStatus] = await Promise.all([
    getProfileTradingData(actor.id, account.cashBalance),
    getXVerificationStatusForUser(user.id).catch(() => {
      console.warn('Failed to load X verification status for profile page', { userId: user.id })
      return null
    }),
  ])
  const isVerified = Boolean(verificationStatus?.verified)
  const rank = isVerified ? (verificationStatus?.profile?.rank ?? null) : null
  const nameLabel = user.name
  const generatedIdentity = getGeneratedDisplayName(user.email || user.id)
  const identity = nameLabel || generatedIdentity
  const secondaryIdentity = user.email?.trim() || null
  const editableIdentity = nameLabel || generatedIdentity
  const statusTone = isVerified
    ? 'border-[#b8d9b8] bg-[#eef8ee] text-[#2b6a2f]'
    : 'border-[#eadcc9] bg-[#fbf6ef] text-[#816c4e]'
  const statusText = isVerified ? 'Verified Human Trader' : 'Verification Pending'

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
        {!isVerified || verificationStatus?.requiresReconnect ? (
          <div className="mb-6">
            <ProfileVerificationPanel />
          </div>
        ) : null}

        <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-6 sm:p-9">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Profile</h1>
                <HeaderDots />
              </div>
              <div className={`rounded-sm border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] ${statusTone}`}>
                {statusText}
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ProfileHandleCard
                handle={editableIdentity}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                updateAction={updateProfileName}
              />
              <div className="relative min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Cash</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-[#1a1a1a]">{formatUsd(tradingCashBalance)}</p>
                <div className="mt-2 inline-flex items-center rounded-full border border-[#d9cdbf] bg-[#f8f3ec] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#8a8075]">
                  Paper Trading
                </div>
              </div>
              <div className="min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Open Positions Value</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-[#1a1a1a]">{formatUsd(positionsValue)}</p>
              </div>
              <div className="min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4 md:col-span-2 xl:col-span-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Humans Rank</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-[#1a1a1a]">{rank ? `#${rank}` : '-'}</p>
              </div>
            </div>

            <div className="mt-6 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
              <div className="grid gap-3 text-sm text-[#7f7469] sm:grid-cols-2">
                <p>
                  Email: <span className="font-medium text-[#1a1a1a]">{secondaryIdentity || 'No email on file'}</span>
                </p>
                <p>
                  X post verification: <span className="font-medium text-[#1a1a1a]">{verificationStatus?.verified ? 'Verified' : 'Not verified'}</span>
                </p>
                <p>
                  <XInlineMark className="mr-1" /> connected: <span className="font-medium text-[#1a1a1a]">{verificationStatus?.connected ? 'Yes' : 'No'}</span>
                </p>
                <p>
                  Verified at:{' '}
                  <LocalDateTime
                    value={verificationStatus?.verifiedAt ?? null}
                    className="font-medium text-[#1a1a1a]"
                  />
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Holdings</h2>
                <HeaderDots />
              </div>

              <section className="mt-3 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
                {holdings.length === 0 ? (
                  <p className="text-sm text-[#8a8075]">No open holdings yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] table-fixed text-sm">
                      <colgroup>
                        <col className="w-[26rem]" />
                        <col className="w-[5rem]" />
                        <col className="w-[6rem]" />
                        <col className="w-[6rem]" />
                        <col className="w-[6rem]" />
                      </colgroup>
                    <thead>
                      <tr className="border-b border-[#e8ddd0]">
                        <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Market</th>
                        <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Ticker</th>
                        <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">YES Shares</th>
                        <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">NO Shares</th>
                        <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Mark Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((holding) => (
                        <tr key={`${holding.marketId}-${holding.ticker}`} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                          <td className="px-2 py-2 text-[#8a8075]">
                            {holding.marketHref ? (
                              <Link
                                href={holding.marketHref}
                                className="transition-colors hover:text-[#6d645a]"
                              >
                                {holding.drugName}
                              </Link>
                            ) : (
                              <span>{holding.drugName}</span>
                            )}
                            <div className="hidden">
                              {holding.ticker !== '-' ? ` (${holding.ticker})` : ''}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-[#8a8075]">{holding.ticker}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-[#8a8075]">{formatShares(holding.yesShares)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-[#8a8075]">{formatShares(holding.noShares)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-[#8a8075]">{formatUsd(holding.markValueUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Transactions</h2>
                <HeaderDots />
              </div>

              <section className="mt-3 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
                {trades.length === 0 ? (
                  <p className="text-sm text-[#8a8075]">No transactions yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-[9rem]" />
                      <col className="w-[24rem]" />
                      <col className="w-[4.5rem]" />
                      <col className="w-[5.5rem]" />
                      <col className="w-[5.5rem]" />
                      <col className="w-[5rem]" />
                      <col className="w-[5rem]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-[#e8ddd0]">
                        <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Date</th>
                        <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Market</th>
                        <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Ticker</th>
                        <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Action</th>
                        <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Amount</th>
                        <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Shares</th>
                        <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Fill Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade) => {
                        const actionLabel = toTradeActionLabel(trade.action)
                        const actionTone = trade.action.startsWith('BUY') ? 'text-[#2f7b63]' : 'text-[#b3566b]'

                        return (
                          <tr key={trade.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                            <td className="px-2 py-2 align-middle whitespace-nowrap text-[#8a8075]">
                              <LocalDateTime value={trade.timestamp.toISOString()} />
                            </td>
                            <td className="px-2 py-2 align-middle whitespace-nowrap text-[#8a8075]">
                              {trade.marketHref ? (
                                <Link
                                  href={trade.marketHref}
                                  className="transition-colors hover:text-[#6d645a]"
                                >
                                  {trade.drugName}
                                </Link>
                              ) : (
                                <span>{trade.drugName}</span>
                              )}
                            </td>
                            <td className="px-2 py-2 align-middle whitespace-nowrap text-[#8a8075]">{trade.ticker}</td>
                            <td className={`px-2 py-2 align-middle whitespace-nowrap ${actionTone}`}>{actionLabel}</td>
                            <td className="px-2 py-2 align-middle text-right tabular-nums text-[#8a8075]">{formatUsd(trade.usdAmount)}</td>
                            <td className="px-2 py-2 align-middle text-right tabular-nums text-[#8a8075]">{formatShares(trade.shares)}</td>
                            <td className="px-2 py-2 align-middle text-right tabular-nums text-[#8a8075]">{formatPricePercent(trade.priceAfter)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <LogoutButton />
            </div>
          </section>
        </GradientBorder>
      </main>

      <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-6 sm:pb-12">
        <FooterGradientRule />
      </div>
    </PageFrame>
  )
}
