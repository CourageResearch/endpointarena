import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string | null): string {
  if (!date) return 'TBD'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 70) return 'text-green-600'
  if (accuracy >= 50) return 'text-yellow-600'
  return 'text-red-600'
}

export function getPredictionBadgeColor(prediction: string): string {
  return prediction === 'pass'
    ? 'bg-green-100 text-green-800'
    : 'bg-red-100 text-red-800'
}
