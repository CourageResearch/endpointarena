import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminTrialConstantsManager, type TrialRuntimeConfigDto } from '@/components/AdminTrialConstantsManager'
import { AdminModelStartingBankroll } from '@/components/AdminModelStartingBankroll'
import { getTrialRuntimeConfig } from '@/lib/trial-runtime-config'
import { db, users } from '@/lib/db'

export const dynamic = 'force-dynamic'

function toDto(config: Awaited<ReturnType<typeof getTrialRuntimeConfig>>): TrialRuntimeConfigDto {
  return {
    warmupRunCount: config.warmupRunCount,
    warmupMaxTradeUsd: config.warmupMaxTradeUsd,
    warmupBuyCashFraction: config.warmupBuyCashFraction,
    steadyMaxTradeUsd: config.steadyMaxTradeUsd,
    steadyBuyCashFraction: config.steadyBuyCashFraction,
    maxPositionPerSideShares: config.maxPositionPerSideShares,
    openingLmsrB: config.openingLmsrB,
    signupUserLimit: config.signupUserLimit,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

export default async function AdminSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const [config, userRows] = await Promise.all([
    getTrialRuntimeConfig(),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
  ])
  const currentUsersCount = userRows[0]?.count ?? 0

  return (
    <AdminConsoleLayout
      title="Runtime Settings"
      activeTab="settings"
    >
      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Runtime Controls</h2>
        <p className="text-sm text-[#8a8075] mt-1">
          Changes apply immediately after saving. Trial settings affect new openings and future runs; signup limits affect new account creation.
        </p>
      </section>

      <div className="space-y-4">
        <AdminTrialConstantsManager initialConfig={toDto(config)} currentUsersCount={currentUsersCount} />
        <AdminModelStartingBankroll />
      </div>
    </AdminConsoleLayout>
  )
}
