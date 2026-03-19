import { asc } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminDrugMetadataManager } from '@/components/AdminDrugMetadataManager'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { db, fdaCalendarEvents } from '@/lib/db'
import { enrichFdaEvents } from '@/lib/fda-event-metadata'

export const dynamic = 'force-dynamic'

async function getData() {
  const rawEvents = await db.query.fdaCalendarEvents.findMany({
    orderBy: [asc(fdaCalendarEvents.decisionDate), asc(fdaCalendarEvents.drugName)],
  })
  const events = await enrichFdaEvents(rawEvents)

  const hasValue = (value: string | null) => Boolean(value?.trim())

  return {
    events,
    stats: {
      totalEvents: events.length,
      sourceFilled: events.filter((event) => hasValue(event.source)).length,
      nctFilled: events.filter((event) => hasValue(event.nctId)).length,
      missingEither: events.filter((event) => !hasValue(event.source) || !hasValue(event.nctId)).length,
    },
  }
}

export default async function AdminMetadataPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { events, stats } = await getData()

  return (
    <AdminConsoleLayout
      title="Drug Metadata"
      description="Edit metadata fields for all FDA calendar events."
      activeTab="metadata"
    >
      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a1a]">Metadata Coverage</h2>
            <p className="mt-1 text-sm text-[#8a8075]">Fill in source links and NCT identifiers across the full FDA event list.</p>
          </div>
          <p className="text-xs uppercase tracking-[0.12em] text-[#b5aa9e]">All drugs</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-none border border-[#e8ddd0] bg-white p-3">
            <p className="text-xl font-semibold text-[#1a1a1a]">{stats.totalEvents}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Total Drugs</p>
          </div>
          <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
            <p className="text-xl font-semibold text-[#3a8a2e]">{stats.sourceFilled}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Source Filled</p>
          </div>
          <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
            <p className="text-xl font-semibold text-[#5BA5ED]">{stats.nctFilled}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">NCT Filled</p>
          </div>
          <div className="rounded-none border border-[#EF6F67]/30 bg-[#EF6F67]/5 p-3">
            <p className="text-xl font-semibold text-[#EF6F67]">{stats.missingEither}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Missing Either</p>
          </div>
        </div>
      </section>

      <AdminDrugMetadataManager
        events={events.map((event) => ({
          id: event.id,
          drugName: event.drugName,
          companyName: event.companyName,
          symbols: event.symbols,
          applicationType: event.applicationType,
          decisionDate: event.decisionDate.toISOString().slice(0, 10),
          decisionDateKind: event.decisionDateKind as 'hard' | 'soft',
          outcome: event.outcome,
          source: event.source,
          nctId: event.nctId,
        }))}
      />
    </AdminConsoleLayout>
  )
}
