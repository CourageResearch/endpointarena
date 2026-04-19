import { revalidatePath } from 'next/cache'
import { desc, eq, like, sql } from 'drizzle-orm'
import { ensureAdmin, redirectIfNotAdmin } from '@/lib/admin-auth'
import { db, contactMessages } from '@/lib/db'
import {
  getClinicalTrialsGovStudyUrl,
  MARKET_SUGGESTION_MESSAGE_PREFIX,
  parseMarketSuggestionMessage,
} from '@/lib/market-suggestions'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { LocalDateTime } from '@/components/ui/local-date-time'

export const dynamic = 'force-dynamic'

async function deleteSuggestionItem(formData: FormData) {
  'use server'

  await ensureAdmin()
  const rawId = formData.get('messageId')
  const messageId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!messageId) return

  await db.delete(contactMessages).where(eq(contactMessages.id, messageId))
  revalidatePath('/admin/suggestions')
  revalidatePath('/admin/contact')
}

async function getSuggestionsData() {
  const [messages, totalRows] = await Promise.all([
    db.query.contactMessages.findMany({
      where: like(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`),
      orderBy: [desc(contactMessages.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(contactMessages)
      .where(like(contactMessages.message, `${MARKET_SUGGESTION_MESSAGE_PREFIX}%`)),
  ])

  const suggestions = messages.map((message) => ({
    ...message,
    parsed: parseMarketSuggestionMessage(message.message),
  }))
  const uniqueNctCount = new Set(
    suggestions
      .map((suggestion) => suggestion.parsed?.nctNumber)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  ).size
  const withContextCount = suggestions.filter((suggestion) => Boolean(suggestion.parsed?.details)).length

  return {
    suggestions,
    total: totalRows[0]?.count ?? 0,
    uniqueNctCount,
    withContextCount,
  }
}

export default async function AdminSuggestionsPage() {
  await redirectIfNotAdmin('/admin/suggestions')
  const { suggestions } = await getSuggestionsData()

  return (
    <AdminConsoleLayout
      title="Suggestions"
      activeTab="suggestions"
    >
      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Market Suggestion Queue</h2>
          <p className="text-xs text-[#8a8075]">Newest first</p>
        </div>

        {suggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No market suggestions yet.</p>
        ) : (
          <div className="mt-4">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="w-[19%] px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Received</th>
                  <th className="w-[7%] px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">NCT</th>
                  <th className="w-[14%] px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Name</th>
                  <th className="w-[20%] px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Email</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Notes</th>
                  <th className="w-[10%] px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((suggestion) => {
                  const nctNumber = suggestion.parsed?.nctNumber
                  const notes = suggestion.parsed?.details
                  const displayName = suggestion.name.trim() || 'Anonymous'
                  const displayEmail = suggestion.email.trim()

                  return (
                    <tr key={suggestion.id} className="border-b border-[#e8ddd0] align-top hover:bg-[#f3ebe0]/30">
                      <td className="px-3 py-2 text-[#8a8075]">
                        <LocalDateTime value={suggestion.createdAt ? suggestion.createdAt.toISOString() : null} emptyLabel="Unknown" />
                      </td>
                      <td className="px-3 py-2">
                        {nctNumber ? (
                          <a
                            href={getClinicalTrialsGovStudyUrl(nctNumber)}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-[#1a1a1a] underline decoration-[#d8ccb9] underline-offset-2 hover:text-[#5BA5ED]"
                          >
                            {nctNumber}
                          </a>
                        ) : (
                          <p className="max-w-[180px] break-words text-[#8a8075]">{suggestion.parsed?.rawMessage ?? suggestion.message}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 break-words text-[#1a1a1a]">{displayName}</td>
                      <td className="px-3 py-2 break-all">
                        {displayEmail ? (
                          <a
                            href={`mailto:${displayEmail}`}
                            className="text-[#8a8075] underline decoration-[#d8ccb9] underline-offset-2 hover:text-[#1a1a1a]"
                          >
                            {displayEmail}
                          </a>
                        ) : (
                          <span className="text-[#8a8075]">No email provided</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#1a1a1a]">
                        {notes ? (
                          <p className="whitespace-pre-wrap break-words">{notes}</p>
                        ) : (
                          <p className="text-[#8a8075]">No additional context provided.</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <form action={deleteSuggestionItem} className="inline">
                            <input type="hidden" name="messageId" value={suggestion.id} />
                            <button
                              type="submit"
                              className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
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
