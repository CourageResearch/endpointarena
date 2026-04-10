import type { Metadata } from 'next'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { createBrowseTrialsOverviewPayload } from '@/lib/trial-overview-payload'
import { HomePageContent } from '@/components/HomePageContent'
import { buildPageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: 'Prediction Market for Phase 2 Clinical Trials',
  description: 'Track live Phase 2 clinical trials, AI model rankings, and methodology on Endpoint Arena.',
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
  const initialStatusTab = firstSearchParam(resolvedSearchParams.tab)
  const initialTrialOverview = createBrowseTrialsOverviewPayload(
    await getTrialsOverviewData({ includeResolved: true }),
  )
  if (!initialTrialOverview) {
    throw new Error('Homepage trials overview payload was unexpectedly empty.')
  }

  return (
    <HomePageContent
      initialStatusTab={initialStatusTab}
      initialTrialOverview={initialTrialOverview}
    />
  )
}
