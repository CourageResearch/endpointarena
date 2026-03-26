import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminTrialOutcomeReview } from '@/components/AdminTrialOutcomeReview'
import { getTrialMonitorConfig } from '@/lib/trial-monitor-config'
import { listEligibleTrialOutcomeQuestions, listPendingTrialOutcomeCandidates, listRecentTrialMonitorRuns } from '@/lib/trial-monitor'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import {
  getTrialMonitorVerifierLabel,
  getTrialMonitorVerifierOptions,
  normalizeTrialMonitorVerifierModelKey,
} from '@/lib/trial-monitor-verifier-models'

export const dynamic = 'force-dynamic'

function extractVerifierModelLabelFromRunDebugLog(debugLog: string | null | undefined): string {
  if (typeof debugLog !== 'string' || debugLog.trim().length === 0) {
    return 'Unknown model'
  }

  const labelMatch = debugLog.match(/"verifierModelLabel":\s*"([^"]+)"/)
  if (labelMatch?.[1]) {
    return labelMatch[1]
  }

  const keyMatch = debugLog.match(/"verifierModelKey":\s*"([^"]+)"/)
  if (keyMatch?.[1]) {
    return getTrialMonitorVerifierLabel(keyMatch[1])
  }

  return 'Unknown model'
}

export default async function AdminOutcomesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const [config, candidates, recentRuns, eligibleQuestions] = await Promise.all([
    getTrialMonitorConfig(),
    listPendingTrialOutcomeCandidates(),
    listRecentTrialMonitorRuns(),
    listEligibleTrialOutcomeQuestions(),
  ])
  const normalizedVerifierModelKey = normalizeTrialMonitorVerifierModelKey(config.verifierModelKey) ?? 'gpt-5.4'
  const verifierModelOptions = getTrialMonitorVerifierOptions({
    includeUnavailableSelectedKey: config.verifierModelKey,
  }).map((option) => ({
    value: option.value,
    label: option.label,
  }))

  return (
    <AdminConsoleLayout
      title="Outcome Review"
      description="Review evidence-backed Phase 2 outcome queue items and resolve markets after checking the source material."
      activeTab="outcomes"
    >
      <AdminTrialOutcomeReview
        initialConfig={{
          enabled: config.enabled,
          runIntervalHours: config.runIntervalHours,
          lookaheadDays: config.lookaheadDays,
          overdueRecheckHours: config.overdueRecheckHours,
          maxQuestionsPerRun: config.maxQuestionsPerRun,
          verifierModelKey: normalizedVerifierModelKey,
          minCandidateConfidence: config.minCandidateConfidence,
          updatedAt: config.updatedAt.toISOString(),
        }}
        verifierModelOptions={verifierModelOptions}
        initialCandidates={candidates.map((candidate) => ({
          id: candidate.id,
          marketId: candidate.question.markets[0]?.id ?? null,
          proposedOutcome: candidate.proposedOutcome as 'YES' | 'NO' | 'NO_DECISION',
          confidence: candidate.confidence,
          verifierModelLabel: getTrialMonitorVerifierLabel(candidate.verifierModelKey),
          summary: candidate.summary,
          createdAt: candidate.createdAt.toISOString(),
          questionPrompt: normalizeTrialQuestionPrompt(candidate.question.prompt),
          trial: {
            shortTitle: candidate.question.trial.shortTitle,
            sponsorName: candidate.question.trial.sponsorName,
            sponsorTicker: candidate.question.trial.sponsorTicker,
            exactPhase: candidate.question.trial.exactPhase,
            nctNumber: candidate.question.trial.nctNumber,
            estPrimaryCompletionDate: candidate.question.trial.estPrimaryCompletionDate.toISOString(),
          },
          evidence: [...candidate.evidence]
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((evidence) => ({
              id: evidence.id,
              sourceType: evidence.sourceType as 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search',
              title: evidence.title,
              url: evidence.url,
              publishedAt: evidence.publishedAt ? evidence.publishedAt.toISOString() : null,
              excerpt: evidence.excerpt,
              domain: evidence.domain,
            })),
        }))}
        recentRuns={recentRuns.map((run) => ({
          id: run.id,
          triggerSource: run.triggerSource as 'cron' | 'manual',
          status: run.status as 'running' | 'completed' | 'failed',
          verifierModelLabel: extractVerifierModelLabelFromRunDebugLog(run.debugLog),
          questionsScanned: run.questionsScanned,
          candidatesCreated: run.candidatesCreated,
          errorSummary: run.errorSummary,
          startedAt: run.startedAt.toISOString(),
          updatedAt: run.updatedAt.toISOString(),
          completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        }))}
        initialEligibleQuestions={eligibleQuestions.map((question) => ({
          id: question.id,
          prompt: normalizeTrialQuestionPrompt(question.prompt),
          trial: {
            shortTitle: question.trial.shortTitle,
            sponsorName: question.trial.sponsorName,
            sponsorTicker: question.trial.sponsorTicker,
            nctNumber: question.trial.nctNumber,
            estPrimaryCompletionDate: question.trial.estPrimaryCompletionDate.toISOString(),
            lastMonitoredAt: question.trial.lastMonitoredAt ? question.trial.lastMonitoredAt.toISOString() : null,
          },
        }))}
      />
    </AdminConsoleLayout>
  )
}
