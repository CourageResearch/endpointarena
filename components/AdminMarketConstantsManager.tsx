'use client'

import { useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'

export interface MarketRuntimeConfigDto {
  warmupRunCount: number
  warmupMaxTradeUsd: number
  warmupBuyCashFraction: number
  openingLmsrB: number
  createdAt: string
  updatedAt: string
}

interface Props {
  initialConfig: MarketRuntimeConfigDto
}

type FormState = {
  warmupRunCount: string
  warmupMaxTradeUsd: string
  warmupBuyCashFraction: string
  openingLmsrB: string
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function parseField(value: string, fieldLabel: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a number`)
  }
  return parsed
}

function toFormState(config: MarketRuntimeConfigDto): FormState {
  return {
    warmupRunCount: String(config.warmupRunCount),
    warmupMaxTradeUsd: String(config.warmupMaxTradeUsd),
    warmupBuyCashFraction: String(config.warmupBuyCashFraction),
    openingLmsrB: String(config.openingLmsrB),
  }
}

export function AdminMarketConstantsManager({ initialConfig }: Props) {
  const [config, setConfig] = useState(initialConfig)
  const [form, setForm] = useState<FormState>(() => toFormState(initialConfig))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const parsedPreview = useMemo(() => {
    const warmupRunCount = Number(form.warmupRunCount)
    const warmupMaxTradeUsd = Number(form.warmupMaxTradeUsd)
    const warmupBuyCashFraction = Number(form.warmupBuyCashFraction)

    if (
      !Number.isFinite(warmupRunCount) ||
      !Number.isFinite(warmupMaxTradeUsd) ||
      !Number.isFinite(warmupBuyCashFraction)
    ) {
      return null
    }

    return {
      warmupRunCount,
      warmupMaxTradeUsd,
      warmupBuyCashFraction,
      buyCapAtStartingCash: Math.min(warmupMaxTradeUsd, 100_000 * warmupBuyCashFraction),
      buyCapAtTenThousandCash: Math.min(warmupMaxTradeUsd, 10_000 * warmupBuyCashFraction),
    }
  }, [form])

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
        warmupRunCount: parseField(form.warmupRunCount, 'Warm-up runs'),
        warmupMaxTradeUsd: parseField(form.warmupMaxTradeUsd, 'Warm-up max trade USD'),
        warmupBuyCashFraction: parseField(form.warmupBuyCashFraction, 'Warm-up buy cash fraction'),
        openingLmsrB: parseField(form.openingLmsrB, 'Opening LMSR b'),
      }

      const response = await fetch('/api/admin/market-config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to update market settings'))
      }

      const nextConfig = data.config as MarketRuntimeConfigDto
      setConfig(nextConfig)
      setForm(toFormState(nextConfig))
      setSuccessMessage('Settings saved.')
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
        <div className="rounded-lg border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {successMessage}
        </div>
      )}

      <section className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Warm-up Runs</span>
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              value={form.warmupRunCount}
              onChange={(e) => updateField('warmupRunCount', e.target.value)}
              className="w-full rounded-md border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
            <p className="text-xs text-[#8a8075]">How many opening daily cycles use the warm-up cap.</p>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Warm-up Max Trade (USD)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={form.warmupMaxTradeUsd}
              onChange={(e) => updateField('warmupMaxTradeUsd', e.target.value)}
              className="w-full rounded-md border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
            <p className="text-xs text-[#8a8075]">Absolute USD cap per action during warm-up.</p>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Warm-up Buy Cash Fraction</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.001}
              value={form.warmupBuyCashFraction}
              onChange={(e) => updateField('warmupBuyCashFraction', e.target.value)}
              className="w-full rounded-md border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
            <p className="text-xs text-[#8a8075]">Buy cap is min(max trade USD, cash * fraction).</p>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Opening LMSR b</span>
            <input
              type="number"
              min={1}
              step={1000}
              value={form.openingLmsrB}
              onChange={(e) => updateField('openingLmsrB', e.target.value)}
              className="w-full rounded-md border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
            <p className="text-xs text-[#8a8075]">Liquidity applied when a new market is opened.</p>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveConfig}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-sm bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            type="button"
            onClick={resetToCurrent}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-sm border border-[#e8ddd0] bg-white text-[#8a8075] hover:text-[#1a1a1a] disabled:opacity-50"
          >
            Reset
          </button>
          <span className="self-center text-xs text-[#8a8075]">Last updated: {updatedLabel} UTC</span>
        </div>
      </section>

      {parsedPreview && (
        <section className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
          <h3 className="text-sm font-semibold text-[#1a1a1a]">Preview</h3>
          <p className="text-xs text-[#8a8075] mt-1">Estimated caps based on current settings.</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Warm-up Window</p>
              <p className="text-sm font-semibold text-[#1a1a1a] mt-1">
                {parsedPreview.warmupRunCount} {parsedPreview.warmupRunCount === 1 ? 'run' : 'runs'}
              </p>
            </div>
            <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Buy Cap @ $100k cash</p>
              <p className="text-sm font-semibold text-[#1a1a1a] mt-1">{formatMoney(parsedPreview.buyCapAtStartingCash)}</p>
            </div>
            <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Buy Cap @ $10k cash</p>
              <p className="text-sm font-semibold text-[#1a1a1a] mt-1">{formatMoney(parsedPreview.buyCapAtTenThousandCash)}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
