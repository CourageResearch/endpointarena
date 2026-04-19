import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { Season4BaseDesk } from '@/components/admin/Season4BaseDesk'
import { redirectIfNotAdmin } from '@/lib/admin-auth'
import { getSeason4OpsDashboardData } from '@/lib/season4-ops'

export const dynamic = 'force-dynamic'

export default async function AdminBasePage() {
  await redirectIfNotAdmin('/admin/base')
  const dashboard = await getSeason4OpsDashboardData()

  return (
    <AdminConsoleLayout title="Base Ops" activeTab="base">
      <Season4BaseDesk initialData={dashboard} />
    </AdminConsoleLayout>
  )
}
