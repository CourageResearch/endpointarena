import { db, fdaCalendarEvents, modelDecisionSnapshots } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'
import { MODEL_IDS, MODEL_INFO, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'

export const dynamic = 'force-dynamic'

async function getData() {
  const [fdaEventCount, snapshotCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)` }).from(modelDecisionSnapshots),
  ])

  return {
    fdaEventCount: fdaEventCount[0]?.count ?? 0,
    predictionCount: snapshotCount[0]?.count ?? 0,
    snapshotCount: snapshotCount[0]?.count ?? 0,
  }
}

export default async function MethodPage() {
  const { fdaEventCount, predictionCount, snapshotCount } = await getData()

  const MODEL_BINDINGS: Record<ModelId, {
    version: string
    internet: boolean
    internetDetail: string
    reasoning: string
    reasoningDetail: string
    maxTokens: string
  }> = {
    'claude-opus': {
      version: 'claude-opus-4-6',
      internet: true,
      internetDetail: 'Anthropic web_search_20250305 (max_uses: 7)',
      reasoning: 'Extended Thinking',
      reasoningDetail: 'Native thinking blocks + tool-assisted synthesis',
      maxTokens: '4,096 output',
    },
    'gpt-5.2': {
      version: 'gpt-5.2',
      internet: true,
      internetDetail: 'OpenAI web_search tool',
      reasoning: 'High Effort',
      reasoningDetail: 'reasoning.effort = high',
      maxTokens: '16,000 output',
    },
    'grok-4': {
      version: 'grok-4-1-fast-reasoning',
      internet: true,
      internetDetail: 'search_mode: auto',
      reasoning: 'Fast Reasoning',
      reasoningDetail: 'Native fast reasoning mode',
      maxTokens: '16,000 output',
    },
    'gemini-2.5': {
      version: 'gemini-2.5-pro',
      internet: true,
      internetDetail: 'Google Search grounding',
      reasoning: 'Thinking',
      reasoningDetail: 'thinkingConfig.thinkingBudget = -1',
      maxTokens: '65,536 output',
    },
    'gemini-3-pro': {
      version: 'gemini-3-pro-preview',
      internet: true,
      internetDetail: 'Google Search grounding',
      reasoning: 'Thinking',
      reasoningDetail: 'thinkingConfig.thinkingBudget = -1',
      maxTokens: '65,536 output',
    },
    'deepseek-v3.2': {
      version: 'deepseek-ai/DeepSeek-V3.1',
      internet: false,
      internetDetail: 'No web-search tool configured in the combined decision generator',
      reasoning: 'Reasoning mode',
      reasoningDetail: 'extra_body.reasoning_effort = high',
      maxTokens: '16,000 output',
    },
    'llama-4': {
      version: 'meta-llama/llama-4-scout-17b-16e-instruct',
      internet: false,
      internetDetail: 'No web-search tool configured in the combined decision generator',
      reasoning: 'Provider default',
      reasoningDetail: 'No explicit reasoning parameter configured',
      maxTokens: '8,192 output',
    },
    'kimi-k2': {
      version: 'moonshotai/Kimi-K2-Thinking',
      internet: false,
      internetDetail: 'No web-search tool configured in the combined decision generator',
      reasoning: 'Thinking',
      reasoningDetail: 'extra_body.reasoning_effort = high',
      maxTokens: '16,000 output',
    },
    'minimax-m2.5': {
      version: 'MiniMax-M2.5',
      internet: false,
      internetDetail: 'No web-search tool configured in FDA generator',
      reasoning: 'Provider default',
      reasoningDetail: 'No explicit reasoning parameter configured',
      maxTokens: '16,000 output',
    },
  }

  const models = MODEL_IDS.map((modelId) => {
    const binding = MODEL_BINDINGS[modelId]
    const info = MODEL_INFO[modelId]

    return {
      id: modelId,
      name: info.fullName,
      provider: info.provider,
      version: binding.version,
      features: {
        internet: binding.internet,
        internetDetail: binding.internetDetail,
        reasoning: binding.reasoning,
        reasoningDetail: binding.reasoningDetail,
        maxTokens: binding.maxTokens,
      },
    }
  })

  const processSteps = [
    {
      title: 'Track FDA Calendar Events',
      description: 'Monitor upcoming FDA drug approval decisions, including PDUFA dates for NDAs, BLAs, and supplemental applications.'
    },
    {
      title: 'Prepare Shared Context',
      description: 'Each model receives the same structured event, market, and portfolio context. One provider call produces both a forecast snapshot and a proposed market action, while application-side guardrails enforce trading limits.'
    },
    {
      title: 'Record Decision Snapshots',
      description: 'Ask each model for an intrinsic approval forecast first, then a market action for the same timepoint. Each snapshot stores approval probability, binary call, confidence, reasoning, and proposed action.'
    },
    {
      title: 'Wait for FDA Decisions',
      description: "Unlike benchmarks with known answers, we wait for the FDA to announce. There's no way to game this—the ground truth doesn't exist until the ruling."
    },
    {
      title: 'Score Results',
      description: "Compare either the first or final pre-outcome snapshot to the actual outcome. A prediction is correct if \"approved\" matches approval, or if \"rejected\" matches rejection/CRL."
    }
  ]

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-10 sm:mb-14">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Method</span>
            <HeaderDots />
          </div>
          <p className="text-base sm:text-lg text-[#8a8075] max-w-xl leading-relaxed">
            A fair test of AI prediction capabilities on real-world FDA decisions
          </p>
        </div>

        {/* Why This Matters */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Why traditional benchmarks fall short</span>
              <HeaderDots />
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm p-4 sm:p-6 h-full">
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">The Problem with AI Benchmarks</h3>
              <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">Most benchmarks test answers that already exist in training data. Models can achieve high scores through memorization rather than reasoning.</p>
              </div>
            </div>
            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm p-4 sm:p-6 h-full">
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">The Solution</h3>
              <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">FDA decisions do not exist until they are announced. No memorization, no leakage, and now a full time series of how each model updated over time.</p>
              </div>
            </div>
            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
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
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">The five-step evaluation process</span>
              <HeaderDots />
            </div>
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm p-4 sm:p-8">
              <div className="space-y-6 sm:space-y-8">
                {processSteps.map((step, index) => (
                  <div key={index} className="flex gap-3 sm:gap-6">
                    <div className="w-8 h-8 p-[1px] rounded-sm shrink-0" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
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
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">The models we compare</span>
              <HeaderDots />
            </div>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {models.map((model) => (
              <div key={model.id} className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                <div className="bg-white/95 rounded-sm p-4 sm:p-6 h-full">
                  <div className="flex items-center gap-3 mb-6" title={model.version}>
                    <div className="w-10 h-10 text-[#8a8075]">
                      <ModelIcon id={model.id} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[#8a8075]">{model.name}</h3>
                      <p className="text-xs text-[#b5aa9e]">{model.provider}</p>
                      <p
                        className="text-xs text-[#b5aa9e] font-mono whitespace-nowrap truncate cursor-help"
                        title={model.version}
                      >
                        {model.version}
                      </p>
                    </div>
                  </div>

                  <dl className="space-y-2">
                    <div className="rounded-sm border border-[#e8ddd0] bg-[#f7f4ef]/55 px-3 py-2">
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Web Search</dt>
                      <dd className="mt-1 text-sm">
                        {model.features.internet ? (
                          <span className="inline-flex items-center gap-2 text-[#7d8e6e]">
                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#7d8e6e]" />
                            Enabled
                          </span>
                        ) : (
                          <span className="text-[#b5aa9e]">Not available</span>
                        )}
                      </dd>
                    </div>

                    <div className="rounded-sm border border-[#e8ddd0] bg-[#f7f4ef]/55 px-3 py-2">
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Reasoning</dt>
                      <dd className="mt-1 text-sm leading-snug text-[#8a8075]">
                        {model.features.reasoning}
                      </dd>
                    </div>

                    <div className="rounded-sm border border-[#e8ddd0] bg-[#f7f4ef]/55 px-3 py-2">
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Max Output (FDA)</dt>
                      <dd className="mt-1 text-sm leading-snug text-[#b5aa9e]">
                        {model.features.maxTokens}
                      </dd>
                    </div>
                  </dl>

                  {(model.features.internetDetail || model.features.reasoningDetail) && (
                    <div className="mt-4 pt-4 border-t border-[#e8ddd0]">
                      <p className="text-xs leading-relaxed text-[#b5aa9e] break-words">
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
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
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
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm overflow-hidden">
              <pre className="p-3 sm:p-6 text-sm overflow-x-auto font-mono">
<span className="text-[#b5aa9e]">{'{'}</span>
{`\n  `}<span className="text-[#7d8e6e]">"prediction"</span><span className="text-[#b5aa9e]">:</span> <span className="text-amber-600">"approved"</span><span className="text-[#b5aa9e]">,</span>{`\n  `}<span className="text-[#7d8e6e]">"confidence"</span><span className="text-[#b5aa9e]">:</span> <span className="text-blue-600">75</span><span className="text-[#b5aa9e]">,</span>{`\n  `}<span className="text-[#7d8e6e]">"reasoning"</span><span className="text-[#b5aa9e]">:</span> <span className="text-amber-600">"..."</span>{`\n`}<span className="text-[#b5aa9e]">{'}'}</span>
              </pre>
              <div className="border-t border-[#e8ddd0] bg-[#f3ebe0]/40">
                <div className="px-3 sm:px-6 py-2 text-xs text-[#8a8075]">Schema (shape + constraints)</div>
                <pre className="px-3 sm:px-6 pb-4 sm:pb-6 text-xs sm:text-sm overflow-x-auto font-mono text-[#8a8075] leading-relaxed">{`{
  "type": "object",
  "required": ["prediction", "confidence", "reasoning"],
  "properties": {
    "prediction": {
      "type": "string",
      "enum": ["approved", "rejected"]
    },
    "confidence": {
      "type": "integer",
      "minimum": 50,
      "maximum": 100
    },
    "reasoning": {
      "type": "string"
    }
  }
}`}</pre>
              </div>
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
          </div>
          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e8ddd0]">
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{fdaEventCount}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">FDA Events Tracked</div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{predictionCount}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">Total Prediction Records</div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{snapshotCount}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">Decision Snapshots</div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="text-3xl font-mono font-medium tracking-tight text-[#1a1a1a]">{MODEL_IDS.length}</div>
                <div className="text-sm text-[#b5aa9e] mt-1">Models Compared</div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer gradient line */}
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
