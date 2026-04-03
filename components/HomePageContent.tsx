import { useId } from 'react'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, PageFrame, SquareDivider } from '@/components/site/chrome'
import { HomeTrialsClient } from '@/components/HomeTrialsClient'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

function HeroGradientStem() {
  const gradientId = useId().replace(/:/g, '')

  return (
    <svg
      className="hidden w-px shrink-0 self-stretch sm:block"
      viewBox="0 0 1 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#EF6F67" />
          <stop offset="33.33%" stopColor="#5DBB63" />
          <stop offset="66.67%" stopColor="#D39D2E" />
          <stop offset="100%" stopColor="#5BA5ED" />
        </linearGradient>
      </defs>
      <rect width="1" height="100" fill={`url(#${gradientId})`} shapeRendering="crispEdges" />
    </svg>
  )
}

export function HomePageContent({
  initialTrialOverview,
}: {
  initialTrialOverview: OverviewResponse | null
}) {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 15% 50%, #f2544e, transparent), radial-gradient(ellipse 50% 50% at 40% 40%, #f2c306, transparent), radial-gradient(ellipse 50% 50% at 60% 60%, #40bd4b, transparent), radial-gradient(ellipse 50% 50% at 85% 40%, #299bff, transparent)',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-6 sm:pb-10">
          <div className="flex gap-6 sm:gap-8">
            <HeroGradientStem />
            <div className="min-w-0">
              <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-normal tracking-tight leading-[1.08] mb-5">
                The{' '}
                <span className="relative inline-block">
                  <span className="relative z-10">prediction market</span>
                  <span className="absolute inset-0 -inset-x-1 bottom-[0.1em] top-[0.55em] bg-[#D39D2E]/15 -skew-x-1 rounded-sm" />
                </span>
                <br className="hidden sm:block" />
                for{' '}
                <span className="inline-block">
                  <span className="relative inline-block">
                    <span className="relative z-10">Phase 2</span>
                    <span className="absolute inset-0 -inset-x-1 bottom-[0.1em] top-[0.55em] bg-[#D39D2E]/15 -skew-x-1 rounded-sm" />
                  </span>{' '}
                  clinical trials
                </span>
                .
              </h1>
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-8 pb-10 sm:pb-16">
        {/* Trials */}
        <section className="mb-16">
          <HomeTrialsClient
            detailBasePath="/trials"
            headerLinkHref="/trials"
            headerLinkLabel="View all trials ->"
            initialOverview={initialTrialOverview}
            variant="table"
          />
        </section>

        <SquareDivider className="mb-16" />

        {/* Footer */}
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
