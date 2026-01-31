import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import { Navbar } from '@/components/Navbar'
import { MODEL_IDS } from '@/lib/constants'

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

export default async function HowItWorksPage() {
  const { fdaEventCount, predictionCount } = await getData()

  const models = [
    {
      id: 'claude',
      name: 'Claude Opus 4.5',
      version: 'claude-opus-4-5-20251101',
      color: 'orange',
      icon: (
        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
          <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>
        </svg>
      ),
      features: {
        internet: false,
        reasoning: 'Extended Thinking',
        reasoningDetail: '10,000 token budget',
        maxTokens: '16,000',
      }
    },
    {
      id: 'gpt',
      name: 'GPT-5.2',
      version: 'gpt-5.2',
      color: 'emerald',
      icon: (
        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      ),
      features: {
        internet: true,
        internetDetail: 'Agentic web search',
        reasoning: 'High Effort',
        reasoningDetail: 'reasoning.effort: high',
        maxTokens: 'Default',
      }
    },
    {
      id: 'grok',
      name: 'Grok 4',
      version: 'grok-4',
      color: 'blue',
      icon: (
        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      features: {
        internet: true,
        internetDetail: 'Live search (auto)',
        reasoning: 'Standard',
        reasoningDetail: 'No enhanced reasoning',
        maxTokens: '4,096',
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
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">How It Works</h1>
          <p className="text-zinc-400">
            A fair test of AI prediction capabilities on real-world FDA decisions
          </p>
        </div>

        {/* Why This Matters */}
        <section className="mb-12">
          <div className="bg-gradient-to-r from-blue-500/10 via-transparent to-purple-500/10 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Why This Matters</h2>
            <div className="grid md:grid-cols-3 gap-6 text-sm">
              <div>
                <div className="text-zinc-300 font-medium mb-2">The Problem with AI Benchmarks</div>
                <p className="text-zinc-500">Most benchmarks test answers that already exist in training data. Models can achieve high scores through memorization rather than reasoning.</p>
              </div>
              <div>
                <div className="text-zinc-300 font-medium mb-2">Our Solution</div>
                <p className="text-zinc-500">FDA decisions don't exist until they're announced. No memorization possible, no data leakage, no benchmark contamination.</p>
              </div>
              <div>
                <div className="text-zinc-300 font-medium mb-2">What We're Testing</div>
                <p className="text-zinc-500">Can AI models reason about complex regulatory decisions and make accurate predictions about the future?</p>
              </div>
            </div>
          </div>
        </section>

        {/* The Process */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">The Process</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <div className="space-y-6">
              {processSteps.map((step, index) => (
                <div key={index} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-bold shrink-0">
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="font-medium mb-1">{step.title}</h3>
                    <p className="text-sm text-zinc-500">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Model Cards */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">Model Configuration</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {models.map((model) => (
              <div
                key={model.id}
                className={`bg-zinc-900/50 border rounded-xl p-5 ${
                  model.color === 'orange' ? 'border-orange-500/30' :
                  model.color === 'emerald' ? 'border-emerald-500/30' :
                  'border-blue-500/30'
                }`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`${
                    model.color === 'orange' ? 'text-orange-400' :
                    model.color === 'emerald' ? 'text-emerald-400' :
                    'text-blue-400'
                  }`}>
                    {model.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{model.name}</h3>
                    <p className="text-xs text-zinc-500 font-mono">{model.version}</p>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">Web Search</span>
                    {model.features.internet ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Yes
                      </span>
                    ) : (
                      <span className="text-zinc-600">No</span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">Reasoning</span>
                    <span className={`${
                      model.features.reasoning !== 'Standard'
                        ? model.color === 'orange' ? 'text-orange-400' : 'text-emerald-400'
                        : 'text-zinc-400'
                    }`}>
                      {model.features.reasoning}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">Max Tokens</span>
                    <span className="text-zinc-400">{model.features.maxTokens}</span>
                  </div>
                </div>

                {(model.features.internetDetail || model.features.reasoningDetail) && (
                  <div className="mt-4 pt-3 border-t border-zinc-800">
                    <p className="text-xs text-zinc-600">
                      {model.features.internetDetail && <span className="block">{model.features.internetDetail}</span>}
                      {model.features.reasoningDetail && <span className="block">{model.features.reasoningDetail}</span>}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Key Differences Callout */}
        <section className="mb-12">
          <div className="bg-gradient-to-r from-amber-500/10 via-transparent to-emerald-500/10 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Key Differences
            </h2>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="flex gap-3">
                <div className="w-1 bg-emerald-500 rounded-full" />
                <div>
                  <p className="text-zinc-300 font-medium">GPT-5.2 & Grok 4 can search the web</p>
                  <p className="text-zinc-500">They may find recent news, press releases, or analyst reports</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-1 bg-orange-500 rounded-full" />
                <div>
                  <p className="text-zinc-300 font-medium">Claude uses extended thinking</p>
                  <p className="text-zinc-500">10,000 token budget for step-by-step reasoning</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* The Prompt */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">Prediction Prompt</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-sm text-zinc-400">All models receive the same prompt</span>
              <span className="text-xs bg-zinc-800 text-zinc-500 px-2 py-1 rounded">fda-prompt.ts</span>
            </div>
            <pre className="p-4 text-sm text-zinc-400 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
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
        <section className="mb-12">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">Expected Response</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <span className="text-sm text-zinc-400">JSON format required</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto font-mono">
<span className="text-zinc-500">{'{'}</span>
{`
  `}<span className="text-emerald-400">"prediction"</span><span className="text-zinc-500">:</span> <span className="text-amber-300">"approved"</span><span className="text-zinc-500">,</span>{`
  `}<span className="text-emerald-400">"confidence"</span><span className="text-zinc-500">:</span> <span className="text-blue-400">75</span><span className="text-zinc-500">,</span>{`
  `}<span className="text-emerald-400">"reasoning"</span><span className="text-zinc-500">:</span> <span className="text-amber-300">"Based on historical approval rates..."</span>
<span className="text-zinc-500">{'}'}</span>
            </pre>
          </div>
          <div className="mt-4 grid md:grid-cols-3 gap-4 text-sm">
            <div className="flex gap-2">
              <span className="text-emerald-400">prediction</span>
              <span className="text-zinc-600">—</span>
              <span className="text-zinc-400">"approved" or "rejected"</span>
            </div>
            <div className="flex gap-2">
              <span className="text-emerald-400">confidence</span>
              <span className="text-zinc-600">—</span>
              <span className="text-zinc-400">50-100 (percentage)</span>
            </div>
            <div className="flex gap-2">
              <span className="text-emerald-400">reasoning</span>
              <span className="text-zinc-600">—</span>
              <span className="text-zinc-400">150-300 word explanation</span>
            </div>
          </div>
        </section>

        {/* Data Sources */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">Data Sources</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
            <div>
              <span className="text-zinc-300 font-medium">FDA Calendar:</span>
              <span className="text-zinc-500 ml-2">Upcoming PDUFA dates from RTTNews FDA Calendar.</span>
            </div>
            <div>
              <span className="text-zinc-300 font-medium">Research Context:</span>
              <span className="text-zinc-500 ml-2">Clinical trial data, regulatory history, and advisory committee recommendations when available.</span>
            </div>
            <div>
              <span className="text-zinc-300 font-medium">Results:</span>
              <span className="text-zinc-500 ml-2">Official FDA announcements, company press releases, and regulatory filings.</span>
            </div>
          </div>
        </section>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-white">{fdaEventCount}</div>
            <div className="text-xs text-zinc-500">FDA Events Tracked</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-400">{predictionCount}</div>
            <div className="text-xs text-zinc-500">Predictions Made</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-emerald-400">{MODEL_IDS.length}</div>
            <div className="text-xs text-zinc-500">Models Compared</div>
          </div>
        </div>

      </main>
    </div>
  )
}
