import { revalidatePath } from 'next/cache'
import { desc, eq, gte, sql } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions, ensureAdmin } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { db, waitlistEntries } from '@/lib/db'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'

export const dynamic = 'force-dynamic'

async function deleteWaitlistEntry(formData: FormData) {
  'use server'

  await ensureAdmin()
  const rawId = formData.get('entryId')
  const entryId = typeof rawId === 'string' ? rawId.trim() : ''

  if (!entryId) {
    return
  }

  await db.delete(waitlistEntries).where(eq(waitlistEntries.id, entryId))
  revalidatePath('/admin/waitlist')
}

async function getWaitlistData() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [entries, totalRows, newRows] = await Promise.all([
    db.query.waitlistEntries.findMany({
      orderBy: [desc(waitlistEntries.createdAt)],
    }),
    db.select({ count: sql<number>`count(*)` }).from(waitlistEntries),
    db
      .select({ count: sql<number>`count(*)` })
      .from(waitlistEntries)
      .where(gte(waitlistEntries.createdAt, since)),
  ])

  return {
    entries,
    total: totalRows[0]?.count ?? 0,
    newLast7d: newRows[0]?.count ?? 0,
  }
}

export default async function AdminWaitlistPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { entries, total, newLast7d } = await getWaitlistData()

  return (
    <AdminConsoleLayout
      title="Waitlist"
      description="Track signups, monitor recent growth, and reach out to members."
      activeTab="waitlist"
      topActions={(
        <a
          href="/waitlist"
          className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
        >
          Public Waitlist
        </a>
      )}
    >
      <section className="mb-6 grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="rounded-lg border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{newLast7d}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">New (7d)</p>
        </div>
        <div className="rounded-lg border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
          <p className="text-xl font-semibold text-[#3a8a2e]">{total}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Total</p>
        </div>
      </section>

      <section className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Waitlist Signups</h2>
          <p className="text-xs text-[#8a8075]">Newest first</p>
        </div>

        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No waitlist signups yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Joined</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Email</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const joinedAt = entry.createdAt
                    ? entry.createdAt.toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                    : 'Unknown'

                  return (
                    <tr key={entry.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                      <td className="px-3 py-2 text-[#8a8075]">{joinedAt}</td>
                      <td className="px-3 py-2 text-[#1a1a1a]">{entry.name || '—'}</td>
                      <td className="px-3 py-2">
                        <a
                          href={`mailto:${entry.email}`}
                          className="text-[#8a8075] hover:text-[#1a1a1a] underline decoration-[#d8ccb9] underline-offset-2"
                        >
                          {entry.email}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={deleteWaitlistEntry} className="inline">
                          <input type="hidden" name="entryId" value={entry.id} />
                          <button
                            type="submit"
                            className="inline-flex h-8 items-center justify-center rounded-md border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminConsoleLayout>
  )
}
