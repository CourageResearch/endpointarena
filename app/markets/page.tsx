import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { getMarketOverviewData } from '@/lib/market-overview'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

export const dynamic = 'force-dynamic'

async function getInitialOverview(): Promise<OverviewResponse | null> {
  try {
    return await getMarketOverviewData()
  } catch {
    return null
  }
}

export default async function MarketsPage() {
  const initialOverview = await getInitialOverview()

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <MarketBrowseHomepage initialOverview={initialOverview} />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
