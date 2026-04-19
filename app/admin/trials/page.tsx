import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminManualTrialIntake } from '@/components/AdminManualTrialIntake'
import { redirectIfNotAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default async function AdminTrialsPage() {
  await redirectIfNotAdmin('/admin/trials')

  return (
    <AdminConsoleLayout title="Trials" activeTab="trials">
      <AdminManualTrialIntake />
    </AdminConsoleLayout>
  )
}
