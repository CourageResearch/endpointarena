import { cn } from '@/lib/utils'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'

type BrandDecisionMarkVariant = 'correct' | 'incorrect'

interface BrandDecisionMarkProps {
  variant: BrandDecisionMarkVariant
  className?: string
}

export function BrandDecisionMark({
  variant,
  className,
}: BrandDecisionMarkProps) {
  if (variant === 'correct') {
    return (
      <svg
        viewBox="0 0 30 24"
        className={cn('inline-block h-4 w-4 shrink-0', className)}
        fill="none"
        aria-hidden="true"
      >
        <rect x="0.8" y="7.8" width="6.4" height="6.4" rx="1.2" fill={BRAND_DOT_COLORS.green} />
        <rect x="7.8" y="14.8" width="6.4" height="6.4" rx="1.2" fill={BRAND_DOT_COLORS.green} />
        <rect x="14.8" y="7.8" width="6.4" height="6.4" rx="1.2" fill={BRAND_DOT_COLORS.green} />
        <rect x="21.8" y="0.8" width="6.4" height="6.4" rx="1.2" fill={BRAND_DOT_COLORS.green} />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 30 24"
      className={cn('inline-block h-4 w-4 shrink-0', className)}
      fill="none"
      aria-hidden="true"
    >
      <rect x="4.4" y="3.8" width="5.2" height="5.2" rx="1" fill={BRAND_DOT_COLORS.coral} />
      <rect x="11.9" y="9.3" width="5.2" height="5.2" rx="1" fill={BRAND_DOT_COLORS.coral} />
      <rect x="19.4" y="14.8" width="5.2" height="5.2" rx="1" fill={BRAND_DOT_COLORS.coral} />
      <rect x="19.4" y="3.8" width="5.2" height="5.2" rx="1" fill={BRAND_DOT_COLORS.coral} />
      <rect x="4.4" y="14.8" width="5.2" height="5.2" rx="1" fill={BRAND_DOT_COLORS.coral} />
    </svg>
  )
}
