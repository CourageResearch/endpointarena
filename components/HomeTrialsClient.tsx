'use client'

import { Suspense } from 'react'
import { TrialsBrowseHomepage } from '@/components/TrialsBrowseHomepage'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

export function HomeTrialsClient({
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
      <TrialsBrowseHomepage
        detailBasePath={detailBasePath}
        headerLinkHref={headerLinkHref}
        headerLinkLabel={headerLinkLabel}
        headerLinkPlacement="both"
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
