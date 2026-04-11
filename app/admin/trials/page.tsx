import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminManualTrialIntake } from '@/components/AdminManualTrialIntake'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { isLocalDevBypassEmail } from '@/lib/local-dev-bypass'

export const dynamic = 'force-dynamic'

export default async function AdminTrialsPage() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null

  if (!email || (email !== ADMIN_EMAIL && !isLocalDevBypassEmail(email))) {
    redirect('/login')
  }

  return (
    <AdminConsoleLayout title="Trial Intake" activeTab="trials">
      <AdminManualTrialIntake />
    </AdminConsoleLayout>
  )
}
