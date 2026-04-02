import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminTrialManager } from '@/components/AdminTrialManager'
import { getTrialAdminData } from '@/lib/admin-trial-data'

export const dynamic = 'force-dynamic'

export default async function AdminTrialsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const events = await getTrialAdminData()

  return (
    <AdminConsoleLayout
      title="Trials"
      description="Search tracked trial questions, update outcomes, open missing trials for trading, and remove entries you no longer want."
      activeTab="trials"
    >
      <AdminTrialManager
        events={events}
        sections={['search', 'openMarkets', 'needsMarket', 'resolvedMarkets']}
        labels={{
          searchPlaceholder: 'Search trial, sponsor, ticker, endpoint',
          openMarketsTitle: '',
          openMarketsDescription: '',
          openMarketsEmptyState: 'No open trials match the current filter.',
          needsMarketTitle: 'Trials Not Yet Open',
          needsMarketDescription: 'Pending Phase 2 result questions that still need to be opened for trading.',
          resolvedMarketsTitle: 'Resolved Trials',
          resolvedMarketsDescription: 'Tracked trials with resolved outcomes.',
          resolvedMarketsEmptyState: 'No resolved trials match the current filter.',
        }}
      />
    </AdminConsoleLayout>
  )
}
