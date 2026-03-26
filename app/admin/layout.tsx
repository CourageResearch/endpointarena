import type { Metadata } from 'next'
import { buildNoIndexMetadata } from '@/lib/seo'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Admin',
  description: 'Private Endpoint Arena administration pages.',
  path: '/admin',
})

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
