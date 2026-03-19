export function isSoftDecisionDate(dateKind: string | null | undefined): dateKind is 'soft' {
  return dateKind === 'soft'
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
  return isSoftDecisionDate(dateKind) ? `~${formatted}` : formatted
}

export function getEventDateBadgeLabel(dateKind: string | null | undefined): string | null {
  return isSoftDecisionDate(dateKind) ? 'Expected' : null
}

export function getEventDateBadgeTitle(dateKind: string | null | undefined): string | null {
  if (!isSoftDecisionDate(dateKind)) return null
  return 'Expected decision date. The timing is approximate and may move if no final decision is announced.'
}

export function formatEventCountdown(daysUntil: number | null, dateKind: string | null | undefined): string {
  if (daysUntil == null) return 'No date'
  if (isSoftDecisionDate(dateKind)) {
    return `~${Math.abs(daysUntil)}d`
  }
  if (daysUntil === 0) return 'Today'
  if (daysUntil < 0) {
    return `${Math.abs(daysUntil)}d past`
  }
  return `${daysUntil}d`
}
