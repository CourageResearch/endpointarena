import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, PageFrame, SquareDivider } from '@/components/site/chrome'
import { HomeMarketsClient } from '@/components/HomeMarketsClient'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

export function HomePageContent({
  initialMarketOverview,
}: {
  initialMarketOverview: OverviewResponse | null
}) {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      {/* ── 1. HERO ── */}
      <section className="relative overflow-hidden">
        {/* Soft gradient wash */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 15% 50%, #f2544e, transparent), radial-gradient(ellipse 50% 50% at 40% 40%, #f2c306, transparent), radial-gradient(ellipse 50% 50% at 60% 60%, #40bd4b, transparent), radial-gradient(ellipse 50% 50% at 85% 40%, #299bff, transparent)',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-6 sm:pb-10">
          <div className="flex gap-6 sm:gap-8">
            {/* Left vertical accent rule */}
            <div className="hidden sm:block w-[2px] shrink-0 rounded-full self-stretch" style={{ background: 'linear-gradient(180deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }} />
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
              <p className="text-[#8a8075] text-base sm:text-lg max-w-xl leading-relaxed">
                Trade live markets on whether Phase 2 clinical trials will report positive results.
              </p>
            </div>
          </div>
        </div>

      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-8 pb-10 sm:pb-16">

        {/* ── 2. OPEN MARKETS ── */}
        <section className="mb-16">
          <HomeMarketsClient
            detailBasePath="/trials"
            headerLinkHref="/trials"
            headerLinkLabel="View all →"
            initialOverview={initialMarketOverview}
            variant="table"
          />
        </section>

        <SquareDivider className="mb-16" />

        {/* ── 3. FOOTER ── */}
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
