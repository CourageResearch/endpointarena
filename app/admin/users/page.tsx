import { revalidatePath } from 'next/cache'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions, ensureAdmin } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { accounts, db, users } from '@/lib/db'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { formatStoredCountry } from '@/lib/geo-country'

export const dynamic = 'force-dynamic'

async function deleteUser(formData: FormData) {
  'use server'

  await ensureAdmin()

  const session = await getServerSession(authOptions)
  const currentAdminEmail = session?.user?.email?.trim().toLowerCase() ?? null
  const rawId = formData.get('userId')
  const userId = typeof rawId === 'string' ? rawId.trim() : ''

  if (!userId) return

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })

  if (!user) return

  const targetEmail = user.email?.trim().toLowerCase() ?? null

  // Prevent removing the current session owner or the configured admin account.
  if ((currentAdminEmail && targetEmail === currentAdminEmail) || targetEmail === ADMIN_EMAIL.toLowerCase()) {
    return
  }

  await db.delete(users).where(eq(users.id, userId))
  revalidatePath('/admin/users')
}

async function getUsersData() {
  const [userRows, totalRows] = await Promise.all([
    db.query.users.findMany({
      orderBy: [desc(users.createdAt)],
    }),
    db.select({ count: sql<number>`count(*)` }).from(users),
  ])

  return {
    users: userRows,
    total: totalRows[0]?.count ?? 0,
  }
}

async function fetchTwitterUsername(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.twitter.com/2/users/me?user.fields=username', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) return null

    const payload = await response.json() as {
      data?: { username?: string }
    }
    const username = payload?.data?.username
    if (typeof username !== 'string') return null
    const trimmed = username.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function backfillMissingXUsernames(userRows: Array<typeof users.$inferSelect>) {
  const userIds = userRows.map((user) => user.id)
  if (userIds.length === 0) return

  const twitterAccounts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.provider, 'twitter'),
      inArray(accounts.userId, userIds),
    ),
  })
  const accountByUserId = new Map(twitterAccounts.map((account) => [account.userId, account]))

  const candidates = userRows
    .filter((user) => {
      const hasStoredUsername = Boolean(user.xUsername?.trim())
      const connected = Boolean(user.xUserId || accountByUserId.get(user.id)?.providerAccountId)
      const hasAccessToken = Boolean(accountByUserId.get(user.id)?.access_token)
      return connected && !hasStoredUsername && hasAccessToken
    })
    .slice(0, 10)

  await Promise.all(candidates.map(async (user) => {
    const account = accountByUserId.get(user.id)
    const accessToken = account?.access_token?.trim()
    if (!accessToken) return

    const username = await fetchTwitterUsername(accessToken)
    if (!username) return

    await db.update(users)
      .set({ xUsername: username })
      .where(eq(users.id, user.id))

    user.xUsername = username
  }))
}

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { users: userRows, total } = await getUsersData()
  await backfillMissingXUsernames(userRows)
  const currentAdminEmail = session.user.email.trim().toLowerCase()
  const protectedAdminEmail = ADMIN_EMAIL.toLowerCase()

  return (
    <AdminConsoleLayout
      title="Users"
      description="View registered users and remove accounts when needed."
      activeTab="users"
    >
      <section className="mb-6 grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="rounded-lg border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{total}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Total Users</p>
        </div>
      </section>

      <section className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Registered Users</h2>
          <p className="text-xs text-[#8a8075]">Newest first</p>
        </div>

        {userRows.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No users found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Created</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Email</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Country</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">X Account</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((user) => {
                  const createdAt = user.createdAt
                    ? user.createdAt.toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                    : 'Unknown'

                  const email = user.email ?? '—'
                  const country = formatStoredCountry(user.signupLocation)
                  const xLabel = user.xUsername ? `@${user.xUsername}` : (user.xUserId ? 'Connected' : 'Not connected')
                  const emailLower = user.email?.trim().toLowerCase() ?? null
                  const isProtectedUser = emailLower === currentAdminEmail || emailLower === protectedAdminEmail

                  return (
                    <tr key={user.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                      <td className="px-3 py-2 text-[#8a8075]">{createdAt}</td>
                      <td className="px-3 py-2 text-[#1a1a1a]">{user.name || '—'}</td>
                      <td className="px-3 py-2 text-[#1a1a1a]">{email}</td>
                      <td className="px-3 py-2 text-[#8a8075]">{country}</td>
                      <td className="px-3 py-2 text-[#8a8075]">{xLabel}</td>
                      <td className="px-3 py-2 text-right">
                        {isProtectedUser ? (
                          <span className="inline-flex h-8 items-center justify-center rounded-md border border-[#e8ddd0] bg-[#f7f2eb] px-2.5 text-xs font-medium text-[#b5aa9e]">
                            Protected
                          </span>
                        ) : (
                          <form action={deleteUser} className="inline">
                            <input type="hidden" name="userId" value={user.id} />
                            <button
                              type="submit"
                              className="inline-flex h-8 items-center justify-center rounded-md border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
                            >
                              Delete
                            </button>
                          </form>
                        )}
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
