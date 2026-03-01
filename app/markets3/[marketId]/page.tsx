import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MarketDashboardConcept5 } from '@/components/MarketDashboardConcept5'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'

export const dynamic = 'force-dynamic'

export default async function MarketDetailPageMarkets3({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8 sm:py-12`}>
        <MarketDashboardConcept5
          initialMarketId={marketId}
          showMarketList={false}
          detailLayout="stacked"
        />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
