import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'

export const dynamic = 'force-dynamic'

const RESEARCH_LINKS = [
  {
    label: 'RTTNews Corporate Calendar',
    href: 'https://www.rttnews.com/corpinfo/fdacalendar.aspx',
    external: true,
  },
  {
    label: 'Public FDA Calendar View',
    href: '/fda-calendar',
    external: false,
  },
  {
    label: 'Brand Preview Page',
    href: '/brand',
    external: false,
  },
] as const

export default async function AdminResourcesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  return (
    <AdminConsoleLayout
      title="Research Links"
      description="Keep external sources and internal reference pages in one place for fast admin workflows."
      activeTab="resources"
      topActions={(
        <a
          href="/admin"
          className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
        >
          Prediction Ops
        </a>
      )}
    >
      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Reference Hub</h2>
        <p className="text-sm text-[#8a8075] mt-1">Open links quickly while running predictions, resolving outcomes, or reviewing event metadata.</p>
      </section>

      <section className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Sources & Tools</h3>
        <p className="text-xs text-[#8a8075] mt-1">Includes public calendars and internal views used during event operations.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {RESEARCH_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              className="block rounded-lg border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] hover:border-[#d8ccb9] transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>
    </AdminConsoleLayout>
  )
}
