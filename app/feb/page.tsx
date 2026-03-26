import type { Metadata } from 'next'
import Link from 'next/link'
import { and, asc, gte, inArray, lt, or } from 'drizzle-orm'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'
import { db, phase2Trials, predictionMarkets, trialQuestions } from '@/lib/db'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import { buildPageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: 'February 2026 Phase 2 Trials',
  description: 'Review the Phase 2 trials in Endpoint Arena’s February 2026 queue, including completion dates, endpoints, and linked market questions.',
  path: '/feb',
})

const FEB_START = new Date(Date.UTC(2026, 1, 1))
const MAR_START = new Date(Date.UTC(2026, 2, 1))

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : '—'
}

function isInFebruary2026(value: Date | null) {
  if (!value) return false
  const time = value.getTime()
  return time >= FEB_START.getTime() && time < MAR_START.getTime()
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

export default async function FebruaryTrialsPage() {
  const trials = await db.query.phase2Trials.findMany({
    where: or(
      and(
        gte(phase2Trials.estPrimaryCompletionDate, FEB_START),
        lt(phase2Trials.estPrimaryCompletionDate, MAR_START),
      ),
      and(
        gte(phase2Trials.estStudyCompletionDate, FEB_START),
        lt(phase2Trials.estStudyCompletionDate, MAR_START),
      ),
    ),
    orderBy: [asc(phase2Trials.estPrimaryCompletionDate), asc(phase2Trials.estStudyCompletionDate), asc(phase2Trials.shortTitle)],
  })

  const trialIds = trials.map((trial) => trial.id)

  const [rawQuestions, markets] = trialIds.length > 0
    ? await Promise.all([
        db.query.trialQuestions.findMany({
          where: inArray(trialQuestions.trialId, trialIds),
          orderBy: [asc(trialQuestions.sortOrder), asc(trialQuestions.createdAt)],
        }),
        db.query.predictionMarkets.findMany(),
      ])
    : [[], []]

  const questions = filterSupportedTrialQuestions(rawQuestions)

  const questionsByTrialId = new Map<string, typeof questions>()
  for (const question of questions) {
    const current = questionsByTrialId.get(question.trialId) ?? []
    current.push(question)
    questionsByTrialId.set(question.trialId, current)
  }

  const marketByQuestionId = new Map(
    markets
      .filter((market) => market.trialQuestionId)
      .map((market) => [market.trialQuestionId as string, market]),
  )

  let matchedPrimaryCount = 0
  let matchedStudyCount = 0
  let completedCount = 0

  for (const trial of trials) {
    if (isInFebruary2026(trial.estPrimaryCompletionDate)) matchedPrimaryCount += 1
    if (isInFebruary2026(trial.estStudyCompletionDate)) matchedStudyCount += 1
    if (trial.currentStatus === 'Completed') completedCount += 1
  }

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-8 pt-8 sm:px-6 sm:pb-12 sm:pt-16">
        <div className="mb-8 sm:mb-12">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">February 2026</span>
            <HeaderDots />
          </div>
          <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-[#1a1a1a] sm:text-3xl">
            Phase 2 trials whose primary or study completion landed in February 2026.
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-[#8a8075] sm:text-base">
            This list comes from the original ClinicalTrials.gov export and is filtered to industry-sponsored,
            interventional Phase 2 studies. Use it as a focused review queue before we widen the import further.
          </p>
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-none border border-[#e8ddd0] bg-white/90 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#b5aa9e]">Trials</div>
            <div className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{trials.length}</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white/90 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#b5aa9e]">Primary In Feb</div>
            <div className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{matchedPrimaryCount}</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white/90 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#b5aa9e]">Study In Feb</div>
            <div className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{matchedStudyCount}</div>
            <div className="mt-1 text-xs text-[#8a8075]">{completedCount} currently marked completed</div>
          </div>
        </div>

        <div className="space-y-5">
          {trials.map((trial) => {
            const primaryMatch = isInFebruary2026(trial.estPrimaryCompletionDate)
            const studyMatch = isInFebruary2026(trial.estStudyCompletionDate)
            const matchLabel = primaryMatch && studyMatch
              ? 'Primary + Study Completion'
              : primaryMatch
                ? 'Primary Completion'
                : 'Study Completion'
            const trialQuestionsForTrial = (questionsByTrialId.get(trial.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)

            return (
              <article key={trial.id} className="rounded-none border border-[#e8ddd0] bg-white/90 p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-medium text-[#1a1a1a]">{trial.shortTitle}</h3>
                      <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 text-xs text-[#8a8075]">
                        {trial.exactPhase}
                      </span>
                      <span className="rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-2 py-1 text-xs text-[#8a8075]">
                        {matchLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[#8a8075]">
                      {trial.sponsorName}{trial.sponsorTicker ? ` (${trial.sponsorTicker})` : ''} · {trial.indication}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-[#5b5148] sm:grid-cols-2">
                      <div><span className="text-[#8a8075]">NCT:</span> {trial.nctNumber}</div>
                      <div><span className="text-[#8a8075]">Status:</span> {trial.currentStatus}</div>
                      <div><span className="text-[#8a8075]">Primary completion:</span> {formatDate(trial.estPrimaryCompletionDate)}</div>
                      <div><span className="text-[#8a8075]">Study completion:</span> {formatDate(trial.estStudyCompletionDate)}</div>
                    </div>
                    <div className="mt-3 rounded-none border border-[#e8ddd0] bg-[#faf7f2] p-3 text-sm text-[#5b5148]">
                      <span className="text-[#8a8075]">Primary endpoint:</span> {truncate(trial.primaryEndpoint, 320)}
                    </div>
                    <div className="mt-3 text-sm leading-relaxed text-[#6f665b]">{truncate(trial.briefSummary, 360)}</div>
                    <div className="mt-3">
                      <Link
                        href={`https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctNumber)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[#7a5e3a] underline decoration-[#d9cdbf] underline-offset-4 transition-colors hover:text-[#4f3d25]"
                      >
                        Open ClinicalTrials.gov record
                      </Link>
                    </div>
                  </div>

                  <div className="w-full max-w-xl shrink-0 lg:w-[420px]">
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">Markets</div>
                    <div className="space-y-2">
                      {trialQuestionsForTrial.length === 0 ? (
                        <div className="rounded-none border border-[#e8ddd0] bg-[#f5f2ed] px-3 py-3 text-sm text-[#9b9084]">
                          No supported market questions found for this trial yet.
                        </div>
                      ) : (
                        trialQuestionsForTrial.map((question) => {
                          const market = marketByQuestionId.get(question.id)
                          const isLive = question.status === 'live' && question.isBettable
                          const disabled = !isLive

                          return (
                            <div
                              key={question.id}
                              className={`rounded-none border px-3 py-3 ${
                                disabled
                                  ? 'border-[#e8ddd0] bg-[#f5f2ed] text-[#9b9084]'
                                  : 'border-[#d9cdbf] bg-[#fdfbf8]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium">{normalizeTrialQuestionPrompt(question.prompt)}</div>
                                {disabled ? (
                                  <span className="rounded-none border border-[#d9cdbf] bg-white px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">
                                    Coming soon
                                  </span>
                                ) : market ? (
                                  <Link
                                    href={`/trials/${encodeURIComponent(market.id)}`}
                                    className="rounded-none bg-[#1a1a1a] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#333]"
                                  >
                                    Open market
                                  </Link>
                                ) : (
                                  <span className="rounded-none border border-[#d9cdbf] bg-white px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">
                                    Pending open
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <FooterGradientRule className="mt-8" />
      </main>
    </PageFrame>
  )
}
