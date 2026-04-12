import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { MODEL_IDS, MODEL_INFO } from '@/lib/constants'
import { MODEL_METHOD_BINDINGS } from '@/lib/model-runtime-metadata'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'
import {
  METHOD_PAGE_EXAMPLE_RESPONSE_TEXT,
  METHOD_PAGE_PROMPT_TEXT,
  METHOD_PAGE_SCHEMA_TEXT,
  METHOD_PAGE_SCORING_NOTE,
} from '@/lib/methodology-page'
import { buildPageMetadata } from '@/lib/seo'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: 'Methodology',
  description: 'Learn how Endpoint Arena benchmarks AI models on real-world clinical trial outcome markets.',
  path: '/method',
})

const SOFT_OUTLINE_GRADIENT =
  'linear-gradient(135deg, rgba(239, 111, 103, 0.7), rgba(93, 187, 99, 0.7), rgba(211, 157, 46, 0.7), rgba(91, 165, 237, 0.7))'

const SOFT_OUTLINE_PANEL_STYLE = {
  background: `linear-gradient(rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.95)) padding-box, ${SOFT_OUTLINE_GRADIENT} border-box`,
  backgroundClip: 'padding-box, border-box',
  backgroundOrigin: 'padding-box, border-box',
} as const

function SoftOutlinePanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('rounded-sm border border-transparent bg-white/95', className)}
      style={SOFT_OUTLINE_PANEL_STYLE}
    >
      {children}
    </div>
  )
}

export default async function MethodPage() {
  const models = MODEL_IDS.map((modelId) => {
    const binding = MODEL_METHOD_BINDINGS[modelId]
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
      title: 'Track Trial Questions',
      description: 'Monitor active trial readouts and outcome questions, including completion timing, sponsor context, and market-ready metadata.'
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
      title: 'Wait for Trial Outcomes',
      description: "Unlike benchmarks with known answers, we wait for the real-world readout to land. There's no way to game this because the outcome does not exist until the trial data arrives."
    },
    {
      title: 'Score Results',
      description: METHOD_PAGE_SCORING_NOTE,
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
          <h1 className="max-w-3xl font-serif text-3xl leading-tight tracking-tight text-[#1a1a1a] sm:text-4xl">
            How Endpoint Arena benchmarks AI on clinical trial outcomes.
          </h1>
          <p className="text-base sm:text-lg text-[#8a8075] max-w-xl leading-relaxed">
            A fair test of AI prediction capabilities on real-world clinical outcomes
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
            <SoftOutlinePanel className="h-full p-4 sm:p-6">
              <h3 className="mb-2 text-base font-semibold text-[#1a1a1a]">The Problem with AI Benchmarks</h3>
              <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">Most benchmarks test answers that already exist in training data. Models can achieve high scores through memorization rather than reasoning.</p>
            </SoftOutlinePanel>
            <SoftOutlinePanel className="h-full p-4 sm:p-6">
              <h3 className="mb-2 text-base font-semibold text-[#1a1a1a]">The Solution</h3>
              <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">Trial outcomes do not exist until the data lands. No memorization, no leakage, and a full time series of how each model updated over time.</p>
            </SoftOutlinePanel>
            <SoftOutlinePanel className="h-full p-4 sm:p-6">
              <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">What We're Testing</h3>
              <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">Can AI models reason about noisy clinical evidence and make accurate predictions about the future?</p>
            </SoftOutlinePanel>
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
          <SoftOutlinePanel className="p-4 sm:p-8">
            <div className="space-y-6 sm:space-y-8">
              {processSteps.map((step, index) => (
                <div key={index} className="flex gap-3 sm:gap-6">
                  <SoftOutlinePanel className="h-8 w-8 shrink-0 p-0">
                    <div className="flex h-full w-full items-center justify-center rounded-sm bg-white text-sm font-bold">
                      {index + 1}
                    </div>
                  </SoftOutlinePanel>
                  <div>
                    <h3 className="text-base font-semibold text-[#1a1a1a] mb-1">{step.title}</h3>
                    <p className="text-sm sm:text-base text-[#8a8075] leading-relaxed">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </SoftOutlinePanel>
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
              <SoftOutlinePanel key={model.id} className="h-full p-4 sm:p-6">
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
                    <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Max Output</dt>
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
              </SoftOutlinePanel>
            ))}
          </div>
        </section>

        {/* The Prompt */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Model Decision Prompt</span>
              <HeaderDots />
            </div>
          </div>
          <SoftOutlinePanel className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e8ddd0] bg-[#f3ebe0]/50">
              <span className="text-sm text-[#8a8075]">Generated from the runtime decision prompt builder</span>
            </div>
            <pre className="p-3 sm:p-6 text-xs sm:text-sm text-[#8a8075] overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
              {METHOD_PAGE_PROMPT_TEXT}
            </pre>
          </SoftOutlinePanel>
        </section>

        {/* Response Format */}
        <section className="mb-10 sm:mb-16">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Expected JSON Response</span>
              <HeaderDots />
            </div>
          </div>
          <SoftOutlinePanel className="overflow-hidden">
            <pre className="p-3 sm:p-6 text-xs sm:text-sm overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed text-[#8a8075]">
              {METHOD_PAGE_EXAMPLE_RESPONSE_TEXT}
            </pre>
            <div className="border-t border-[#e8ddd0] bg-[#f3ebe0]/40">
              <div className="px-3 sm:px-6 py-2 text-xs text-[#8a8075]">Runtime JSON schema (shape + constraints)</div>
              <pre className="px-3 sm:px-6 pb-4 sm:pb-6 text-xs sm:text-sm overflow-x-auto whitespace-pre-wrap font-mono text-[#8a8075] leading-relaxed">
                {METHOD_PAGE_SCHEMA_TEXT}
              </pre>
            </div>
          </SoftOutlinePanel>
        </section>

        {/* Footer gradient line */}
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
