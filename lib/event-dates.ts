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
