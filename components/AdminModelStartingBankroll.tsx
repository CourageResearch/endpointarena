'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'
import type { TrialRuntimeConfigDto } from '@/components/AdminTrialConstantsManager'

type Props = {
  initialConfig: Pick<
    TrialRuntimeConfigDto,
    'season4HumanStartingBankrollDisplay' | 'season4StartingBankrollDisplay' | 'updatedAt'
  >
}

type BankrollKind = 'human' | 'ai'

type BankrollState = Record<BankrollKind, number>

type BankrollFormState = Record<BankrollKind, string>

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function parseBankroll(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`)
  }
  return parsed
}

export function AdminModelStartingBankroll({ initialConfig }: Props) {
  const router = useRouter()
  const [startingBankrolls, setStartingBankrolls] = useState<BankrollState>({
    human: initialConfig.season4HumanStartingBankrollDisplay,
    ai: initialConfig.season4StartingBankrollDisplay,
  })
  const [form, setForm] = useState<BankrollFormState>({
    human: String(initialConfig.season4HumanStartingBankrollDisplay),
    ai: String(initialConfig.season4StartingBankrollDisplay),
  })
  const [updatedAt, setUpdatedAt] = useState(initialConfig.updatedAt)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const updateForm = (key: BankrollKind, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const saveConfig = async () => {
    setError(null)
    setSuccessMessage(null)
    setIsSaving(true)

    try {
      const response = await fetch('/api/admin/trial-config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          season4HumanStartingBankrollDisplay: parseBankroll(form.human, 'Human default'),
          season4StartingBankrollDisplay: parseBankroll(form.ai, 'AI default'),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to update starting bankroll'))
      }

      const nextConfig = payload.config as TrialRuntimeConfigDto
      const faucetWarning = (payload as {
        faucetSync?: {
          warning?: string | null
        }
      }).faucetSync?.warning
      setStartingBankrolls({
        human: nextConfig.season4HumanStartingBankrollDisplay,
        ai: nextConfig.season4StartingBankrollDisplay,
      })
      setForm({
        human: String(nextConfig.season4HumanStartingBankrollDisplay),
        ai: String(nextConfig.season4StartingBankrollDisplay),
      })
      setUpdatedAt(nextConfig.updatedAt)
      setSuccessMessage(faucetWarning ? `Starting bankroll defaults saved. ${faucetWarning}` : 'Starting bankroll defaults saved.')
      router.refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save starting bankroll')
    } finally {
      setIsSaving(false)
    }
  }

  const resetToCurrent = () => {
    setForm({
      human: String(startingBankrolls.human),
      ai: String(startingBankrolls.ai),
    })
    setError(null)
    setSuccessMessage(null)
  }

  const updatedLabel = new Date(updatedAt).toLocaleString('en-US', { timeZone: 'UTC' })

  return (
    <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
      <h3 className="mb-2 text-sm font-semibold text-[#1a1a1a]">Starting Bankroll</h3>

      {error ? (
        <div className="mb-3 rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div className="mb-3 rounded-none border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {successMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Human Faucet Default</span>
          <input
            type="number"
            min={0}
            step={1}
            value={form.human}
            onChange={(event) => updateForm('human', event.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
          <span className="block text-xs text-[#8a8075]">Current: {formatMoney(startingBankrolls.human)}</span>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">AI Wallet Default</span>
          <input
            type="number"
            min={0}
            step={1}
            value={form.ai}
            onChange={(event) => updateForm('ai', event.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
          <span className="block text-xs text-[#8a8075]">Current: {formatMoney(startingBankrolls.ai)}</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void saveConfig()}
          disabled={isSaving}
          className="rounded-none bg-[#1a1a1a] px-4 py-2 text-sm text-white hover:bg-[#333] disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Defaults'}
        </button>
        <button
          type="button"
          onClick={resetToCurrent}
          disabled={isSaving}
          className="rounded-none border border-[#e8ddd0] bg-white px-4 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] disabled:opacity-50"
        >
          Reset
        </button>
        <span className="self-center text-xs text-[#8a8075]">Last updated: {updatedLabel} UTC</span>
      </div>
    </section>
  )
}
