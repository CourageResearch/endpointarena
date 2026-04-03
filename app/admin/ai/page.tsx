import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminTrialManager } from '@/components/AdminTrialManager'
import { getTrialAdminData, getTrialAdminStats } from '@/lib/admin-trial-data'
import { getLatestTrialRunSnapshot, listRecentResumableTrialRunDates } from '@/lib/trial-run-logs'

export const dynamic = 'force-dynamic'

export default async function AdminAiPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const [events, initialRunSnapshot, initialResumableRunDates] = await Promise.all([
    getTrialAdminData(),
    getLatestTrialRunSnapshot(),
    listRecentResumableTrialRunDates(),
  ])
  const {
    openMarkets,
    pendingWithoutMarket,
    liveQuestions,
    liveQuestionsWithMarket,
  } = getTrialAdminStats(events)

  return (
    <AdminConsoleLayout
      title="AI"
      description="Run the daily AI cycle and monitor question coverage."
      activeTab="ai"
    >
      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
          <p className="text-xl font-semibold text-[#3a8a2e]">{openMarkets}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Queued For AI Run</p>
        </div>
        <div className="rounded-none border border-[#EF6F67]/30 bg-[#EF6F67]/5 p-3">
          <p className="text-xl font-semibold text-[#EF6F67]">{pendingWithoutMarket}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Coverage Gaps</p>
        </div>
        <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">
            {liveQuestionsWithMarket}/{liveQuestions}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Live Questions Covered</p>
        </div>
      </section>

      <AdminTrialManager
        events={events}
        initialRunSnapshot={initialRunSnapshot}
        initialResumableRunDates={initialResumableRunDates}
        sections={['dailyCycle']}
      />
    </AdminConsoleLayout>
  )
}
