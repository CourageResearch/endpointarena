export type SearchParamValue = string | string[] | undefined
export type PageSearchParams = Record<string, SearchParamValue>

export type AdminDayFilterOption<TValue extends number = number> = {
  label: string
  value: TValue
}

export const ADMIN_ACTIVITY_DAY_FILTERS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
] as const satisfies ReadonlyArray<AdminDayFilterOption>

export const ADMIN_CRASH_DAY_FILTERS = [
  { label: '24h', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
] as const satisfies ReadonlyArray<AdminDayFilterOption>

export function firstSearchParam(value: SearchParamValue): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

export function parseAdminDayFilter<TValue extends number>(
  value: SearchParamValue,
  filters: readonly AdminDayFilterOption<TValue>[],
  fallback: TValue,
): TValue {
  const rawValue = firstSearchParam(value)
  const parsedValue = Number.parseInt(rawValue, 10)
  const matchedFilter = filters.find((filter) => filter.value === parsedValue)
  return matchedFilter?.value ?? fallback
}

export function buildPathWithSearchParams(
  pathname: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue

    const normalizedValue = String(value).trim()
    if (!normalizedValue) continue

    searchParams.set(key, normalizedValue)
  }

  const query = searchParams.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function buildAdminDayFilterHref<TValue extends number>(
  pathname: string,
  days: number | null | undefined,
  filters: readonly AdminDayFilterOption<TValue>[],
): string {
  const matchedFilter = filters.find((filter) => filter.value === days)
  if (!matchedFilter) return pathname
  return buildPathWithSearchParams(pathname, { days: matchedFilter.value })
}
