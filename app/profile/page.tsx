import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { ProfileHandleCard } from '@/components/ProfileHandleCard'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { PublicNavbar } from '@/components/site/PublicNavbar'
import { Season4LogoutButton } from '@/components/season4/Season4LogoutButton'
import { Season4ProfileActions } from '@/components/season4/Season4ProfileActions'
import { Season4WalletAddressCopy } from '@/components/season4/Season4WalletAddressCopy'
import { getSession } from '@/lib/auth/session'
import { db, users } from '@/lib/db'
import { DISPLAY_NAME_MAX_LENGTH, getGeneratedDisplayName, resolveDisplayName } from '@/lib/display-name'
import { getSeason4ProfileData } from '@/lib/season4-profile-data'
import { buildNoIndexMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Season 4 Profile',
  description: 'Private season 4 wallet, faucet, and onchain activity.',
  path: '/profile',
})

const BASESCAN_TX_BASE_URL = 'https://sepolia.basescan.org/tx'

function txUrl(hash: string): string {
  return `${BASESCAN_TX_BASE_URL}/${hash}`
}

function formatTxProof(hash: string): string {
  if (hash.length <= 18) return hash
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(safe)
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function formatShares(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, '') || '0'
}

async function updateProfileName(formData: FormData) {
  'use server'

  const session = await getSession()
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

  revalidatePath('/profile')
  revalidatePath('/leaderboard')
}

export default async function ProfilePage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/profile')
  }

  const profile = await getSeason4ProfileData(session.user.id, { sync: true })
  const xStatus = profile.user.xUsername ? `@${profile.user.xUsername}` : 'Not linked'
  const editableIdentity = profile.user.name?.trim() || getGeneratedDisplayName(profile.user.email ?? profile.user.id)

  return (
    <PageFrame>
      <PublicNavbar />

      <main className="mx-auto max-w-5xl px-4 pb-6 pt-10 sm:px-6 sm:pb-8 sm:pt-16">
        {!profile.viewer.hasClaimedFaucet ? (
          <Season4ProfileActions
            className="mb-6"
            walletAddress={profile.wallet.address}
            isFaucetConfigured={profile.chain.enabled}
            hasClaimedFaucet={profile.viewer.hasClaimedFaucet}
            canClaimFromFaucet={profile.viewer.canClaimFromFaucet}
            claimAmountLabel={profile.viewer.faucetClaimAmountLabel}
          />
        ) : null}

        <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-6 sm:p-9">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Profile</h1>
                <HeaderDots />
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Cash</p>
                <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg font-semibold tabular-nums text-[#1a1a1a]">
                  <span>{formatUsd(profile.totals.collateralBalanceDisplay)}</span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#8a8075]">USDC testnet</span>
                </p>
                <div
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#d9cdbf] bg-[#f8f3ec] px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-[0.12em] text-[#8a8075] sm:text-[8px]"
                  title="Base Sepolia (Test Net)"
                  aria-label="Base Sepolia (Test Net)"
                >
                  <span>Base Sepolia (Test Net)</span>
                </div>
              </div>
              <div className="rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Positions Value</p>
                <p className="mt-3 text-lg font-semibold tabular-nums text-[#1a1a1a]">
                  {formatUsd(profile.totals.positionsValueDisplay)}
                </p>
              </div>
              <ProfileHandleCard
                handle={editableIdentity}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                updateAction={updateProfileName}
              />
            </div>

            <div className="mt-6 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Identity</h2>
                <HeaderDots />
              </div>
              <div className="mt-4 grid gap-6 text-sm text-[#7f7469] sm:grid-cols-2">
                <div className="space-y-3">
                  <p>
                    Email: <span className="font-medium text-[#1a1a1a]">{profile.user.email ?? 'No email on file'}</span>
                  </p>
                  <p>
                    X: <span className="font-medium text-[#1a1a1a]">{xStatus}</span>
                  </p>
                </div>
                <div className="space-y-3">
                  <p>
                    Wallet: <Season4WalletAddressCopy value={profile.wallet.address} />
                  </p>
                  <p>
                    Wallet status: <span className="font-medium text-[#1a1a1a]">{profile.wallet.provisioningStatus}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Holdings</h2>
                <HeaderDots />
              </div>

              <section className="mt-3 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
                {profile.holdings.length === 0 ? (
                  <p className="text-sm text-[#8a8075]">No season 4 positions yet. Claim the faucet and visit a live market to start trading.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-[#e8ddd0]">
                          <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Market</th>
                          <th className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">YES</th>
                          <th className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">NO</th>
                          <th className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Price</th>
                          <th className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Mark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.holdings.map((holding) => (
                          <tr key={`${holding.marketId}-${holding.marketSlug}`} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                            <td className="px-2 py-2 text-[#8a8075]">
                              <Link href={holding.marketHref} className="transition-colors hover:text-[#6d645a]">
                                {holding.title}
                              </Link>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                <span className="rounded-full border border-[#e7dccf] bg-[#f8f4ee] px-2 py-0.5">{holding.status}</span>
                                {holding.resolvedOutcome ? (
                                  <span className="text-[#7f7469]">{holding.resolvedOutcome} settled</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums text-[#8a8075]">{formatShares(holding.yesShares)}</td>
                            <td className="px-2 py-2 text-center tabular-nums text-[#8a8075]">{formatShares(holding.noShares)}</td>
                            <td className="px-2 py-2 text-center tabular-nums text-[#8a8075]">{formatPercent(holding.priceYes)}</td>
                            <td className="px-2 py-2 text-center tabular-nums text-[#8a8075]">{formatUsd(holding.markValueDisplay)}</td>
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
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Recent Activity</h2>
                <HeaderDots />
              </div>

              <section className="mt-3 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
                {profile.activities.length === 0 ? (
                  <p className="text-sm text-[#8a8075]">No onchain activity yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[#e8ddd0]">
                          <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Date</th>
                          <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Activity</th>
                          <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Market</th>
                          <th className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Amount</th>
                          <th className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Shares</th>
                          <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Approval Tx</th>
                          <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Action Tx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.activities.map((activity) => (
                          <tr key={`${activity.txHash}-${activity.createdAt}`} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                            <td className="px-2 py-2 whitespace-nowrap text-[#8a8075]">
                              <LocalDateTime value={activity.createdAt} />
                            </td>
                            <td className="px-2 py-2 text-[#1a1a1a]">{activity.label}</td>
                            <td className="px-2 py-2 text-[#8a8075]">
                              {activity.marketHref && activity.title ? (
                                <Link href={activity.marketHref} className="transition-colors hover:text-[#6d645a]">
                                  {activity.title}
                                </Link>
                              ) : (
                                <span>{activity.title ?? 'Season 4 faucet'}</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums text-[#8a8075]">
                              {activity.amountLabel ?? formatUsd(activity.collateralAmountDisplay)}
                            </td>
                            <td className="px-2 py-2 text-center tabular-nums text-[#8a8075]">
                              {activity.shareDeltaDisplay !== null ? formatShares(activity.shareDeltaDisplay) : '—'}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {activity.approvalTxHash ? (
                                <a
                                  href={txUrl(activity.approvalTxHash)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={activity.approvalTxHash}
                                  className="text-[#6d645a] underline decoration-dotted decoration-[#ddd2c5] underline-offset-4 transition-colors hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                                >
                                  {formatTxProof(activity.approvalTxHash)}
                                </a>
                              ) : (
                                <span className="text-[#b5aa9e]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              <a
                                href={txUrl(activity.txHash)}
                                target="_blank"
                                rel="noreferrer"
                                title={activity.txHash}
                                className="text-[#6d645a] underline decoration-dotted decoration-[#ddd2c5] underline-offset-4 transition-colors hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                              >
                                {formatTxProof(activity.txHash)}
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </section>
        </GradientBorder>

        <div className="mt-4 flex justify-start sm:mt-5">
          <Season4LogoutButton />
        </div>
      </main>

      <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-6 sm:pb-10">
        <FooterGradientRule />
      </div>
    </PageFrame>
  )
}
