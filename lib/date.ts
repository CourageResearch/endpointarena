const MS_PER_DAY = 1000 * 60 * 60 * 24

function toValidDate(dateLike: Date | string | null | undefined): Date | null {
  if (!dateLike) return null
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike)
  return Number.isNaN(date.getTime()) ? null : date
}

export function getDaysUntilUtc(dateLike: Date | string | null | undefined, now: Date = new Date()): number | null {
  const target = toValidDate(dateLike)
  if (!target) return null

  const targetMidnightUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  const nowMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.ceil((targetMidnightUtc - nowMidnightUtc) / MS_PER_DAY)
}
