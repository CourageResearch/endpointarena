import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { DecisionSnapshotRunner } from '@/components/DecisionSnapshotRunner'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL, MODEL_IDS } from '@/lib/constants'
import { db, predictionMarkets, trialQuestions } from '@/lib/db'
import { attachUnifiedPredictionsToEvents } from '@/lib/model-decision-snapshots'
import { filterSupportedTrialQuestions, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

export const dynamic = 'force-dynamic'

async function getData() {
  const openMarkets = await db.query.predictionMarkets.findMany({
    where: and(
      eq(predictionMarkets.status, 'OPEN'),
      isNotNull(predictionMarkets.trialQuestionId),
    ),
    orderBy: [asc(predictionMarkets.openedAt)],
  })

  const questionIds = Array.from(new Set(
    openMarkets
      .map((market) => market.trialQuestionId)
      .filter((value): value is string => Boolean(value)),
  ))

  const rawQuestions = questionIds.length > 0
    ? await db.query.trialQuestions.findMany({
        where: and(
          inArray(trialQuestions.id, questionIds),
          eq(trialQuestions.outcome, 'Pending'),
        ),
        with: {
          trial: true,
        },
        orderBy: [asc(trialQuestions.createdAt)],
      })
    : []
  const questions = filterSupportedTrialQuestions(rawQuestions)
  const supportedQuestionIds = new Set(questions.map((question) => question.id))

  const marketByQuestionId = new Map(
    openMarkets
      .filter((market) => market.trialQuestionId)
      .filter((market) => supportedQuestionIds.has(market.trialQuestionId as string))
      .map((market) => [market.trialQuestionId as string, market]),
  )
  const questionsWithPredictions = await attachUnifiedPredictionsToEvents(questions)

  const stats = {
    openMarkets: questionsWithPredictions.length,
    marketsWithSnapshots: questionsWithPredictions.filter((question) => question.predictions.length > 0).length,
    marketsMissingSnapshots: questionsWithPredictions.filter((question) => question.predictions.length === 0).length,
    totalSnapshots: questionsWithPredictions.reduce((sum, question) => (
      sum + question.predictions.reduce((questionSum, prediction) => questionSum + (prediction.history?.length ?? 1), 0)
    ), 0),
    marketsWithFullModelCoverage: questionsWithPredictions.filter((question) => question.predictions.length >= MODEL_IDS.length).length,
  }

  return {
    questions: questionsWithPredictions.map((question) => ({
      ...question,
      marketId: marketByQuestionId.get(question.id)?.id ?? null,
    })),
    stats,
  }
}

export default async function AdminPredictionsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { questions, stats } = await getData()
  const coveragePct = stats.openMarkets > 0
    ? Math.round((stats.marketsWithSnapshots / stats.openMarkets) * 100)
    : 0

  const eventsForClient = questions.map((question) => ({
    id: question.id,
    marketId: question.marketId,
    shortTitle: question.trial.shortTitle,
    sponsorName: question.trial.sponsorName,
    sponsorTicker: question.trial.sponsorTicker,
    indication: question.trial.indication,
    exactPhase: question.trial.exactPhase,
    decisionDate: question.trial.estPrimaryCompletionDate.toISOString(),
    outcome: question.outcome,
    questionPrompt: normalizeTrialQuestionPrompt(question.prompt),
    nctNumber: question.trial.nctNumber,
    predictions: question.predictions,
  }))

  return (
    <AdminConsoleLayout
      title="Decision Operations"
      description="Create append-only model decision snapshots for live Phase 2 trials."
      activeTab="predictions"
    >
      <section className="mb-6">
        <div className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Open-Trial Queue</h2>
          <p className="mt-1 text-xs text-[#8a8075]">This view only includes pending trial questions with an open trial.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-none border border-[#D39D2E]/30 bg-[#D39D2E]/5 p-3">
              <p className="text-xl font-semibold text-[#D39D2E]">{stats.openMarkets}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Open Trials</p>
            </div>
            <div className="rounded-none border border-[#EF6F67]/30 bg-[#EF6F67]/5 p-3">
              <p className="text-xl font-semibold text-[#EF6F67]">{stats.marketsMissingSnapshots}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">No Snapshots Yet</p>
            </div>
            <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
              <p className="text-xl font-semibold text-[#5BA5ED]">{stats.marketsWithFullModelCoverage}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Full Model Coverage</p>
            </div>
            <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
              <p className="text-xl font-semibold text-[#3a8a2e]">{stats.totalSnapshots}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Snapshots Stored</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Snapshot Coverage</h2>
          <p className="text-xs text-[#8a8075]">
            {stats.marketsWithSnapshots}/{stats.openMarkets} open trials have at least one decision snapshot
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-none bg-[#e8ddd0]">
          <div className="h-full rounded-none bg-[#5BA5ED]" style={{ width: `${coveragePct}%` }} />
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Decision Workflow</h2>
        <p className="mt-1 text-sm text-[#8a8075]">Manual runs create append-only snapshots only. Trade execution stays in the daily trial cycle.</p>
      </section>

      <DecisionSnapshotRunner events={eventsForClient} />
    </AdminConsoleLayout>
  )
}
