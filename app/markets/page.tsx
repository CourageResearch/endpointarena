import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'

export const dynamic = 'force-dynamic'

export default function MarketsPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <MarketBrowseHomepage />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
