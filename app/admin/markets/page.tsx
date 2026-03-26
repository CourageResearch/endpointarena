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
      title="Drugs"
      description="Search tracked drugs, update outcomes, open missing markets, and remove entries you no longer want."
      activeTab="markets"
    >
      <AdminMarketManager
        events={events}
        sections={['search', 'openMarkets', 'needsMarket', 'resolvedMarkets']}
        labels={{
          searchPlaceholder: 'Search drug, sponsor, ticker, endpoint',
          openMarketsTitle: '',
          openMarketsDescription: '',
          openMarketsEmptyState: 'No live drugs match the current filter.',
          needsMarketTitle: 'Drugs Without Markets',
          needsMarketDescription: 'Pending Phase 2 results questions that still need a market opened.',
          resolvedMarketsTitle: 'Closed Drugs',
          resolvedMarketsDescription: 'Tracked drugs with resolved markets.',
          resolvedMarketsEmptyState: 'No closed drugs match the current filter.',
        }}
      />
    </AdminConsoleLayout>
  )
}
