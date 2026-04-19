import { redirect } from 'next/navigation'
import { redirectIfNotAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  await redirectIfNotAdmin('/admin')
  redirect('/admin/trials')
}
