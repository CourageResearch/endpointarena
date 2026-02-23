import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { AdminMarketConstantsManager, type MarketRuntimeConfigDto } from '@/components/AdminMarketConstantsManager'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'

export const dynamic = 'force-dynamic'

function toDto(config: Awaited<ReturnType<typeof getMarketRuntimeConfig>>): MarketRuntimeConfigDto {
  return {
    warmupRunCount: config.warmupRunCount,
    warmupMaxTradeUsd: config.warmupMaxTradeUsd,
    warmupBuyCashFraction: config.warmupBuyCashFraction,
    openingLmsrB: config.openingLmsrB,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

export default async function AdminSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const config = await getMarketRuntimeConfig()

  return (
    <AdminConsoleLayout
      title="Market Settings"
      description="Tune cold-start controls and opening liquidity without redeploying."
      activeTab="settings"
      topActions={(
        <a
          href="/admin/markets"
          className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
        >
          Market Ops
        </a>
      )}
    >
      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Runtime Controls</h2>
        <p className="text-sm text-[#8a8075] mt-1">
          Changes apply to new market opens and future daily runs immediately after saving.
        </p>
      </section>

      <AdminMarketConstantsManager initialConfig={toDto(config)} />
    </AdminConsoleLayout>
  )
}
