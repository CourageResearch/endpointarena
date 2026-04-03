import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { TrialOracleRunsPanel } from '@/components/TrialOracleRunsPanel'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { buildNoIndexMetadata } from '@/lib/seo'
import { listPendingTrialOutcomeCandidates, listRecentTrialMonitorRuns } from '@/lib/trial-monitor'
import { listRecentTrialQuestionOutcomeHistory } from '@/lib/trial-outcome-history'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import { getTrialMonitorVerifierLabel } from '@/lib/trial-monitor-verifier-models'

export const dynamic = 'force-dynamic'

function normalizeNctNumber(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? ''
  return /^NCT\d{8}$/.test(trimmed) ? trimmed : null
}

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

function runTouchesTrialQuestion(
  debugLog: string | null | undefined,
  input: {
    questionId: string | null | undefined
    nctNumber: string
  },
): boolean {
  if (typeof debugLog !== 'string' || debugLog.trim().length === 0) {
    return false
  }

  return (
    (input.questionId ? debugLog.includes(`trialQuestionId: ${input.questionId}`) : false) ||
    debugLog.includes(`"scopedNctNumber": "${input.nctNumber}"`)
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const canonicalMarketId = decodeURIComponent(encodedMarketId)

  return buildNoIndexMetadata({
    title: 'Oracle Runs',
    description: 'Public oracle outcome review activity for this trial.',
    path: `/trials/${encodeURIComponent(canonicalMarketId)}/oracle-runs`,
  })
}

export default async function TrialOracleRunsPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const overviewData = await getTrialsOverviewData({ marketId }).catch((error) => {
    console.error('Failed to preload market overview for trial oracle runs page:', error)
    return null
  })
  const selectedMarket = overviewData?.openMarkets.find((market) => market.marketId === marketId)
    || overviewData?.resolvedMarkets.find((market) => market.marketId === marketId)

  if (!selectedMarket) {
    notFound()
  }

  const nctNumber = normalizeNctNumber(selectedMarket.event?.nctId)
  if (!nctNumber) {
    notFound()
  }
  const trialQuestionId = selectedMarket.trialQuestionId ?? null

  const [allCandidates, allRecentRuns, allHistoryEntries] = await Promise.all([
    listPendingTrialOutcomeCandidates(),
    listRecentTrialMonitorRuns(),
    listRecentTrialQuestionOutcomeHistory(),
  ])

  const candidates = allCandidates
    .filter((candidate) => normalizeNctNumber(candidate.question.trial.nctNumber) === nctNumber)
    .map((candidate) => ({
      id: candidate.id,
      proposedOutcome: candidate.proposedOutcome as 'YES' | 'NO' | 'NO_DECISION',
      confidence: candidate.confidence,
      verifierModelLabel: getTrialMonitorVerifierLabel(candidate.verifierModelKey),
      summary: candidate.summary,
      createdAt: candidate.createdAt.toISOString(),
      questionPrompt: normalizeTrialQuestionPrompt(candidate.question.prompt),
      evidence: [...candidate.evidence]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((evidence) => ({
          id: evidence.id,
          sourceType: evidence.sourceType as 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search',
          title: evidence.title,
          url: evidence.url,
          publishedAt: evidence.publishedAt ? evidence.publishedAt.toISOString() : null,
          excerpt: evidence.excerpt,
          domain: evidence.domain,
        })),
    }))

  const recentRuns = allRecentRuns
    .filter((run) => runTouchesTrialQuestion(run.debugLog, { questionId: trialQuestionId, nctNumber }))
    .map((run) => ({
      id: run.id,
      status: run.status as 'running' | 'completed' | 'failed' | 'paused',
      verifierModelLabel: extractVerifierModelLabelFromRunDebugLog(run.debugLog),
      scopedNctNumber: extractScopedNctNumberFromRunDebugLog(run.debugLog),
      questionsScanned: run.questionsScanned,
      candidatesCreated: run.candidatesCreated,
      errorSummary: run.errorSummary,
      startedAt: run.startedAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      stopRequestedAt: run.stopRequestedAt ? run.stopRequestedAt.toISOString() : null,
    }))

  const historyEntries = allHistoryEntries
    .filter((entry) => normalizeNctNumber(entry.trial.nctNumber) === nctNumber)
    .map((entry) => ({
      id: entry.id,
      questionPrompt: normalizeTrialQuestionPrompt(entry.questionPrompt),
      previousOutcome: entry.previousOutcome,
      nextOutcome: entry.nextOutcome,
      currentOutcome: entry.currentOutcome,
      changedAt: entry.changedAt,
      changeSource: entry.changeSource,
      candidate: entry.candidate
        ? {
            id: entry.candidate.id,
            confidence: entry.candidate.confidence,
            summary: entry.candidate.summary,
            verifierModelLabel: getTrialMonitorVerifierLabel(entry.candidate.verifierModelKey),
            reviewedAt: entry.candidate.reviewedAt,
          }
        : null,
    }))

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8 sm:py-12`}>
        <TrialOracleRunsPanel
          selectedMarket={selectedMarket}
          candidates={candidates}
          recentRuns={recentRuns}
          historyEntries={historyEntries}
        />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
