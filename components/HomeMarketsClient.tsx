'use client'

import { Suspense } from 'react'
import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

export function HomeMarketsClient({
  detailBasePath,
  headerLinkHref,
  headerLinkLabel,
  initialOverview,
  initialTypeFilter,
  variant,
}: {
  detailBasePath?: string
  headerLinkHref?: string
  headerLinkLabel?: string
  initialOverview?: OverviewResponse | null
  initialTypeFilter?: string | null
  variant?: 'full' | 'table'
}) {
  return (
    <Suspense fallback={null}>
      <MarketBrowseHomepage
        detailBasePath={detailBasePath}
        headerLinkHref={headerLinkHref}
        headerLinkLabel={headerLinkLabel}
        headerLinkPlacement="footer"
        initialOverview={initialOverview}
        initialTypeFilter={initialTypeFilter}
        initialTableMaxRows={5}
        showSearchControl
        showRowCount={false}
        variant={variant}
      />
    </Suspense>
  )
}
