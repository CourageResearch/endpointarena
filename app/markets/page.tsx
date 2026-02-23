import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'
import { FooterGradientRule, HeaderDots, PageFrame, SquareDivider } from '@/components/site/chrome'

export const dynamic = 'force-dynamic'

export default function MarketsPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3">
            <h1 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Prediction Markets</h1>
            <HeaderDots />
          </div>
          <p className="mt-3 text-sm text-[#8a8075] sm:text-base">
            Browse FDA approval markets first. Click into any market for the full event page with chart history and model commentary.
          </p>
        </div>

        <SquareDivider className="mb-8" />

        <MarketBrowseHomepage />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
