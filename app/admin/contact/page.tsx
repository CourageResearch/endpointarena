import { revalidatePath } from 'next/cache'
import { desc, eq, notLike, sql } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions, ensureAdmin } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { db, contactMessages } from '@/lib/db'
import { MARKET_SUGGESTION_MESSAGE_PREFIX } from '@/lib/market-suggestions'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { LocalDateTime } from '@/components/ui/local-date-time'

export const dynamic = 'force-dynamic'

async function deleteContactMessage(formData: FormData) {
  'use server'

  await ensureAdmin()
  const rawId = formData.get('messageId')
  const messageId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!messageId) return

  await db.delete(contactMessages).where(eq(contactMessages.id, messageId))
  revalidatePath('/admin/contact')
  revalidatePath('/admin/review')
}

async function getContactData() {
  const [messages, totalRows] = await Promise.all([
    db.query.contactMessages.findMany({
      where: notLike(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`),
      orderBy: [desc(contactMessages.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(contactMessages)
      .where(notLike(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`)),
  ])

  return {
    messages,
    total: totalRows[0]?.count ?? 0,
  }
}

export default async function AdminContactPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { messages, total } = await getContactData()

  return (
    <AdminConsoleLayout
      title="Contact"
      activeTab="contact"
    >
      <section className="mb-6 grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{total}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Total Messages</p>
        </div>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Inbox</h2>
          <p className="text-xs text-[#8a8075]">Newest first</p>
        </div>

        {messages.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No contact messages yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Received</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Email</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Message</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => {
                  return (
                    <tr key={message.id} className="border-b border-[#e8ddd0] align-top hover:bg-[#f3ebe0]/30">
                      <td className="px-3 py-2 text-[#8a8075] whitespace-nowrap">
                        <LocalDateTime value={message.createdAt ? message.createdAt.toISOString() : null} emptyLabel="Unknown" />
                      </td>
                      <td className="px-3 py-2 text-[#1a1a1a] whitespace-nowrap">{message.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <a
                          href={`mailto:${message.email}`}
                          className="text-[#8a8075] hover:text-[#1a1a1a] underline decoration-[#d8ccb9] underline-offset-2"
                        >
                          {message.email}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-[#1a1a1a]">
                        <p className="max-w-[520px] whitespace-pre-wrap break-words">{message.message}</p>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={deleteContactMessage} className="inline">
                          <input type="hidden" name="messageId" value={message.id} />
                          <button
                            type="submit"
                            className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
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
