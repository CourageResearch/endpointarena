import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'
import { FooterGradientRule, HeaderDots, PageFrame, SquareDivider } from '@/components/site/chrome'

export const dynamic = 'force-dynamic'

export default function Markets2Page() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3">
            <h1 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Prediction Markets: Experiment B</h1>
            <HeaderDots />
          </div>
          <p className="mt-3 text-sm text-[#8a8075] sm:text-base">
            Alternate detail layout experiment. Market pages place reasoning under the chart and move details + model positions to the right column.
          </p>
        </div>

        <SquareDivider className="mb-8" />

        <MarketBrowseHomepage detailBasePath="/markets2" />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
