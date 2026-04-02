import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { TrialDashboard } from '@/components/TrialDashboard'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { createDetailTrialsOverviewPayload } from '@/lib/trial-overview-payload'
import { buildNoIndexMetadata } from '@/lib/seo'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const canonicalMarketId = decodeURIComponent(encodedMarketId)

  return buildNoIndexMetadata({
    title: 'Decision Snapshots',
    description: 'Model decision history for this trial market.',
    path: `/trials/${encodeURIComponent(canonicalMarketId)}`,
  })
}

export default async function TrialDecisionSnapshotsPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const overviewData = await getTrialsOverviewData({ marketId }).catch((error) => {
    console.error('Failed to preload market overview for trial decision snapshots page:', error)
    return null
  })
  const selectedMarket = overviewData?.openMarkets.find((market) => market.marketId === marketId)
    || overviewData?.resolvedMarkets.find((market) => market.marketId === marketId)

  if (!selectedMarket) {
    notFound()
  }

  const initialData = createDetailTrialsOverviewPayload(overviewData)

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8 sm:py-12`}>
        <TrialDashboard
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
