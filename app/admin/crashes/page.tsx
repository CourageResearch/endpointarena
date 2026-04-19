import { revalidatePath } from 'next/cache'
import { and, eq, gte } from 'drizzle-orm'
import { ensureAdmin, redirectIfNotAdmin } from '@/lib/admin-auth'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { crashEvents, db } from '@/lib/db'
import { getRecentCrashEvents } from '@/lib/crash-events'
import {
  ADMIN_CRASH_DAY_FILTERS,
  buildPathWithSearchParams,
  firstSearchParam,
  type PageSearchParams,
  parseAdminDayFilter,
} from '@/lib/admin-search-params'

export const dynamic = 'force-dynamic'

async function deleteCrashEvent(formData: FormData) {
  'use server'

  await ensureAdmin()
  const rawId = formData.get('crashEventId')
  const crashEventId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!crashEventId) return

  await db.delete(crashEvents).where(eq(crashEvents.id, crashEventId))
  revalidatePath('/admin/crashes')
}

async function deleteCrashGroup(formData: FormData) {
  'use server'

  await ensureAdmin()
  const rawFingerprint = formData.get('fingerprint')
  const rawCreatedAfter = formData.get('createdAfterMs')
  const fingerprint = typeof rawFingerprint === 'string' ? rawFingerprint.trim() : ''
  const createdAfterMs = typeof rawCreatedAfter === 'string'
    ? Number.parseInt(rawCreatedAfter, 10)
    : Number.NaN

  if (!fingerprint || !Number.isFinite(createdAfterMs) || createdAfterMs <= 0) {
    return
  }

  await db.delete(crashEvents).where(and(
    eq(crashEvents.fingerprint, fingerprint),
    gte(crashEvents.createdAt, new Date(createdAfterMs)),
  ))
  revalidatePath('/admin/crashes')
}

function normalizeSearch(value: string): string {
  return value.trim().slice(0, 120)
}

function truncate(value: string | null | undefined, maxLength: number): string {
  if (!value) return '—'
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`
}

function topStackFrame(stack: string | null | undefined): string {
  if (!stack) return '—'
  const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return '—'
  return lines[1] || lines[0]
}

type CrashGroup = {
  fingerprint: string
  digest: string | null
  message: string
  path: string | null
  source: string
  errorCode: string | null
  statusCode: number | null
  requestId: string | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  count: number
  topFrame: string
  sampleStack: string | null
  sampleComponentStack: string | null
  sampleUserEmail: string | null
  sampleUserId: string | null
  sampleIpAddress: string | null
  sampleCountry: string | null
  sampleCity: string | null
  sampleUrl: string | null
}

function buildCrashGroups(rows: Awaited<ReturnType<typeof getRecentCrashEvents>>): CrashGroup[] {
  const groups = new Map<string, CrashGroup>()

  for (const row of rows) {
    const existing = groups.get(row.fingerprint)
    const createdAt = row.createdAt ?? null
    if (!existing) {
      groups.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        digest: row.digest ?? null,
        message: row.message,
        path: row.path ?? null,
        source: row.source,
        errorCode: row.errorCode ?? null,
        statusCode: row.statusCode ?? null,
        requestId: row.requestId ?? null,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        count: 1,
        topFrame: topStackFrame(row.stack),
        sampleStack: row.stack ?? null,
        sampleComponentStack: row.componentStack ?? null,
        sampleUserEmail: row.userEmail ?? null,
        sampleUserId: row.userId ?? null,
        sampleIpAddress: row.ipAddress ?? null,
        sampleCountry: row.country ?? null,
        sampleCity: row.city ?? null,
        sampleUrl: row.url ?? null,
      })
      continue
    }

    existing.count += 1
    if (createdAt && (!existing.firstSeenAt || createdAt.getTime() < existing.firstSeenAt.getTime())) {
      existing.firstSeenAt = createdAt
    }
    if (createdAt && (!existing.lastSeenAt || createdAt.getTime() > existing.lastSeenAt.getTime())) {
      existing.lastSeenAt = createdAt
      existing.digest = row.digest ?? existing.digest
      existing.message = row.message
      existing.path = row.path ?? existing.path
      existing.source = row.source
      existing.errorCode = row.errorCode ?? existing.errorCode
      existing.statusCode = row.statusCode ?? existing.statusCode
      existing.requestId = row.requestId ?? existing.requestId
      existing.topFrame = topStackFrame(row.stack)
      existing.sampleStack = row.stack ?? existing.sampleStack
      existing.sampleComponentStack = row.componentStack ?? existing.sampleComponentStack
      existing.sampleUserEmail = row.userEmail ?? existing.sampleUserEmail
      existing.sampleUserId = row.userId ?? existing.sampleUserId
      existing.sampleIpAddress = row.ipAddress ?? existing.sampleIpAddress
      existing.sampleCountry = row.country ?? existing.sampleCountry
      existing.sampleCity = row.city ?? existing.sampleCity
      existing.sampleUrl = row.url ?? existing.sampleUrl
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const lastA = a.lastSeenAt?.getTime() ?? 0
    const lastB = b.lastSeenAt?.getTime() ?? 0
    if (lastA !== lastB) return lastB - lastA
    return b.count - a.count
  })
}

export default async function AdminCrashesPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  await redirectIfNotAdmin('/admin/crashes')
  const resolvedSearchParams = (await searchParams) ?? {}
  const days = parseAdminDayFilter(resolvedSearchParams.days, ADMIN_CRASH_DAY_FILTERS, 7)
  const query = normalizeSearch(firstSearchParam(resolvedSearchParams.q))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const rows = await getRecentCrashEvents({
    since,
    limit: 1000,
    search: query || undefined,
  })
  const groups = buildCrashGroups(rows)

  const now = new Date()
  const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const eventsLast24h = rows.filter((row) => row.createdAt && row.createdAt >= last24hStart).length
  const digests = new Set(rows.map((row) => row.digest).filter((digest): digest is string => Boolean(digest)))

  return (
    <AdminConsoleLayout
      title="Crashes"
      activeTab="crashes"
      days={days}
    >
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-none border border-[#EF6F67]/35 bg-[#EF6F67]/10 p-3">
          <p className="text-xl font-semibold text-[#b94e47]">{rows.length}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#b94e47]/80">Occurrences ({days}d)</p>
        </div>
        <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/10 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{groups.length}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#5BA5ED]/80">Unique Crash Groups</p>
        </div>
        <div className="rounded-none border border-[#D39D2E]/35 bg-[#D39D2E]/10 p-3">
          <p className="text-xl font-semibold text-[#9a6f11]">{eventsLast24h}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#9a6f11]/80">Last 24 Hours</p>
        </div>
        <div className="rounded-none border border-[#5DBB63]/35 bg-[#5DBB63]/10 p-3">
          <p className="text-xl font-semibold text-[#3f8a47]">{digests.size}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#3f8a47]/80">Distinct Digests</p>
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <form action="/admin/crashes" method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div className="flex items-center gap-2 rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#b5aa9e]">Search</span>
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Digest, route, message, request ID, email"
              className="w-full border-0 bg-transparent text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="days" value={String(days)} />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-none border border-[#d9cdbf] bg-white px-3 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
            >
              Apply
            </button>
            <a
              href="/admin/crashes"
              className="inline-flex h-9 items-center rounded-none border border-[#e8ddd0] bg-[#f7f2eb] px-3 text-sm text-[#8a8075] transition-colors hover:text-[#1a1a1a]"
            >
              Reset
            </a>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {ADMIN_CRASH_DAY_FILTERS.map((option) => {
            const active = days === option.value
            return (
              <a
                key={option.value}
                href={buildPathWithSearchParams('/admin/crashes', {
                  days: option.value,
                  q: query || undefined,
                })}
                className={`rounded-none border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                    : 'border-[#e8ddd0] bg-white text-[#8a8075] hover:text-[#1a1a1a]'
                }`}
              >
                {option.label}
              </a>
            )
          })}
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Crash Groups</h2>
          <p className="text-xs text-[#8a8075]">Grouped by digest + route + message + stack frame fingerprint</p>
        </div>

        {groups.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No crash events found for this range.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-[13px]">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Last Seen</th>
                  <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Count</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Digest</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Route</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Error</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Top Frame</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Request ID</th>
                  <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.fingerprint} className="border-b border-[#e8ddd0] align-top hover:bg-[#f3ebe0]/25">
                    <td className="px-2 py-2 text-[#8a8075] whitespace-nowrap">
                      <LocalDateTime value={group.lastSeenAt ? group.lastSeenAt.toISOString() : null} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#1a1a1a]">{group.count.toLocaleString()}</td>
                    <td className="px-2 py-2 text-[#1a1a1a] font-mono text-xs">{truncate(group.digest, 14)}</td>
                    <td className="px-2 py-2 text-[#8a8075] font-mono text-xs">{truncate(group.path, 36)}</td>
                    <td className="px-2 py-2 text-[#1a1a1a]">
                      <p className="font-medium">{truncate(group.message, 96)}</p>
                      <p className="mt-1 text-xs text-[#8a8075]">
                        {group.errorCode || '—'}
                        {group.statusCode != null ? ` • ${group.statusCode}` : ''}
                        {group.source ? ` • ${group.source}` : ''}
                      </p>
                    </td>
                    <td className="px-2 py-2 text-[#8a8075] font-mono text-xs">{truncate(group.topFrame, 68)}</td>
                    <td className="px-2 py-2 text-[#8a8075] font-mono text-xs">{truncate(group.requestId, 18)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <form action={deleteCrashGroup} className="inline">
                        <input type="hidden" name="fingerprint" value={group.fingerprint} />
                        <input type="hidden" name="createdAfterMs" value={String(since.getTime())} />
                        <button
                          type="submit"
                          className="inline-flex h-7 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-2 text-[11px] font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
                        >
                          Delete Group
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Recent Crash Events</h2>
          <p className="text-xs text-[#8a8075]">Latest 100 events with debugging context</p>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-[#8a8075]">No recent events.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {rows.slice(0, 100).map((row) => (
              <details key={row.id} className="rounded-none border border-[#e8ddd0] bg-white p-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[#1a1a1a]">{truncate(row.message, 120)}</p>
                    <LocalDateTime
                      value={row.createdAt ? row.createdAt.toISOString() : null}
                      className="text-xs text-[#8a8075]"
                    />
                  </div>
                  <p className="mt-1 text-xs text-[#8a8075] font-mono">
                    {truncate(row.path, 80)} • digest {truncate(row.digest, 16)} • req {truncate(row.requestId, 20)}
                  </p>
                </summary>

                <div className="mt-3 flex justify-end">
                  <form action={deleteCrashEvent}>
                    <input type="hidden" name="crashEventId" value={row.id} />
                    <button
                      type="submit"
                      className="inline-flex h-8 items-center justify-center rounded-none border border-[#e8ddd0] bg-white px-2.5 text-xs font-medium text-[#8a8075] transition-colors hover:border-[#c24f45]/30 hover:bg-[#c24f45]/5 hover:text-[#c24f45]"
                    >
                      Delete Event
                    </button>
                  </form>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-[#6d645a] sm:grid-cols-2">
                  <p><span className="font-medium text-[#1a1a1a]">Fingerprint:</span> <span className="font-mono">{row.fingerprint}</span></p>
                  <p><span className="font-medium text-[#1a1a1a]">Source:</span> {row.source}</p>
                  <p><span className="font-medium text-[#1a1a1a]">Error code:</span> {row.errorCode || '—'}</p>
                  <p><span className="font-medium text-[#1a1a1a]">Status:</span> {row.statusCode ?? '—'}</p>
                  <p><span className="font-medium text-[#1a1a1a]">User:</span> {row.userEmail || row.userId || 'anonymous'}</p>
                  <p><span className="font-medium text-[#1a1a1a]">Location/IP:</span> {row.city || row.country ? `${row.city || '—'}, ${row.country || '—'}` : '—'}{row.ipAddress ? ` • ${row.ipAddress}` : ''}</p>
                  <p className="sm:col-span-2"><span className="font-medium text-[#1a1a1a]">URL:</span> <span className="font-mono">{row.url || '—'}</span></p>
                  <p className="sm:col-span-2"><span className="font-medium text-[#1a1a1a]">User-Agent:</span> <span className="font-mono">{row.userAgent || '—'}</span></p>
                </div>

                {row.stack ? (
                  <div className="mt-3">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Stack</p>
                    <pre className="mt-1 max-h-44 overflow-auto rounded-none bg-[#f8f3ec] p-2 text-[11px] text-[#4d453c] whitespace-pre-wrap break-all">{row.stack}</pre>
                  </div>
                ) : null}

                {row.componentStack ? (
                  <div className="mt-3">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Component Stack</p>
                    <pre className="mt-1 max-h-44 overflow-auto rounded-none bg-[#f8f3ec] p-2 text-[11px] text-[#4d453c] whitespace-pre-wrap break-all">{row.componentStack}</pre>
                  </div>
                ) : null}

                {row.details ? (
                  <div className="mt-3">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">Details</p>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-none bg-[#f8f3ec] p-2 text-[11px] text-[#4d453c] whitespace-pre-wrap break-all">{row.details}</pre>
                  </div>
                ) : null}
              </details>
            ))}
          </div>
        )}
      </section>
    </AdminConsoleLayout>
  )
}
