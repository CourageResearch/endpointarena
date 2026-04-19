'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'

interface Props {
  initialConfig: TrialRuntimeConfigDto
}

type FormState = {
  toyTrialCount: string
  season4MarketLiquidityBDisplay: string
}

function parseField(value: string, fieldLabel: string, minimum = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a number`)
  }
  if (parsed < minimum) {
    throw new Error(`${fieldLabel} must be at least ${minimum}`)
  }
  return parsed
}

export interface TrialRuntimeConfigDto {
  toyTrialCount: number
  season4MarketLiquidityBDisplay: number
  season4HumanStartingBankrollDisplay: number
  season4StartingBankrollDisplay: number
  createdAt: string
  updatedAt: string
}

function toFormState(config: TrialRuntimeConfigDto): FormState {
  return {
    toyTrialCount: String(config.toyTrialCount),
    season4MarketLiquidityBDisplay: String(config.season4MarketLiquidityBDisplay),
  }
}

export function AdminTrialConstantsManager({ initialConfig }: Props) {
  const router = useRouter()
  const [config, setConfig] = useState(initialConfig)
  const [form, setForm] = useState<FormState>(() => toFormState(initialConfig))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const resetToCurrent = () => {
    setForm(toFormState(config))
    setError(null)
    setSuccessMessage(null)
  }

  const saveConfig = async () => {
    setError(null)
    setSuccessMessage(null)
    setIsSaving(true)

    try {
      const payload = {
        toyTrialCount: parseField(form.toyTrialCount, 'Toy trial count'),
        season4MarketLiquidityBDisplay: parseField(form.season4MarketLiquidityBDisplay, 'Liquidity B', 1),
      }

      const response = await fetch('/api/admin/trial-config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to update runtime settings'))
      }

      const nextConfig = data.config as TrialRuntimeConfigDto
      setConfig(nextConfig)
      setForm(toFormState(nextConfig))
      window.dispatchEvent(new CustomEvent('endpointarena:trial-runtime-config-updated', {
        detail: {
          toyTrialCount: nextConfig.toyTrialCount,
          season4MarketLiquidityBDisplay: nextConfig.season4MarketLiquidityBDisplay,
        },
      }))
      setSuccessMessage('Settings saved.')
      router.refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updatedLabel = new Date(config.updatedAt).toLocaleString('en-US', { timeZone: 'UTC' })

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-none border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {successMessage}
        </div>
      )}

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <label className="space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Toy DB Trial Count</span>
          <input
            type="number"
            min={0}
            step={1}
            value={form.toyTrialCount}
            onChange={(e) => updateField('toyTrialCount', e.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
          <p className="text-xs text-[#8a8075]">Toy-only reset target. Season 4 live markets use Base Sepolia onchain configuration.</p>
        </label>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <label className="space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Liquidity B</span>
          <input
            type="number"
            min={1}
            step={1}
            value={form.season4MarketLiquidityBDisplay}
            onChange={(e) => updateField('season4MarketLiquidityBDisplay', e.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
          <p className="text-xs text-[#8a8075]">Default AMM depth for new markets, in display mock USDC.</p>
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={saveConfig}
          disabled={isSaving}
          className="px-4 py-2 rounded-none text-sm bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          type="button"
          onClick={resetToCurrent}
          disabled={isSaving}
          className="px-4 py-2 rounded-none text-sm border border-[#e8ddd0] bg-white text-[#8a8075] hover:text-[#1a1a1a] disabled:opacity-50"
        >
          Reset
        </button>
        <span className="self-center text-xs text-[#8a8075]">Last updated: {updatedLabel} UTC</span>
      </div>
    </div>
  )
}
