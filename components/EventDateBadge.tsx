import { getEventDateBadgeLabel, getEventDateBadgeTitle } from '@/lib/event-dates'

function BadgeRocket() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[11px] w-[11px] shrink-0 fill-current"
    >
      <path d="M12 2a6 6 0 0 1 6 6v4.59l1.71 1.7A1 1 0 0 1 20 15v1h-3v4h-2v-2H9v2H7v-4H4v-1a1 1 0 0 1 .29-.71L6 12.59V8a6 6 0 0 1 6-6Zm0 2a4 4 0 0 0-4 4v5.41L6.41 15H8v3h8v-3h1.59L16 13.41V8a4 4 0 0 0-4-4Zm0 2.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm-2.5 11.75 1-1.5h3l1 1.5h-5Z" />
    </svg>
  )
}

export function EventDateBadge({
  dateKind,
  className = '',
  variant = 'pill',
}: {
  dateKind?: string | null
  className?: string
  variant?: 'pill' | 'cornerCard'
}) {
  const label = getEventDateBadgeLabel(dateKind)
  if (!label) return null

  if (variant === 'cornerCard') {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-none border border-[#D39D2E]/35 px-2 py-1.5 text-[#a66a17] shadow-none ${className}`.trim()}
        style={{
          backgroundImage: 'linear-gradient(180deg, rgba(255, 249, 239, 0.98), rgba(248, 239, 223, 0.94))',
        }}
        title={getEventDateBadgeTitle(dateKind) ?? undefined}
      >
        <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase leading-none tracking-[0.14em]">
          <BadgeRocket />
          <span>{label.toUpperCase()}</span>
        </span>
      </span>
    )
  }

  return (
    <span
      className={className}
      title={getEventDateBadgeTitle(dateKind) ?? undefined}
    >
      {label}
    </span>
  )
}
