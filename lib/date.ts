const MS_PER_DAY = 1000 * 60 * 60 * 24
const DEFAULT_UTC_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
}
const DEFAULT_LOCAL_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

function toValidDate(dateLike: Date | string | null | undefined): Date | null {
  if (!dateLike) return null
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatUtcDate(
  dateLike: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_UTC_DATE_OPTIONS,
  emptyLabel = '—',
): string {
  const date = toValidDate(dateLike)
  if (!date) return emptyLabel

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    ...options,
  }).format(date)
}

export function formatLocalDateTime(
  dateLike: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_LOCAL_DATETIME_OPTIONS,
  emptyLabel = '—',
): string {
  const date = toValidDate(dateLike)
  if (!date) return emptyLabel

  return new Intl.DateTimeFormat('en-US', options).format(date)
}

export function getDaysUntilUtc(dateLike: Date | string | null | undefined, now: Date = new Date()): number | null {
  const target = toValidDate(dateLike)
  if (!target) return null

  const targetMidnightUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  const nowMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.ceil((targetMidnightUtc - nowMidnightUtc) / MS_PER_DAY)
}
