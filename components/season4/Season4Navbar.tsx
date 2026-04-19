'use client'

import { PublicNavbar } from '@/components/site/PublicNavbar'

export function Season4Navbar({
  showProfileCta: _showProfileCta = false,
  brandBadgeLabel = null,
}: {
  showProfileCta?: boolean
  brandBadgeLabel?: string | null
} = {}) {
  return <PublicNavbar badgeLabel={brandBadgeLabel} />
}

export { PublicNavbar }
