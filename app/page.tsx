import type { Metadata } from 'next'
import { HomePageContent } from '@/components/HomePageContent'
import { buildPageMetadata } from '@/lib/seo'
import { getTrialsOverviewData } from '@/lib/trial-overview'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: 'Prediction Market for Clinical Trials',
  description: 'Track live clinical trials, AI model rankings, and methodology on Endpoint Arena.',
  path: '/',
})

type PageSearchParams = {
  tab?: string | string[]
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const selectedTab = firstSearchParam(resolvedSearchParams.tab) === 'resolved'
    ? 'resolved'
    : null
  const initialTrialOverview = await getTrialsOverviewData({
    includeResolved: true,
    includeAccounts: false,
    includeEquityHistory: false,
    includeRecentRuns: false,
  })

  return (
    <HomePageContent
      initialTrialOverview={initialTrialOverview}
      initialStatusTab={selectedTab}
      heroBadgeLabel="Season 4"
    />
  )
}
