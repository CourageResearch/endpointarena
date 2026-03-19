import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import {
  AdminOutcomeMonitorManager,
  type EventMonitorConfigDto,
  type EventMonitorRunDto,
  type OutcomeCandidateDto,
  type OverdueSoftEventDto,
} from '@/components/AdminOutcomeMonitorManager'
import { getEventMonitorConfig } from '@/lib/event-monitor-config'
import {
  listOverdueSoftEvents,
  listPendingOutcomeCandidates,
  listRecentEventMonitorRuns,
} from '@/lib/event-monitor'

export const dynamic = 'force-dynamic'

function toConfigDto(config: Awaited<ReturnType<typeof getEventMonitorConfig>>): EventMonitorConfigDto {
  return {
    enabled: config.enabled,
    runIntervalHours: config.runIntervalHours,
    hardLookaheadDays: config.hardLookaheadDays,
    softLookaheadDays: config.softLookaheadDays,
    overdueRecheckHours: config.overdueRecheckHours,
    maxEventsPerRun: config.maxEventsPerRun,
    verifierModelKey: config.verifierModelKey,
    minCandidateConfidence: config.minCandidateConfidence,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

function toCandidateDto(
  candidate: Awaited<ReturnType<typeof listPendingOutcomeCandidates>>[number],
): OutcomeCandidateDto {
  return {
    id: candidate.id,
    proposedOutcome: candidate.proposedOutcome as 'Approved' | 'Rejected',
    proposedOutcomeDate: candidate.proposedOutcomeDate ? candidate.proposedOutcomeDate.toISOString() : null,
    confidence: candidate.confidence,
    summary: candidate.summary,
    verifierModelKey: candidate.verifierModelKey,
    createdAt: candidate.createdAt.toISOString(),
    event: {
      id: candidate.event.id,
      companyName: candidate.event.companyName,
      drugName: candidate.event.drugName,
      applicationType: candidate.event.applicationType,
      decisionDate: candidate.event.decisionDate.toISOString().slice(0, 10),
      decisionDateKind: candidate.event.decisionDateKind as 'hard' | 'soft',
    },
    evidence: [...candidate.evidence]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((evidence) => ({
        id: evidence.id,
        sourceType: evidence.sourceType as 'fda' | 'sponsor' | 'stored_source' | 'web_search',
        title: evidence.title,
        url: evidence.url,
        publishedAt: evidence.publishedAt ? evidence.publishedAt.toISOString() : null,
        excerpt: evidence.excerpt,
        domain: evidence.domain,
      })),
  }
}

function toRunDto(run: Awaited<ReturnType<typeof listRecentEventMonitorRuns>>[number]): EventMonitorRunDto {
  return {
    id: run.id,
    triggerSource: run.triggerSource as 'cron' | 'manual',
    status: run.status as 'running' | 'completed' | 'failed',
    eventsScanned: run.eventsScanned,
    candidatesCreated: run.candidatesCreated,
    errorSummary: run.errorSummary,
    startedAt: run.startedAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  }
}

function toOverdueDto(event: Awaited<ReturnType<typeof listOverdueSoftEvents>>[number]): OverdueSoftEventDto {
  return {
    id: event.id,
    companyName: event.companyName,
    drugName: event.drugName,
    applicationType: event.applicationType,
    decisionDate: event.decisionDate.toISOString().slice(0, 10),
    decisionDateKind: event.decisionDateKind as 'hard' | 'soft',
    lastMonitoredAt: event.lastMonitoredAt ? event.lastMonitoredAt.toISOString() : null,
  }
}

export default async function AdminOutcomesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const [config, candidates, recentRuns, overdueSoftEvents] = await Promise.all([
    getEventMonitorConfig(),
    listPendingOutcomeCandidates(),
    listRecentEventMonitorRuns(),
    listOverdueSoftEvents(),
  ])

  return (
    <AdminConsoleLayout
      title="Outcome Review"
      description="Review GPT-5.2 outcome signals, tune monitoring cadence, and manage overdue expected dates."
      activeTab="outcomes"
    >
      <section className="mb-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Review Queue</h2>
        <p className="mt-1 text-sm text-[#8a8075]">
          The monitor proposes evidence-backed outcome candidates, but markets only settle after an admin accepts one.
        </p>
      </section>

      <AdminOutcomeMonitorManager
        initialConfig={toConfigDto(config)}
        initialCandidates={candidates.map(toCandidateDto)}
        recentRuns={recentRuns.map(toRunDto)}
        overdueSoftEvents={overdueSoftEvents.map(toOverdueDto)}
      />
    </AdminConsoleLayout>
  )
}
