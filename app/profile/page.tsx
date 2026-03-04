import { redirect } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { eq } from 'drizzle-orm'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { LogoutButton } from '@/components/LogoutButton'
import { ProfileVerificationPanel } from '@/components/ProfileVerificationPanel'
import { ProfilePointsBalance } from '@/components/ProfilePointsBalance'
import { authOptions } from '@/lib/auth'
import { db, users } from '@/lib/db'
import { STARTER_POINTS } from '@/lib/constants'
import { getTwitterVerificationStatusForUser } from '@/lib/twitter-status'

export const dynamic = 'force-dynamic'

function formatDate(value: Date | null | undefined): string {
  if (!value) return '—'
  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

async function updateProfileName(formData: FormData) {
  'use server'

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/profile')
  }

  const rawName = formData.get('name')
  const trimmedName = typeof rawName === 'string' ? rawName.trim() : ''
  const nextName = trimmedName.length > 0 ? trimmedName.slice(0, 80) : null

  await db.update(users)
    .set({ name: nextName })
    .where(eq(users.id, session.user.id))

  revalidatePath('/profile')
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/profile')
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user) {
    redirect('/login?callbackUrl=/profile')
  }

  const verificationStatus = await getTwitterVerificationStatusForUser(user.id)
  const isVerified = Boolean(verificationStatus?.verified)
  const pointsState = isVerified
    ? {
        pointsBalance: verificationStatus?.profile?.pointsBalance ?? (user.pointsBalance ?? STARTER_POINTS),
        lastPointsRefillAt: verificationStatus?.profile?.lastPointsRefillAt
          ? new Date(verificationStatus.profile.lastPointsRefillAt)
          : (user.lastPointsRefillAt ?? null),
      }
    : {
        pointsBalance: user.pointsBalance ?? STARTER_POINTS,
        lastPointsRefillAt: user.lastPointsRefillAt ?? null,
      }
  const rank = isVerified ? (verificationStatus?.profile?.rank ?? null) : null
  const refillAwarded = verificationStatus?.profile?.refillAwarded ?? 0
  const nameLabel = user.name?.trim() || null
  const identity = nameLabel || (user.xUsername?.trim() ? `@${user.xUsername}` : (user.email || user.id))
  const secondaryIdentity = user.email && user.email !== identity ? user.email : null
  const statusTone = isVerified
    ? 'border-[#b8d9b8] bg-[#eef8ee] text-[#2b6a2f]'
    : 'border-[#eadcc9] bg-[#fbf6ef] text-[#816c4e]'
  const statusText = isVerified ? 'Verified Human Trader' : 'Verification Pending'

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
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

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Identity</p>
                <p className="mt-2 text-lg font-semibold text-[#1a1a1a]">{identity}</p>
                <p className="mt-1 text-xs text-[#8a8075]">{secondaryIdentity || 'No email on file'}</p>
                <form action={updateProfileName} className="mt-3 flex items-center gap-2">
                  <input
                    name="name"
                    type="text"
                    defaultValue={user.name ?? ''}
                    placeholder="Set display name"
                    maxLength={80}
                    className="h-9 w-full rounded-sm border border-[#e8ddd0] bg-white px-2.5 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-9 shrink-0 items-center rounded-sm border border-[#d9cdbf] bg-white px-3 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                  >
                    Save
                  </button>
                </form>
              </div>
              <div className="relative min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Points Balance</p>
                <ProfilePointsBalance
                  pointsBalance={pointsState.pointsBalance}
                  pointsAwarded={refillAwarded}
                  userId={user.id}
                  userCreatedAtIso={user.createdAt ? user.createdAt.toISOString() : null}
                />
              </div>
              <div className="min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4 md:col-span-2 xl:col-span-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Humans Rank</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-[#1a1a1a]">{rank ? `#${rank}` : '—'}</p>
                <p className="mt-1 text-xs text-[#8a8075]">{isVerified ? 'Live among verified players.' : 'Unlock by verifying your tweet.'}</p>
              </div>
            </div>

            <div className="mt-6 rounded-sm border border-[#e8ddd0] bg-white/80 p-4 sm:p-5">
              <div className="grid gap-3 text-sm text-[#7f7469] sm:grid-cols-2">
                <p>
                  X connected: <span className="font-medium text-[#1a1a1a]">{verificationStatus?.connected ? 'Yes' : 'No'}</span>
                </p>
                <p>
                  Tweet verification: <span className="font-medium text-[#1a1a1a]">{verificationStatus?.verified ? 'Verified' : 'Not verified'}</span>
                </p>
                <p>
                  Last daily refill: <span className="font-medium text-[#1a1a1a]">{formatDate(pointsState.lastPointsRefillAt)}</span>
                </p>
                <p>
                  Verified at: <span className="font-medium text-[#1a1a1a]">{formatDate(verificationStatus?.verifiedAt ? new Date(verificationStatus.verifiedAt) : null)}</span>
                </p>
                <p className="sm:col-span-2">
                  Must keep tweet live until: <span className="font-medium text-[#1a1a1a]">{formatDate(verificationStatus?.mustStayUntil ? new Date(verificationStatus.mustStayUntil) : null)}</span>
                </p>
              </div>
            </div>

            {!isVerified ? <ProfileVerificationPanel /> : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/markets"
                className="inline-flex items-center rounded-sm border border-[#d9cdbf] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                Open markets
              </Link>
              <Link
                href="/leaderboard"
                className="inline-flex items-center rounded-sm border border-[#d9cdbf] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                View leaderboard
              </Link>
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
