import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { MODEL_IDS } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'

export const dynamic = 'force-dynamic'

function HeaderDots() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#D4604A', opacity: 0.8 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#C9A227', opacity: 0.85 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#2D7CF6', opacity: 0.8 }} />
    </div>
  )
}

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

export default async function MethodPage() {
  const { fdaEventCount, predictionCount } = await getData()

  const models = [
    {
      id: 'claude',
      name: 'Claude Opus 4.6',
      version: 'claude-opus-4-6',
      features: {
        internet: false,
        internetDetail: 'No web access during prediction',
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
      title: 'Prepare Similar Context',
      description: 'Each model receives the same core information—drug name, company, application type, therapeutic area, and event details. However, models aren\'t identical: some have web search, others use extended reasoning. Rather than handicapping them to a lowest common denominator, we let each model use its full capabilities so every prediction reflects its best effort.'
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
    <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-10 sm:mb-14">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Method</span>
            <HeaderDots />
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-light tracking-tight leading-[1.08] mb-4">
            How we test AI prediction accuracy
          </h1>
          <p className="text-base sm:text-lg text-[#8a8075] max-w-xl leading-relaxed">
            A fair test of AI prediction capabilities on real-world FDA decisions
          </p>
        </div>

        {/* Why This Matters */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Why This Matters</span>
              <HeaderDots />
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-light tracking-tight leading-snug">
              Why traditional benchmarks fall short
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
              <div className="bg-white/95 rounded-sm p-4 sm:p-6 h-full">
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">The Problem with AI Benchmarks</h3>
                <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">Most benchmarks test answers that already exist in training data. Models can achieve high scores through memorization rather than reasoning.</p>
              </div>
            </div>
            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
              <div className="bg-white/95 rounded-sm p-4 sm:p-6 h-full">
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">The Solution</h3>
                <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">FDA decisions don't exist until they're announced. No memorization possible, no data leakage, no benchmark contamination.</p>
              </div>
            </div>
            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
              <div className="bg-white/95 rounded-sm p-4 sm:p-6 h-full">
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">What We're Testing</h3>
                <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">Can AI models reason about complex regulatory decisions and make accurate predictions about the future?</p>
              </div>
            </div>
          </div>
        </section>

        {/* The Process */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">The Process</span>
              <HeaderDots />
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-light tracking-tight leading-snug">
              Our five-step evaluation process
            </h2>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
            <div className="bg-white/95 rounded-sm p-4 sm:p-8">
              <div className="space-y-6 sm:space-y-8">
                {processSteps.map((step, index) => (
                  <div key={index} className="flex gap-3 sm:gap-6">
                    <div className="w-8 h-8 p-[1px] rounded-sm shrink-0" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
                      <div className="w-full h-full bg-white rounded-sm flex items-center justify-center text-sm font-bold">
                        {index + 1}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-[#1a1a1a] mb-1">{step.title}</h3>
                      <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Model Cards */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Model Configuration</span>
              <HeaderDots />
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-light tracking-tight leading-snug">
              The models we compare
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {models.map((model) => (
              <div key={model.id} className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
                <div className="bg-white/95 rounded-sm p-4 sm:p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 text-[#1a1a1a]">
                      <ModelIcon id={model.id} />
                    </div>
                    <div>
                      <h3 className="font-semibold">{model.name}</h3>
                      <p className="text-xs text-[#b5aa9e] font-mono">{model.version}</p>
                    </div>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-[#8a8075]">Web Search</span>
                      {model.features.internet ? (
                        <span className="text-[#7d8e6e]">Yes</span>
                      ) : (
                        <span className="text-[#b5aa9e]">No</span>
                      )}
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-[#8a8075]">Reasoning</span>
                      <span className="text-[#1a1a1a]">{model.features.reasoning}</span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-[#8a8075]">Max Tokens</span>
                      <span className="text-[#b5aa9e]">{model.features.maxTokens}</span>
                    </div>
                  </div>

                  {(model.features.internetDetail || model.features.reasoningDetail) && (
                    <div className="mt-4 pt-4 border-t border-[#e8ddd0]">
                      <p className="text-xs text-[#b5aa9e]">
                        {model.features.internetDetail && <span className="block">{model.features.internetDetail}</span>}
                        {model.features.reasoningDetail && <span className="block">{model.features.reasoningDetail}</span>}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The Prompt */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Prediction Prompt</span>
              <HeaderDots />
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-light tracking-tight leading-snug">
              The prompt every model receives
            </h2>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
            <div className="bg-white/95 rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-[#e8ddd0] bg-[#f3ebe0]/50">
                <span className="text-sm text-[#8a8075]">All models receive the same prompt</span>
              </div>
              <pre className="p-3 sm:p-6 text-sm text-[#8a8075] overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
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
          </div>
        </section>

        {/* Response Format */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Expected Response</span>
              <HeaderDots />
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-light tracking-tight leading-snug">
              Required response format
            </h2>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
            <div className="bg-white/95 rounded-sm overflow-hidden">
              <pre className="p-3 sm:p-6 text-sm overflow-x-auto font-mono">
<span className="text-[#b5aa9e]">{'{'}</span>
{`
  `}<span className="text-[#7d8e6e]">"prediction"</span><span className="text-[#b5aa9e]">:</span> <span className="text-amber-600">"approved"</span><span className="text-[#b5aa9e]">,</span>{`
  `}<span className="text-[#7d8e6e]">"confidence"</span><span className="text-[#b5aa9e]">:</span> <span className="text-blue-600">75</span><span className="text-[#b5aa9e]">,</span>{`
  `}<span className="text-[#7d8e6e]">"reasoning"</span><span className="text-[#b5aa9e]">:</span> <span className="text-amber-600">"Based on historical approval rates..."</span>{`
`}<span className="text-[#b5aa9e]">{'}'}</span>
              </pre>
            </div>
          </div>
          <div className="mt-6 grid md:grid-cols-3 gap-4 text-sm">
            <div className="flex gap-2">
              <span className="text-[#7d8e6e] font-mono">prediction</span>
              <span className="text-[#d4c9bc]">—</span>
              <span className="text-[#8a8075]">"approved" or "rejected"</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#7d8e6e] font-mono">confidence</span>
              <span className="text-[#d4c9bc]">—</span>
              <span className="text-[#8a8075]">50-100 (percentage)</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#7d8e6e] font-mono">reasoning</span>
              <span className="text-[#d4c9bc]">—</span>
              <span className="text-[#8a8075]">150-300 word explanation</span>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Current Progress</span>
              <HeaderDots />
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-light tracking-tight leading-snug">
              Results so far
            </h2>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
            <div className="bg-white/95 rounded-sm grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#e8ddd0]">
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{fdaEventCount}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">FDA Events Tracked</div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{predictionCount}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">Predictions Made</div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{MODEL_IDS.length}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">Models Compared</div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer gradient line */}
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6)' }} />
      </main>
    </div>
  )
}
