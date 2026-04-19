import { sql } from 'drizzle-orm'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import {
  AdminDatabaseTargetManager,
  type AdminDatabaseTargetOptionDto,
  type RuntimeSettingsConfigDto,
  type RuntimeSettingsTargetDto,
} from '@/components/AdminDatabaseTargetManager'
import { redirectIfNotAdmin } from '@/lib/admin-auth'
import { getDatabaseTargetRuntimeState, listDatabaseTargets } from '@/lib/database-target'
import { ensureToyAdminUser, ensureToyDatabaseSchema } from '@/lib/toy-database'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { getDbForTarget, trials, users } from '@/lib/db'

export const dynamic = 'force-dynamic'

function toRuntimeConfigDto(config: Awaited<ReturnType<typeof getMarketRuntimeConfig>>): RuntimeSettingsConfigDto {
  return {
    toyTrialCount: config.toyTrialCount,
    season4MarketLiquidityBDisplay: config.season4MarketLiquidityBDisplay,
    season4HumanStartingBankrollDisplay: config.season4HumanStartingBankrollDisplay,
    season4StartingBankrollDisplay: config.season4StartingBankrollDisplay,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

async function buildRuntimeSettingsTargets(
  options: AdminDatabaseTargetOptionDto[],
  activeTarget: ReturnType<typeof getDatabaseTargetRuntimeState>['activeTarget'],
): Promise<RuntimeSettingsTargetDto[]> {
  return Promise.all(options.map(async (option) => {
    if (!option.configured) {
      return {
        target: option.target,
        label: option.label,
        databaseName: option.databaseName,
        configured: false,
        isActive: option.target === activeTarget,
        config: null,
        errorMessage: 'Database target is not configured.',
      }
    }

    try {
      if (option.target === 'toy') {
        await ensureToyDatabaseSchema()
      }

      const config = await getMarketRuntimeConfig(getDbForTarget(option.target))
      return {
        target: option.target,
        label: option.label,
        databaseName: option.databaseName,
        configured: true,
        isActive: option.target === activeTarget,
        config: toRuntimeConfigDto(config),
        errorMessage: null,
      }
    } catch (error) {
      return {
        target: option.target,
        label: option.label,
        databaseName: option.databaseName,
        configured: option.configured,
        isActive: option.target === activeTarget,
        config: null,
        errorMessage: error instanceof Error ? error.message : 'Unable to load runtime settings.',
      }
    }
  }))
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
  await redirectIfNotAdmin('/admin/settings')

  const runtimeState = getDatabaseTargetRuntimeState()
  const databaseTargetOptions = await buildDatabaseTargetOptions()
  const runtimeSettingsTargets = await buildRuntimeSettingsTargets(databaseTargetOptions, runtimeState.activeTarget)
  const toyRuntimeConfig = runtimeSettingsTargets.find((target) => target.target === 'toy')?.config

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
          activeTarget={runtimeState.activeTarget}
          runtimeState={runtimeState}
          options={databaseTargetOptions}
          toyTrialCount={toyRuntimeConfig?.toyTrialCount ?? 0}
          runtimeSettingsTargets={runtimeSettingsTargets}
        />
      </div>
    </AdminConsoleLayout>
  )
}
