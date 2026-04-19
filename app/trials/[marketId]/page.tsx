import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicNavbar } from '@/components/site/PublicNavbar'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { Season4MarketPage } from '@/components/season4/Season4MarketPage'
import { NotFoundError } from '@/lib/errors'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'
import { getSession } from '@/lib/auth/session'
import { getSeason4MarketDetail } from '@/lib/season4-market-data'
import { loadSeason4DashboardMarket } from '@/lib/season4-trial-dashboard-data'
import { buildNoIndexMetadata, buildPageMetadata } from '@/lib/seo'
import { resolveSeason4TrialTab } from '@/lib/season4-trial-tabs'
import { loadTrialOracleTabData } from '@/lib/trial-oracle-data'

export const dynamic = 'force-dynamic'

type PageSearchParams = {
  tab?: string | string[]
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function loadDetail(identifier: string) {
  const session = await getSession()
  return getSeason4MarketDetail(identifier, {
    sync: true,
    viewerUserId: session?.user.id ?? null,
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)

  try {
    const detail = await getSeason4MarketDetail(marketId)
    const closeTimeLabel = detail.market.closeTime
      ? new Date(detail.market.closeTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : null

    return buildPageMetadata({
      title: detail.market.title,
      description: [
        detail.trial?.questionPrompt ?? 'Season 4 onchain clinical trial market.',
        closeTimeLabel ? `Closes ${closeTimeLabel}.` : null,
        typeof detail.market.priceYes === 'number' ? `YES ${Math.round(detail.market.priceYes * 100)}%.` : null,
      ].filter(Boolean).join(' '),
      path: `/trials/${encodeURIComponent(detail.market.marketSlug)}`,
    })
  } catch {
    return buildNoIndexMetadata({
      title: 'Season 4 Market',
      description: 'This season 4 market is unavailable.',
      path: `/trials/${encodeURIComponent(marketId)}`,
    })
  }
}

export default async function TrialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ marketId: string }>
  searchParams?: Promise<PageSearchParams>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  const resolvedSearchParams = (await searchParams) ?? {}
  const activeTab = resolveSeason4TrialTab(firstSearchParam(resolvedSearchParams.tab))

  try {
    const detail = await loadDetail(marketId)
    const selectedMarket = await loadSeason4DashboardMarket(detail)

    let oracleTabData = null

    if (activeTab === 'oracles') {
      oracleTabData = await loadTrialOracleTabData(selectedMarket)
    }

    return (
      <PageFrame>
        <PublicNavbar />

        <main className={`${SITE_CONTAINER_CLASS} py-8 sm:py-12`}>
          <Season4MarketPage
            initialDetail={detail}
            initialSelectedMarket={selectedMarket}
            activeTab={activeTab}
            oracleTabData={oracleTabData}
          />

          <FooterGradientRule className="mt-10" />
        </main>
      </PageFrame>
    )
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound()
    }

    throw error
  }
}
