import { cn } from '@/lib/utils'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'

type Direction = 'up' | 'down'

interface BrandDirectionMarkProps {
  direction: Direction
  className?: string
}

const UP_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [10, 2],
  [6, 6],
  [10, 6],
  [14, 6],
  [10, 10],
  [10, 14],
  [10, 18],
]

const DOWN_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [10, 2],
  [10, 6],
  [10, 10],
  [6, 14],
  [10, 14],
  [14, 14],
  [10, 18],
]

export function BrandDirectionMark({
  direction,
  className,
}: BrandDirectionMarkProps) {
  const blocks = direction === 'up' ? UP_BLOCKS : DOWN_BLOCKS
  const color = direction === 'up' ? BRAND_DOT_COLORS.green : BRAND_DOT_COLORS.coral

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('inline-block h-4 w-4 shrink-0', className)}
      fill="none"
      aria-hidden="true"
    >
      {blocks.map(([x, y], index) => (
        <rect key={`${x}-${y}-${index}`} x={x} y={y} width="4" height="4" rx="0.8" fill={color} />
      ))}
    </svg>
  )
}
