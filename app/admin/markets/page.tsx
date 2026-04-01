import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminMarketManager } from '@/components/AdminMarketManager'
import { getMarketAdminData } from '@/lib/admin-market-data'

export const dynamic = 'force-dynamic'

export default async function AdminMarketsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const events = await getMarketAdminData()

  return (
    <AdminConsoleLayout
      title="Markets"
      description="Search tracked trial markets, update outcomes, open missing markets, and remove entries you no longer want."
      activeTab="markets"
    >
      <AdminMarketManager
        events={events}
        sections={['search', 'openMarkets', 'needsMarket', 'resolvedMarkets']}
        labels={{
          searchPlaceholder: 'Search trial, sponsor, ticker, endpoint',
          openMarketsTitle: '',
          openMarketsDescription: '',
          openMarketsEmptyState: 'No live trial markets match the current filter.',
          needsMarketTitle: 'Trials Without Markets',
          needsMarketDescription: 'Pending Phase 2 result questions that still need a market opened.',
          resolvedMarketsTitle: 'Closed Markets',
          resolvedMarketsDescription: 'Tracked trial markets with resolved outcomes.',
          resolvedMarketsEmptyState: 'No closed markets match the current filter.',
        }}
      />
    </AdminConsoleLayout>
  )
}
