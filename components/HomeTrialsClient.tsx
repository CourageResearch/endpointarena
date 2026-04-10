'use client'

import { Suspense } from 'react'
import { TrialsBrowseHomepage } from '@/components/TrialsBrowseHomepage'
import type { OverviewResponse } from '@/lib/markets/overview-shared'

export function HomeTrialsClient({
  detailBasePath,
  headerLinkHref,
  headerLinkLabel,
  initialOverview,
  initialStatusTab,
  initialTypeFilter,
  variant,
}: {
  detailBasePath?: string
  headerLinkHref?: string
  headerLinkLabel?: string
  initialOverview: OverviewResponse
  initialStatusTab?: string | null
  initialTypeFilter?: string | null
  variant?: 'full' | 'table'
}) {
  return (
    <Suspense fallback={null}>
      <TrialsBrowseHomepage
        includeResolved
        autoRefresh={false}
        detailBasePath={detailBasePath}
        headerLinkHref={headerLinkHref}
        headerLinkLabel={headerLinkLabel}
        headerLinkPlacement="header"
        initialOverview={initialOverview}
        initialStatusTab={initialStatusTab}
        initialTypeFilter={initialTypeFilter}
        initialTableMaxRows={10}
        showSearchControl
        showStatusTabs
        showRowCount={false}
        variant={variant}
      />
    </Suspense>
  )
}
