'use client'

import { MarketBrowseHomepage } from '@/components/MarketBrowseHomepage'

export function HomeMarketsClient({
  detailBasePath,
  headerLinkHref,
  headerLinkLabel,
}: {
  detailBasePath?: string
  headerLinkHref?: string
  headerLinkLabel?: string
}) {
  return (
    <MarketBrowseHomepage
      detailBasePath={detailBasePath}
      headerLinkHref={headerLinkHref}
      headerLinkLabel={headerLinkLabel}
    />
  )
}
