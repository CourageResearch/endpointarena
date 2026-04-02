import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { TrialDashboard } from '@/components/TrialDashboard'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { createDetailTrialsOverviewPayload } from '@/lib/trial-overview-payload'
import { getMarketQuestion } from '@/lib/markets/overview-shared'
import { buildNoIndexMetadata, buildPageMetadata } from '@/lib/seo'

export const revalidate = 300

async function getMarketForMetadata(marketId: string) {
  const data = await getTrialsOverviewData({ marketId }).catch(() => null)

  return data?.openMarkets.find((market) => market.marketId === marketId)
    || data?.resolvedMarkets.find((market) => market.marketId === marketId)
    || null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const market = await getMarketForMetadata(marketId)

  if (!market?.event) {
    return buildNoIndexMetadata({
      title: 'Trial Market',
      description: 'This trial market is unavailable.',
      path: `/trials/${encodeURIComponent(marketId)}`,
    })
  }

  const drugName = market.event.drugName || 'Phase 2 trial'
  const sponsorName = market.event.sponsorName?.trim() || market.event.companyName?.trim()
  const applicationType = market.event.applicationType?.trim()
  const decisionDateLabel = market.event.decisionDate
    ? new Date(market.event.decisionDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null
  const question = getMarketQuestion(market)
  const description = [
    question,
    sponsorName ? `Sponsor: ${sponsorName}.` : null,
    applicationType ? `Type: ${applicationType}.` : null,
    decisionDateLabel ? `Decision date: ${decisionDateLabel}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return buildPageMetadata({
    title: `${drugName} Trial Market`,
    description,
    path: `/trials/${encodeURIComponent(marketId)}`,
  })
}

export default async function TrialDetailPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const overviewData = await getTrialsOverviewData({ marketId }).catch((error) => {
    console.error('Failed to preload market overview for trial detail page:', error)
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
        />

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
