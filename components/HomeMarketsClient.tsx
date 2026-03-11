'use client'

import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

export function HomeMarketsClient({
  detailBasePath,
  headerLinkHref,
  headerLinkLabel,
  initialOverview,
}: {
  detailBasePath?: string
  headerLinkHref?: string
  headerLinkLabel?: string
  initialOverview?: OverviewResponse | null
}) {
  return (
    <MarketBrowseHomepage
      detailBasePath={detailBasePath}
      headerLinkHref={headerLinkHref}
      headerLinkLabel={headerLinkLabel}
      initialOverview={initialOverview}
    />
  )
}
