import { WhiteNavbar } from '@/components/WhiteNavbar'
import { MarketDashboardConcept5 } from '@/components/MarketDashboardConcept5'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { getMarketOverviewData } from '@/lib/market-overview'

export const dynamic = 'force-dynamic'

export default async function MarketDecisionSnapshotsPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const initialData = await getMarketOverviewData().catch((error) => {
    console.error('Failed to preload market overview for decision snapshots page:', error)
    return null
  })

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8 sm:py-12`}>
        <MarketDashboardConcept5
          initialMarketId={marketId}
          initialData={initialData}
          showMarketList={false}
          detailLayout="stacked"
          viewMode="decision-snapshots"
        />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
