import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminAiDesk } from '@/components/admin-ai/AdminAiDesk'
import { deriveAiBatchProgress } from '@/lib/admin-ai-shared'
import { redirectIfNotAdmin } from '@/lib/admin-auth'
import { getAiDeskState } from '@/lib/admin-ai'
import { getAiDatasetForActiveDatabase } from '@/lib/admin-ai-active-dataset'
import { getActiveDatabaseTarget } from '@/lib/database-target'

export const dynamic = 'force-dynamic'

export default async function AdminAiPage() {
  await redirectIfNotAdmin('/admin/ai')
  const activeDatabaseTarget = getActiveDatabaseTarget()

  const initialState = await getAiDeskState(getAiDatasetForActiveDatabase())
  const initialProgress = deriveAiBatchProgress(initialState.batch)

  return (
    <AdminConsoleLayout title="AI" activeTab="ai">
      <AdminAiDesk
        initialState={initialState}
        initialProgress={initialProgress}
        activeDatabaseTarget={activeDatabaseTarget}
      />
    </AdminConsoleLayout>
  )
}
