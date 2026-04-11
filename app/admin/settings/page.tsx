import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminDatabaseTargetManager, type AdminDatabaseTargetOptionDto } from '@/components/AdminDatabaseTargetManager'
import { AdminTrialConstantsManager, type TrialRuntimeConfigDto } from '@/components/AdminTrialConstantsManager'
import { AdminModelStartingBankroll } from '@/components/AdminModelStartingBankroll'
import { getActiveDatabaseTarget, listDatabaseTargets } from '@/lib/database-target'
import { ensureToyAdminUser } from '@/lib/toy-database'
import { getTrialRuntimeConfig } from '@/lib/trial-runtime-config'
import { db, getDbForTarget, trials, users } from '@/lib/db'

export const dynamic = 'force-dynamic'

function toDto(config: Awaited<ReturnType<typeof getTrialRuntimeConfig>>): TrialRuntimeConfigDto {
  return {
    openingLmsrB: config.openingLmsrB,
    toyTrialCount: config.toyTrialCount,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

async function buildDatabaseTargetOptions(): Promise<AdminDatabaseTargetOptionDto[]> {
  return Promise.all(listDatabaseTargets().map(async (target) => {
    if (!target.configured) {
      return {
        ...target,
        usersCount: null,
        trialsCount: null,
        errorMessage: null,
      }
    }

    try {
      if (target.target === 'toy') {
        await ensureToyAdminUser()
      }

      const targetDb = getDbForTarget(target.target)
      const [userRows, trialRows] = await Promise.all([
        targetDb.select({ count: sql<number>`count(*)::int` }).from(users),
        targetDb.select({ count: sql<number>`count(*)::int` }).from(trials),
      ])

      return {
        ...target,
        usersCount: userRows[0]?.count ?? 0,
        trialsCount: trialRows[0]?.count ?? 0,
        errorMessage: null,
      }
    } catch (error) {
      return {
        ...target,
        usersCount: null,
        trialsCount: null,
        errorMessage: error instanceof Error ? error.message : 'Unable to query this database target.',
      }
    }
  }))
}

export default async function AdminSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const [config, databaseTargetOptions] = await Promise.all([
    getTrialRuntimeConfig(),
    buildDatabaseTargetOptions(),
  ])
  const activeDatabaseTarget = getActiveDatabaseTarget()

  return (
    <AdminConsoleLayout
      title="Settings"
      activeTab="settings"
    >
      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Runtime Controls</h2>
      </section>

      <div className="space-y-4">
        <AdminDatabaseTargetManager
          activeTarget={activeDatabaseTarget}
          options={databaseTargetOptions}
          toyTrialCount={config.toyTrialCount}
        />
        <AdminTrialConstantsManager initialConfig={toDto(config)} />
        <AdminModelStartingBankroll />
      </div>
    </AdminConsoleLayout>
  )
}
