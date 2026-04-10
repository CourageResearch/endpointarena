import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminTrialOutcomeReview } from '@/components/AdminTrialOutcomeReview'
import { getTrialMonitorConfig } from '@/lib/trial-monitor-config'
import {
  countAllOpenTrialOutcomeQuestions,
  listEligibleTrialOutcomeQuestions,
  listPendingTrialOutcomeCandidates,
  listRecentTrialMonitorRuns,
} from '@/lib/trial-monitor'
import { listRecentTrialQuestionOutcomeHistory } from '@/lib/trial-outcome-history'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import {
  getTrialMonitorVerifierLabel,
  getTrialMonitorVerifierOptions,
  normalizeTrialMonitorVerifierModelKey,
} from '@/lib/trial-monitor-verifier-models'

export const dynamic = 'force-dynamic'

type TrialMonitorQuestionSelection = 'eligible_queue' | 'all_open_trials' | 'specific_nct'

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

function extractScopedNctNumberFromRunDebugLog(debugLog: string | null | undefined): string | null {
  if (typeof debugLog !== 'string' || debugLog.trim().length === 0) {
    return null
  }

  const nctMatch = debugLog.match(/"scopedNctNumber":\s*"([^"]+)"/)
  return nctMatch?.[1] ?? null
}

function extractQuestionSelectionFromRunDebugLog(debugLog: string | null | undefined): TrialMonitorQuestionSelection | null {
  if (typeof debugLog !== 'string' || debugLog.trim().length === 0) {
    return null
  }

  const selectionMatch = debugLog.match(/"questionSelection":\s*"([^"]+)"/)
  if (
    selectionMatch?.[1] === 'eligible_queue' ||
    selectionMatch?.[1] === 'all_open_trials' ||
    selectionMatch?.[1] === 'specific_nct'
  ) {
    return selectionMatch[1]
  }

  return null
}

function parseScopedNctSearchParam(value: string | string[] | undefined): string | null {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (typeof rawValue !== 'string') {
    return null
  }

  const normalizedValue = rawValue.trim().toUpperCase().replace(/\s+/g, '')
  return /^NCT\d{8}$/.test(normalizedValue) ? normalizedValue : null
}

function parseBooleanSearchParam(value: string | string[] | undefined): boolean {
  const rawValue = Array.isArray(value) ? value[0] : value
  return rawValue === '1' || rawValue === 'true'
}

function getRunVerifierModelLabel(input: {
  verifierModelKey: string | null
  debugLog: string | null | undefined
}): string {
  if (input.verifierModelKey) {
    return getTrialMonitorVerifierLabel(input.verifierModelKey)
  }

  return extractVerifierModelLabelFromRunDebugLog(input.debugLog)
}

function getRunScopedNctNumber(input: {
  scopedNctNumber: string | null
  debugLog: string | null | undefined
}): string | null {
  return input.scopedNctNumber ?? extractScopedNctNumberFromRunDebugLog(input.debugLog)
}

function getRunQuestionSelection(input: {
  scopedNctNumber: string | null
  debugLog: string | null | undefined
}): TrialMonitorQuestionSelection {
  if (input.scopedNctNumber) {
    return 'specific_nct'
  }

  return extractQuestionSelectionFromRunDebugLog(input.debugLog) ?? 'eligible_queue'
}

export default async function AdminOutcomesPage({
  searchParams,
}: {
  searchParams: Promise<{
    nct?: string | string[]
    autorun?: string | string[]
  }>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const resolvedSearchParams = await searchParams
  const initialScopedNctNumber = parseScopedNctSearchParam(resolvedSearchParams.nct)
  const autoRunScopedNctNumber = initialScopedNctNumber && parseBooleanSearchParam(resolvedSearchParams.autorun)
    ? initialScopedNctNumber
    : null

  const [config, candidates, recentRuns, eligibleQuestions, allOpenTrialCount, historyEntries] = await Promise.all([
    getTrialMonitorConfig(),
    listPendingTrialOutcomeCandidates(),
    listRecentTrialMonitorRuns(),
    listEligibleTrialOutcomeQuestions(),
    countAllOpenTrialOutcomeQuestions(),
    listRecentTrialQuestionOutcomeHistory(),
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
      title="Oracle"
      activeTab="outcomes"
    >
      <AdminTrialOutcomeReview
        initialConfig={{
          enabled: config.enabled,
          runIntervalHours: config.runIntervalHours,
          lookaheadDays: config.lookaheadDays,
          overdueRecheckHours: config.overdueRecheckHours,
          maxQuestionsPerRun: config.maxQuestionsPerRun,
          cronProcessingConcurrency: config.cronProcessingConcurrency,
          manualProcessingConcurrency: config.manualProcessingConcurrency,
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
          status: run.status as 'running' | 'completed' | 'failed' | 'paused',
          questionSelection: getRunQuestionSelection({
            scopedNctNumber: run.scopedNctNumber,
            debugLog: run.debugLog,
          }),
          verifierModelLabel: getRunVerifierModelLabel({
            verifierModelKey: run.verifierModelKey,
            debugLog: run.debugLog,
          }),
          scopedNctNumber: getRunScopedNctNumber({
            scopedNctNumber: run.scopedNctNumber,
            debugLog: run.debugLog,
          }),
          questionsScanned: run.questionsScanned,
          candidatesCreated: run.candidatesCreated,
          errorSummary: run.errorSummary,
          startedAt: run.startedAt.toISOString(),
          updatedAt: run.updatedAt.toISOString(),
          completedAt: run.completedAt ? run.completedAt.toISOString() : null,
          stopRequestedAt: run.stopRequestedAt ? run.stopRequestedAt.toISOString() : null,
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
        allOpenTrialCount={allOpenTrialCount}
        historyEntries={historyEntries.map((entry) => ({
          id: entry.id,
          trialQuestionId: entry.trialQuestionId,
          marketId: entry.marketId,
          questionPrompt: normalizeTrialQuestionPrompt(entry.questionPrompt),
          previousOutcome: entry.previousOutcome,
          previousOutcomeDate: entry.previousOutcomeDate,
          nextOutcome: entry.nextOutcome,
          nextOutcomeDate: entry.nextOutcomeDate,
          currentOutcome: entry.currentOutcome,
          currentOutcomeDate: entry.currentOutcomeDate,
          changedAt: entry.changedAt,
          changeSource: entry.changeSource,
          changedByName: entry.changedByName,
          changedByEmail: entry.changedByEmail,
          notes: entry.notes,
          trial: {
            shortTitle: entry.trial.shortTitle,
            sponsorName: entry.trial.sponsorName,
            sponsorTicker: entry.trial.sponsorTicker,
            nctNumber: entry.trial.nctNumber,
          },
          candidate: entry.candidate
            ? {
                id: entry.candidate.id,
                confidence: entry.candidate.confidence,
                summary: entry.candidate.summary,
                verifierModelLabel: getTrialMonitorVerifierLabel(entry.candidate.verifierModelKey),
                reviewedAt: entry.candidate.reviewedAt,
              }
            : null,
        }))}
        initialScopedNctNumber={initialScopedNctNumber}
        autoRunScopedNctNumber={autoRunScopedNctNumber}
      />
    </AdminConsoleLayout>
  )
}
