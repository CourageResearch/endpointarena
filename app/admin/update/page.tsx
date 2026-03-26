import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminTrialSyncPanel } from '@/components/AdminTrialSyncPanel'
import { getLatestTrialSyncChangeSet, listRecentTrialSyncRuns } from '@/lib/trial-sync-admin'
import { getTrialSyncConfig } from '@/lib/trial-sync-config'

export const dynamic = 'force-dynamic'

export default async function AdminUpdatePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const [syncConfig, syncRuns, latestSyncChangeSet] = await Promise.all([
    getTrialSyncConfig(),
    listRecentTrialSyncRuns(),
    getLatestTrialSyncChangeSet(),
  ])

  return (
    <AdminConsoleLayout
      title="Update"
      description="Manually sync the Phase 2 trial universe from ClinicalTrials.gov and inspect what changed in the latest completed run."
      activeTab="update"
    >
      <AdminTrialSyncPanel
        initialConfig={{
          enabled: syncConfig.enabled,
          syncIntervalHours: syncConfig.syncIntervalHours,
          recentCompletionLookbackDays: syncConfig.recentCompletionLookbackDays,
          reconcileIntervalHours: syncConfig.reconcileIntervalHours,
          lastSuccessfulUpdatePostDate: syncConfig.lastSuccessfulUpdatePostDate ? syncConfig.lastSuccessfulUpdatePostDate.toISOString().slice(0, 10) : null,
          lastSuccessfulDataTimestamp: syncConfig.lastSuccessfulDataTimestamp,
          updatedAt: syncConfig.updatedAt.toISOString(),
        }}
        recentRuns={syncRuns.map((run) => ({
          id: run.id,
          triggerSource: run.triggerSource as 'cron' | 'manual',
          mode: run.mode as 'incremental' | 'reconcile',
          status: run.status as 'running' | 'completed' | 'failed' | 'skipped',
          sourceDataTimestamp: run.sourceDataTimestamp,
          studiesFetched: run.studiesFetched,
          studiesMatched: run.studiesMatched,
          trialsUpserted: run.trialsUpserted,
          questionsUpserted: run.questionsUpserted,
          marketsOpened: run.marketsOpened,
          errorSummary: run.errorSummary,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        }))}
        latestCompletedRunId={latestSyncChangeSet.run?.id ?? null}
        latestChangedItems={latestSyncChangeSet.items.map((item) => ({
          id: item.id,
          nctNumber: item.nctNumber,
          shortTitle: item.shortTitle,
          sponsorName: item.sponsorName,
          currentStatus: item.currentStatus,
          estPrimaryCompletionDate: item.estPrimaryCompletionDate.toISOString(),
          changeType: item.changeType as 'inserted' | 'updated',
          changeSummary: item.changeSummary,
          createdAt: item.createdAt.toISOString(),
          marketId: item.marketId,
        }))}
      />
    </AdminConsoleLayout>
  )
}
