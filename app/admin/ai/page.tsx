import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminAiDesk } from '@/components/admin-ai/AdminAiDesk'
import { getAiDeskState } from '@/lib/admin-ai'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { getActiveDatabaseTarget } from '@/lib/database-target'
import { isLocalDevBypassEmail } from '@/lib/local-dev-bypass'

export const dynamic = 'force-dynamic'

function getDefaultAiDatasetForCurrentDatabase(): 'toy' | 'live' {
  return getActiveDatabaseTarget() === 'toy' ? 'toy' : 'live'
}

export default async function AdminAiPage() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null

  if (!email || (email !== ADMIN_EMAIL && !isLocalDevBypassEmail(email))) {
    redirect('/login')
  }

  const initialState = await getAiDeskState(getDefaultAiDatasetForCurrentDatabase())

  return (
    <AdminConsoleLayout title="AI" activeTab="ai">
      <AdminAiDesk initialState={initialState} />
    </AdminConsoleLayout>
  )
}
