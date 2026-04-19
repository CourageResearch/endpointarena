import { revalidatePath } from 'next/cache'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import Link from 'next/link'
import { ensureAdmin, redirectIfNotAdmin, requireAdminSession } from '@/lib/admin-auth'
import { isConfiguredAdminEmail } from '@/lib/constants'
import { accounts, db, onchainBalances, onchainEvents, onchainUserWallets, users } from '@/lib/db'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { XInlineMark } from '@/components/XMark'
import { formatStoredCountry, formatStoredRegion } from '@/lib/geo-country'
import { getSeason4MarketSummaries } from '@/lib/season4-market-data'
import { userColumns, type UserColumnsRow } from '@/lib/users/query-shapes'

export const dynamic = 'force-dynamic'

const SORT_KEYS = ['created', 'money', 'tx', 'country', 'region'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

type SearchParamValue = string | string[] | undefined
type PageSearchParams = Record<string, SearchParamValue>
type UserSortKey = (typeof SORT_KEYS)[number]
type SortDirection = (typeof SORT_DIRECTIONS)[number]

function firstSearchParam(value: SearchParamValue): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }
  return typeof value === 'string' ? value : ''
}

function parseSortKey(value: string): UserSortKey {
  return SORT_KEYS.includes(value as UserSortKey) ? (value as UserSortKey) : 'created'
}

function defaultSortDirection(sortKey: UserSortKey): SortDirection {
  if (sortKey === 'country' || sortKey === 'region') return 'asc'
  return 'desc'
}

function parseSortDirection(value: string, sortKey: UserSortKey): SortDirection {
  if (SORT_DIRECTIONS.includes(value as SortDirection)) {
    return value as SortDirection
  }
  return defaultSortDirection(sortKey)
}

function buildSortHref({
  currentSortKey,
  currentSortDirection,
  targetSortKey,
}: {
  currentSortKey: UserSortKey
  currentSortDirection: SortDirection
  targetSortKey: UserSortKey
}): string {
  const nextDirection: SortDirection = currentSortKey === targetSortKey
    ? (currentSortDirection === 'asc' ? 'desc' : 'asc')
    : defaultSortDirection(targetSortKey)
  const params = new URLSearchParams()
  params.set('sort', targetSortKey)
  params.set('dir', nextDirection)
  return `/admin/users?${params.toString()}`
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0
  return a > b ? 1 : -1
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en-US', { sensitivity: 'base' })
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function normalizeUnknownToDash(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return '—'
  return trimmed
}

function extractOnchainMarketId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith('market:') ? trimmed.slice('market:'.length) : trimmed
}

function getSeason4PricePair(market: {
  resolvedOutcome: 'YES' | 'NO' | null
  priceYes: number | null
}): {
  priceYes: number
  priceNo: number
} {
  if (market.resolvedOutcome === 'YES') {
    return { priceYes: 1, priceNo: 0 }
  }
  if (market.resolvedOutcome === 'NO') {
    return { priceYes: 0, priceNo: 1 }
  }

  const livePriceYes = typeof market.priceYes === 'number'
    ? Math.min(1, Math.max(0, market.priceYes))
    : 0.5

  return {
    priceYes: livePriceYes,
    priceNo: Math.max(0, 1 - livePriceYes),
  }
}

async function deleteUser(formData: FormData) {
  'use server'

  const session = await requireAdminSession()
  const currentAdminEmail = session.user.email?.trim().toLowerCase() ?? null
  const rawId = formData.get('userId')
  const userId = typeof rawId === 'string' ? rawId.trim() : ''

  if (!userId) return

  const user = await db.query.users.findFirst({
    columns: userColumns,
    where: eq(users.id, userId),
  })

  if (!user) return

  const targetEmail = user.email?.trim().toLowerCase() ?? null

  // Prevent removing the current session owner or the configured admin account.
  if ((currentAdminEmail && targetEmail === currentAdminEmail) || isConfiguredAdminEmail(targetEmail)) {
    return
  }

  await db.delete(users).where(eq(users.id, userId))
  revalidatePath('/admin/users')
}

async function getUsersData() {
  const [userRows, totalRows] = await Promise.all([
    db.query.users.findMany({
      columns: userColumns,
      orderBy: [desc(users.createdAt)],
    }),
    db.select({ count: sql<number>`count(*)` }).from(users),
  ])

  return {
    users: userRows,
    total: totalRows[0]?.count ?? 0,
  }
}

async function getUserTradingStats(userRows: UserColumnsRow[]) {
  const userIds = userRows.map((user) => user.id)
  if (userIds.length === 0) {
    return {
      cashBalanceByUserId: new Map<string, number>(),
      positionsValueByUserId: new Map<string, number>(),
      tradeCountByUserId: new Map<string, number>(),
    }
  }

  const walletRows = await db.select({
    userId: onchainUserWallets.userId,
    walletAddress: onchainUserWallets.walletAddress,
  })
    .from(onchainUserWallets)
    .where(inArray(onchainUserWallets.userId, userIds))

  const walletAddresses = Array.from(new Set(
    walletRows
      .map((row) => row.walletAddress?.trim().toLowerCase() ?? '')
      .filter(Boolean),
  ))

  if (walletAddresses.length === 0) {
    return {
      cashBalanceByUserId: new Map<string, number>(),
      positionsValueByUserId: new Map<string, number>(),
      tradeCountByUserId: new Map<string, number>(),
    }
  }

  const [balanceRows, tradeRows, marketSummaries] = await Promise.all([
    db.select({
      userId: onchainBalances.userId,
      walletAddress: onchainBalances.walletAddress,
      marketRef: onchainBalances.marketRef,
      collateralDisplay: onchainBalances.collateralDisplay,
      yesShares: onchainBalances.yesShares,
      noShares: onchainBalances.noShares,
    })
      .from(onchainBalances)
      .where(inArray(onchainBalances.walletAddress, walletAddresses)),
    db.select({
      walletAddress: onchainEvents.walletAddress,
      tradeCount: sql<number>`count(*)::int`,
    })
      .from(onchainEvents)
      .where(and(
        inArray(onchainEvents.walletAddress, walletAddresses),
        eq(onchainEvents.eventName, 'TradeExecuted'),
      ))
      .groupBy(onchainEvents.walletAddress),
    getSeason4MarketSummaries(),
  ])

  const userIdByWallet = new Map(
    walletRows.flatMap((row) => {
      const walletAddress = row.walletAddress?.trim().toLowerCase() ?? ''
      return walletAddress ? [[walletAddress, row.userId] as const] : []
    }),
  )
  const marketById = new Map(
    marketSummaries.flatMap((market) => (
      market.onchainMarketId ? [[market.onchainMarketId, market] as const] : []
    )),
  )

  const cashBalanceByUserId = new Map<string, number>()
  const positionsValueByUserId = new Map<string, number>()
  const tradeCountByUserId = new Map<string, number>()

  for (const row of balanceRows) {
    const walletAddress = row.walletAddress.trim().toLowerCase()
    const userId = userIdByWallet.get(walletAddress) ?? row.userId ?? null
    if (!userId) continue

    if (row.marketRef === 'collateral') {
      cashBalanceByUserId.set(
        userId,
        (cashBalanceByUserId.get(userId) ?? 0) + (row.collateralDisplay ?? 0),
      )
      continue
    }

    const marketId = extractOnchainMarketId(row.marketRef)
    if (!marketId) continue
    const market = marketById.get(marketId)
    if (!market) continue

    const { priceYes, priceNo } = getSeason4PricePair(market)
    const markValue = (row.yesShares ?? 0) * priceYes + (row.noShares ?? 0) * priceNo

    positionsValueByUserId.set(
      userId,
      (positionsValueByUserId.get(userId) ?? 0) + markValue,
    )
  }

  for (const row of tradeRows) {
    const walletAddress = row.walletAddress?.trim().toLowerCase() ?? ''
    const userId = walletAddress ? userIdByWallet.get(walletAddress) ?? null : null
    if (!userId) continue

    tradeCountByUserId.set(
      userId,
      (tradeCountByUserId.get(userId) ?? 0) + Number(row.tradeCount ?? 0),
    )
  }

  return {
    cashBalanceByUserId,
    positionsValueByUserId,
    tradeCountByUserId,
  }
}

async function fetchXUsername(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.twitter.com/2/users/me?user.fields=username', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) return null

    const payload = await response.json() as {
      data?: { username?: string }
    }
    const username = payload?.data?.username
    if (typeof username !== 'string') return null
    const trimmed = username.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function backfillMissingXUsernames(userRows: UserColumnsRow[]) {
  const userIds = userRows.map((user) => user.id)
  if (userIds.length === 0) return

  const xAccounts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.provider, 'twitter'),
      inArray(accounts.userId, userIds),
    ),
  })
  const accountByUserId = new Map(xAccounts.map((account) => [account.userId, account]))

  const candidates = userRows
    .filter((user) => {
      const hasStoredUsername = Boolean(user.xUsername?.trim())
      const connected = Boolean(user.xUserId || accountByUserId.get(user.id)?.providerAccountId)
      const hasAccessToken = Boolean(accountByUserId.get(user.id)?.access_token)
      return connected && !hasStoredUsername && hasAccessToken
    })
    .slice(0, 10)

  await Promise.all(candidates.map(async (user) => {
    const account = accountByUserId.get(user.id)
    const accessToken = account?.access_token?.trim()
    if (!accessToken) return

    const username = await fetchXUsername(accessToken)
    if (!username) return

    await db.update(users)
      .set({ xUsername: username })
      .where(eq(users.id, user.id))

    user.xUsername = username
  }))
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const session = await redirectIfNotAdmin('/admin/users')

  const resolvedSearchParams = (await searchParams) ?? {}
  const sortKey = parseSortKey(firstSearchParam(resolvedSearchParams.sort))
  const sortDirection = parseSortDirection(firstSearchParam(resolvedSearchParams.dir), sortKey)
  const { users: userRows, total } = await getUsersData()
  await backfillMissingXUsernames(userRows)
  const { cashBalanceByUserId, positionsValueByUserId, tradeCountByUserId } = await getUserTradingStats(userRows)
  const currentAdminEmail = session.user.email?.trim().toLowerCase() ?? null

  const rows = userRows.map((user) => {
    const email = user.email ?? '—'
    const country = normalizeUnknownToDash(formatStoredCountry(user.signupLocation))
    const region = normalizeUnknownToDash(formatStoredRegion(user.signupState))
    const xLabel = user.xUsername ? `@${user.xUsername}` : (user.xUserId ? 'Connected' : '—')
    const cashBalance = cashBalanceByUserId.get(user.id) ?? 0
    const positionsValue = positionsValueByUserId.get(user.id) ?? 0
    const totalEquity = cashBalance + positionsValue
    const trades = tradeCountByUserId.get(user.id) ?? 0
    const emailLower = user.email?.trim().toLowerCase() ?? null
    const isProtectedUser = emailLower === currentAdminEmail || isConfiguredAdminEmail(emailLower)
    const createdAtMs = user.createdAt ? user.createdAt.getTime() : 0

    return {
      user,
      email,
      country,
      region,
      xLabel,
      cashBalance,
      positionsValue,
      totalEquity,
      trades,
      isProtectedUser,
      createdAtMs,
    }
  })

  const sortedRows = [...rows].sort((a, b) => {
    let result = 0
    switch (sortKey) {
      case 'money':
        result = compareNumbers(a.totalEquity, b.totalEquity)
        break
      case 'tx':
        result = compareNumbers(a.trades, b.trades)
        break
      case 'country':
        result = compareText(a.country, b.country)
        break
      case 'region':
        result = compareText(a.region, b.region)
        break
      case 'created':
      default:
        result = compareNumbers(a.createdAtMs, b.createdAtMs)
        break
    }

    if (result !== 0) {
      return sortDirection === 'asc' ? result : -result
    }

    return compareNumbers(b.createdAtMs, a.createdAtMs)
  })

  const sortDirectionMark = (key: UserSortKey): string => {
    if (sortKey !== key) return ''
    return sortDirection === 'asc' ? ' \u2191' : ' \u2193'
  }

  const sortDescriptionByKey: Record<UserSortKey, string> = {
    created: sortDirection === 'asc' ? 'Oldest first' : 'Newest first',
    money: `Equity (${sortDirection})`,
    tx: `TX (${sortDirection})`,
    country: `Country (${sortDirection})`,
    region: `Region (${sortDirection})`,
  }

  return (
    <AdminConsoleLayout
      title="Users"
      activeTab="users"
    >
      <section className="mb-6 grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{total}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Total Users</p>
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Registered Users</h2>
          <p className="text-xs text-[#8a8075]">{sortDescriptionByKey[sortKey]}</p>
        </div>

        {userRows.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No users found.</p>
        ) : (
          <div className="mt-4 overflow-hidden">
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[8%]" />
                <col className="w-[24%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-1.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Created</th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Name</th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Email</th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
                    <Link
                      href={buildSortHref({ currentSortKey: sortKey, currentSortDirection: sortDirection, targetSortKey: 'country' })}
                      className="inline-flex items-center transition-colors hover:text-[#8a8075]"
                    >
                      Country{sortDirectionMark('country')}
                    </Link>
                  </th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
                    <Link
                      href={buildSortHref({ currentSortKey: sortKey, currentSortDirection: sortDirection, targetSortKey: 'region' })}
                      className="inline-flex items-center transition-colors hover:text-[#8a8075]"
                    >
                      Region{sortDirectionMark('region')}
                    </Link>
                  </th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
                    <XInlineMark />
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
                    <Link
                      href={buildSortHref({ currentSortKey: sortKey, currentSortDirection: sortDirection, targetSortKey: 'money' })}
                      className="inline-flex w-full items-center justify-end transition-colors hover:text-[#8a8075]"
                    >
                      Equity{sortDirectionMark('money')}
                    </Link>
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
                    <Link
                      href={buildSortHref({ currentSortKey: sortKey, currentSortDirection: sortDirection, targetSortKey: 'tx' })}
                      className="inline-flex w-full items-center justify-end transition-colors hover:text-[#8a8075]"
                    >
                      TX{sortDirectionMark('tx')}
                    </Link>
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(({ user, email, country, region, xLabel, cashBalance, positionsValue, totalEquity, trades, isProtectedUser }) => {
                  return (
                    <tr key={user.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                      <td className="px-1.5 py-2 text-[#8a8075] whitespace-nowrap text-xs">
                        <LocalDateTime
                          value={user.createdAt ? user.createdAt.toISOString() : null}
                          emptyLabel="Unknown"
                          className="block truncate"
                        />
                      </td>
                      <td className="px-1.5 py-2 text-[#1a1a1a]">
                        <span className="block truncate" title={user.name || '—'}>{user.name || '—'}</span>
                      </td>
                      <td className="px-1.5 py-2 text-[#1a1a1a]">
                        <span className="block max-w-[22ch] truncate" title={email}>{email}</span>
                      </td>
                      <td className="px-1.5 py-2 text-[#8a8075]">
                        <span className="block truncate" title={country}>{country}</span>
                      </td>
                      <td className="px-1.5 py-2 text-[#8a8075]">
                        <span className="block truncate" title={region}>{region}</span>
                      </td>
                      <td className="px-1.5 py-2 text-[#8a8075]">
                        <span className="block truncate" title={xLabel}>{xLabel}</span>
                      </td>
                      <td
                        className="px-1.5 py-2 text-right tabular-nums text-[#1a1a1a] whitespace-nowrap"
                        title={`Cash ${formatMoney(cashBalance)} | Open ${formatMoney(positionsValue)}`}
                      >
                        {formatMoney(totalEquity)}
                      </td>
                      <td className="px-1.5 py-2 text-right tabular-nums text-[#8a8075] whitespace-nowrap">{trades.toLocaleString()}</td>
                      <td className="px-1.5 py-2 text-right whitespace-nowrap">
                        {isProtectedUser ? (
                          <span className="inline-flex h-7 items-center justify-center rounded-none border border-[#e8ddd0] bg-[#f7f2eb] px-1.5 text-[11px] font-medium text-[#b5aa9e]">
                            Protected
                          </span>
                        ) : (
                          <form action={deleteUser} className="inline">
                            <input type="hidden" name="userId" value={user.id} />
                            <button
                              type="submit"
                              className="inline-flex h-7 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-1.5 text-[11px] font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
                            >
                              Delete
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminConsoleLayout>
  )
}
