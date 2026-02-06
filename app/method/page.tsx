import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { MODEL_IDS } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'

export const dynamic = 'force-dynamic'

async function getData() {
  const [fdaEventCount, predictionCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)` })
      .from(fdaPredictions)
      .where(eq(fdaPredictions.predictorType, 'model')),
  ])

  return {
    fdaEventCount: fdaEventCount[0]?.count ?? 0,
    predictionCount: predictionCount[0]?.count ?? 0,
  }
}

export default async function Method2Page() {
  const { fdaEventCount, predictionCount } = await getData()

  const models = [
    {
      id: 'claude',
      name: 'Claude Opus 4.5',
      version: 'claude-opus-4-5-20251101',
      features: {
        internet: false,
        reasoning: 'Extended Thinking',
        reasoningDetail: '10,000 token thinking budget',
        maxTokens: '16,000',
      }
    },
    {
      id: 'gpt',
      name: 'GPT-5.2',
      version: 'gpt-5.2',
      features: {
        internet: true,
        internetDetail: 'Agentic web search',
        reasoning: 'High Effort',
        reasoningDetail: 'reasoning.effort: high',
        maxTokens: '16,000',
      }
    },
    {
      id: 'grok',
      name: 'Grok 4.1',
      version: 'grok-4-1-fast-reasoning',
      features: {
        internet: true,
        internetDetail: 'Live search (auto)',
        reasoning: 'Fast Reasoning',
        reasoningDetail: 'Built-in fast reasoning mode',
        maxTokens: '16,000',
      }
    }
  ]

  const processSteps = [
    {
      title: 'Track FDA Calendar Events',
      description: 'Monitor upcoming FDA drug approval decisions from the RTTNews FDA Calendar including PDUFA dates for NDAs, BLAs, and supplemental applications.'
    },
    {
      title: 'Prepare Identical Context',
      description: 'Each model receives the same information: drug name, company, application type, therapeutic area, clinical trial data, and regulatory history.'
    },
    {
      title: 'Request Predictions',
      description: 'Ask each model: "Will the FDA approve this drug?" Models provide a binary APPROVED or REJECTED prediction with reasoning. All predictions are timestamped before decisions.'
    },
    {
      title: 'Wait for FDA Decisions',
      description: "Unlike benchmarks with known answers, we wait for the FDA to announce. There's no way to game this—the ground truth doesn't exist until the ruling."
    },
    {
      title: 'Score Results',
      description: "Compare each model's prediction to the actual outcome. Correct if APPROVED matches approval, or REJECTED matches rejection/CRL."
    }
  ]

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <WhiteNavbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Method</h1>
          <p className="text-neutral-500">
            A fair test of AI prediction capabilities on real-world FDA decisions
          </p>
        </div>

        {/* Why This Matters */}
        <section className="mb-10 sm:mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Why This Matters</h2>
          <div className="grid md:grid-cols-3 gap-4 sm:gap-8">
            <div>
              <div className="font-medium mb-2">The Problem with AI Benchmarks</div>
              <p className="text-sm text-neutral-500">Most benchmarks test answers that already exist in training data. Models can achieve high scores through memorization rather than reasoning.</p>
            </div>
            <div>
              <div className="font-medium mb-2">The Solution</div>
              <p className="text-sm text-neutral-500">FDA decisions don't exist until they're announced. No memorization possible, no data leakage, no benchmark contamination.</p>
            </div>
            <div>
              <div className="font-medium mb-2">What We're Testing</div>
              <p className="text-sm text-neutral-500">Can AI models reason about complex regulatory decisions and make accurate predictions about the future?</p>
            </div>
          </div>
        </section>

        {/* The Process */}
        <section className="mb-10 sm:mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">The Process</h2>
          <div className="border border-neutral-200 p-4 sm:p-8">
            <div className="space-y-6 sm:space-y-8">
              {processSteps.map((step, index) => (
                <div key={index} className="flex gap-3 sm:gap-6">
                  <div className="w-8 h-8 border border-neutral-900 flex items-center justify-center text-sm font-bold shrink-0">
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="font-medium mb-1">{step.title}</h3>
                    <p className="text-sm text-neutral-500">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Model Cards */}
        <section className="mb-10 sm:mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Model Configuration</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {models.map((model) => (
              <div key={model.id} className="border border-neutral-200 p-4 sm:p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 text-neutral-700">
                    <ModelIcon id={model.id} />
                  </div>
                  <div>
                    <h3 className="font-semibold">{model.name}</h3>
                    <p className="text-xs text-neutral-400 font-mono">{model.version}</p>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500">Web Search</span>
                    {model.features.internet ? (
                      <span className="text-emerald-600">Yes</span>
                    ) : (
                      <span className="text-neutral-400">No</span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500">Reasoning</span>
                    <span className="text-neutral-900">{model.features.reasoning}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500">Max Tokens</span>
                    <span className="text-neutral-400">{model.features.maxTokens}</span>
                  </div>
                </div>

                {(model.features.internetDetail || model.features.reasoningDetail) && (
                  <div className="mt-4 pt-4 border-t border-neutral-100">
                    <p className="text-xs text-neutral-400">
                      {model.features.internetDetail && <span className="block">{model.features.internetDetail}</span>}
                      {model.features.reasoningDetail && <span className="block">{model.features.reasoningDetail}</span>}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* The Prompt */}
        <section className="mb-10 sm:mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Prediction Prompt</h2>
          <div className="border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
              <span className="text-sm text-neutral-500">All models receive the same prompt</span>
              <span className="text-xs bg-neutral-200 text-neutral-600 px-2 py-1">fda-prompt.ts</span>
            </div>
            <pre className="p-3 sm:p-6 text-sm text-neutral-600 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
{`You are an expert pharmaceutical analyst specializing in FDA
regulatory decisions. Analyze the following FDA decision and
predict the outcome.

## Drug Information

**Drug Name:** {drugName}
**Company:** {companyName}
**Application Type:** {applicationType}
**Therapeutic Area:** {therapeuticArea}
**Event Description:** {eventDescription}

## Your Task

1. Analyze this FDA decision based on:
   - Historical FDA approval rates (NDA ~85%, BLA ~90%, sNDA/sBLA ~95%)
   - The therapeutic area and unmet medical need
   - Priority Review vs Standard Review (if known)
   - The company's regulatory track record
   - Competitive landscape and existing treatments

2. Make a prediction:
   - **Prediction:** Either "approved" or "rejected"
   - **Confidence:** A percentage between 50-100%
   - **Reasoning:** 150-300 words supporting your prediction`}
            </pre>
          </div>
        </section>

        {/* Response Format */}
        <section className="mb-10 sm:mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Expected Response</h2>
          <div className="border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50">
              <span className="text-sm text-neutral-500">JSON format required</span>
            </div>
            <pre className="p-3 sm:p-6 text-sm overflow-x-auto font-mono">
<span className="text-neutral-400">{'{'}</span>
{`
  `}<span className="text-emerald-600">"prediction"</span><span className="text-neutral-400">:</span> <span className="text-amber-600">"approved"</span><span className="text-neutral-400">,</span>{`
  `}<span className="text-emerald-600">"confidence"</span><span className="text-neutral-400">:</span> <span className="text-blue-600">75</span><span className="text-neutral-400">,</span>{`
  `}<span className="text-emerald-600">"reasoning"</span><span className="text-neutral-400">:</span> <span className="text-amber-600">"Based on historical approval rates..."</span>
<span className="text-neutral-400">{'}'}</span>
            </pre>
          </div>
          <div className="mt-6 grid md:grid-cols-3 gap-4 text-sm">
            <div className="flex gap-2">
              <span className="text-emerald-600 font-mono">prediction</span>
              <span className="text-neutral-300">—</span>
              <span className="text-neutral-500">"approved" or "rejected"</span>
            </div>
            <div className="flex gap-2">
              <span className="text-emerald-600 font-mono">confidence</span>
              <span className="text-neutral-300">—</span>
              <span className="text-neutral-500">50-100 (percentage)</span>
            </div>
            <div className="flex gap-2">
              <span className="text-emerald-600 font-mono">reasoning</span>
              <span className="text-neutral-300">—</span>
              <span className="text-neutral-500">150-300 word explanation</span>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section>
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Current Progress</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="border border-neutral-200 p-4 sm:p-6">
              <div className="text-3xl font-bold">{fdaEventCount}</div>
              <div className="text-sm text-neutral-400 mt-1">FDA Events Tracked</div>
            </div>
            <div className="border border-neutral-200 p-4 sm:p-6">
              <div className="text-3xl font-bold">{predictionCount}</div>
              <div className="text-sm text-neutral-400 mt-1">Predictions Made</div>
            </div>
            <div className="border border-neutral-200 p-4 sm:p-6">
              <div className="text-3xl font-bold">{MODEL_IDS.length}</div>
              <div className="text-sm text-neutral-400 mt-1">Models Compared</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
