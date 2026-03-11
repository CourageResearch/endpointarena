type EventDateKind = 'public' | 'synthetic'

export function isSyntheticEventDate(dateKind: string | null | undefined): dateKind is 'synthetic' {
  return dateKind === 'synthetic'
}

export function formatEventDateLabel(
  dateLike: Date | string | null | undefined,
  dateKind: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!dateLike) return '—'
  const date = typeof dateLike === 'string' ? new Date(dateLike) : dateLike
  if (Number.isNaN(date.getTime())) return '—'

  const formatted = date.toLocaleDateString('en-US', { timeZone: 'UTC', ...options })
  return isSyntheticEventDate(dateKind) ? `~${formatted}` : formatted
}

export function getEventDateBadgeLabel(dateKind: string | null | undefined): string | null {
  return isSyntheticEventDate(dateKind) ? 'CNPV' : null
}

export function getEventDateBadgeTitle(dateKind: string | null | undefined): string | null {
  if (!isSyntheticEventDate(dateKind)) return null
  return 'Synthetic CNPV action date calculated as award date plus 60 days until FDA publishes a public action date.'
}

export function formatEventCountdown(daysUntil: number | null, dateKind: string | null | undefined): string {
  if (daysUntil == null) return 'No date'
  if (isSyntheticEventDate(dateKind)) {
    return `~${Math.abs(daysUntil)}d`
  }
  if (daysUntil === 0) return 'Today'
  if (daysUntil < 0) {
    return `${Math.abs(daysUntil)}d past`
  }
  return `${daysUntil}d`
}
