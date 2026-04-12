import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { TrialOracleRunsPanel } from '@/components/TrialOracleRunsPanel'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { loadTrialOracleTabData } from '@/lib/trial-oracle-data'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { buildNoIndexMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const canonicalMarketId = decodeURIComponent(encodedMarketId)

  return buildNoIndexMetadata({
    title: 'Oracle Runs',
    description: 'Public oracle outcome review activity for this trial.',
    path: `/trials/${encodeURIComponent(canonicalMarketId)}/oracle-runs`,
  })
}

export default async function TrialOracleRunsPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const overviewData = await getTrialsOverviewData({ marketId }).catch((error) => {
    console.error('Failed to preload market overview for trial oracle runs page:', error)
    return null
  })
  const selectedMarket = overviewData?.openMarkets.find((market) => market.marketId === marketId)
    || overviewData?.resolvedMarkets.find((market) => market.marketId === marketId)

  if (!selectedMarket) {
    notFound()
  }

  const oracleData = await loadTrialOracleTabData(selectedMarket)
  if (!oracleData.available) {
    notFound()
  }

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} py-8 sm:py-12`}>
        <TrialOracleRunsPanel
          selectedMarket={oracleData.selectedMarket ?? selectedMarket}
          allFindings={oracleData.allFindings}
          runHistory={oracleData.runHistory}
          historyEntries={oracleData.historyEntries}
        />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
