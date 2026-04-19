'use client'

import { PageFrame } from '@/components/site/chrome'
import { PrivyAuthCard } from '@/components/auth/PrivyAuthCard'
import { PublicNavbar } from '@/components/site/PublicNavbar'

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim())

function PrivyNotConfiguredCard() {
  return (
    <div className="rounded-sm border border-[#ef6f67]/35 bg-white p-6 text-sm text-[#6d645a] shadow-sm">
      <h1 className="text-xl font-semibold text-[#1a1a1a]">Season 4 auth isn’t configured yet</h1>
      <p className="mt-2">
        Add <code className="font-mono text-[0.92em]">NEXT_PUBLIC_PRIVY_APP_ID</code>, <code className="font-mono text-[0.92em]">PRIVY_APP_ID</code>, and <code className="font-mono text-[0.92em]">PRIVY_APP_SECRET</code> to finish the Privy rollout on this machine.
      </p>
    </div>
  )
}

export function PrivyAuthPage({ mode }: { mode: 'login' | 'signup' }) {
  return (
    <PageFrame>
      <PublicNavbar />

      <main className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
        <div className="mx-auto max-w-xl">
          <section>
            {PRIVY_ENABLED ? <PrivyAuthCard mode={mode} /> : <PrivyNotConfiguredCard />}
          </section>
        </div>
      </main>
    </PageFrame>
  )
}
