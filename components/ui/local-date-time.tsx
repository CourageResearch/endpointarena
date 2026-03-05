'use client'

import { useEffect, useState } from 'react'

type LocalDateTimeProps = {
  value: string | null
  emptyLabel?: string
  className?: string
}

const DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'short',
  timeStyle: 'short',
}

const FALLBACK_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DISPLAY_OPTIONS,
  timeZone: 'UTC',
}

function formatDateTime(value: string, options: Intl.DateTimeFormatOptions): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', options).format(parsed)
}

export function LocalDateTime({ value, emptyLabel = '—', className }: LocalDateTimeProps) {
  const [localLabel, setLocalLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!value) {
      setLocalLabel(null)
      return
    }

    setLocalLabel(formatDateTime(value, DISPLAY_OPTIONS))
  }, [value])

  if (!value) {
    return <span className={className}>{emptyLabel}</span>
  }

  const fallbackLabel = formatDateTime(value, FALLBACK_OPTIONS)
  const label = localLabel ?? fallbackLabel

  return (
    <time className={className} dateTime={value} title={label}>
      {label}
    </time>
  )
}
