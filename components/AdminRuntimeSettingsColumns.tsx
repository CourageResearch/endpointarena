'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'
import type { DatabaseTarget } from '@/lib/database-target'

export interface RuntimeSettingsConfigDto {
  toyTrialCount: number
  season4MarketLiquidityBDisplay: number
  season4HumanStartingBankrollDisplay: number
  season4StartingBankrollDisplay: number
  createdAt: string
  updatedAt: string
}

export interface RuntimeSettingsTargetDto {
  target: DatabaseTarget
  label: string
  databaseName: string | null
  configured: boolean
  isActive: boolean
  config: RuntimeSettingsConfigDto | null
  errorMessage: string | null
}

type RuntimeSettingsFormState = {
  liquidityB: string
  humanBankroll: string
  aiBankroll: string
  toyTrialCount: string
}

type RuntimeSettingsTargetState = {
  config: RuntimeSettingsConfigDto | null
  form: RuntimeSettingsFormState
  error: string | null
  success: string | null
}

type RuntimeSettingsTargetControlsProps = {
  target: RuntimeSettingsTargetDto
}

function toFormState(config: RuntimeSettingsConfigDto | null): RuntimeSettingsFormState {
  return {
    liquidityB: config ? String(config.season4MarketLiquidityBDisplay) : '',
    humanBankroll: config ? String(config.season4HumanStartingBankrollDisplay) : '',
    aiBankroll: config ? String(config.season4StartingBankrollDisplay) : '',
    toyTrialCount: config ? String(config.toyTrialCount) : '',
  }
}

function parseNumberField(value: string, label: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`)
  }
  if (parsed < minimum) {
    throw new Error(`${label} must be at least ${minimum}`)
  }
  return parsed
}

function parseIntegerField(value: string, label: string, minimum: number): number {
  const parsed = parseNumberField(value, label, minimum)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number`)
  }
  return parsed
}

function getUpdatedLabel(config: RuntimeSettingsConfigDto | null): string {
  if (!config) return 'Unavailable'
  return new Date(config.updatedAt).toLocaleString('en-US', { timeZone: 'UTC' })
}

export function AdminRuntimeSettingsTargetControls({ target }: RuntimeSettingsTargetControlsProps) {
  const router = useRouter()
  const [state, setState] = useState<RuntimeSettingsTargetState>(() => ({
    config: target.config,
    form: toFormState(target.config),
    error: null,
    success: null,
  }))
  const [isSaving, setIsSaving] = useState(false)
  const isDisabled = isSaving || !state.config || !target.configured

  const updateForm = (key: keyof RuntimeSettingsFormState, value: string) => {
    setState((current) => ({
      ...current,
      form: {
        ...current.form,
        [key]: value,
      },
      error: null,
      success: null,
    }))
  }

  const resetTarget = () => {
    setState((current) => ({
      ...current,
      form: toFormState(current.config),
      error: null,
      success: null,
    }))
  }

  const saveTarget = async () => {
    if (!state.config) return

    setIsSaving(true)
    setState((current) => ({
      ...current,
      error: null,
      success: null,
    }))

    try {
      const payload: Record<string, string | number> = {
        target: target.target,
        season4MarketLiquidityBDisplay: parseNumberField(state.form.liquidityB, 'Liquidity B', 1),
        season4HumanStartingBankrollDisplay: parseNumberField(state.form.humanBankroll, 'Human bankroll', 0),
        season4StartingBankrollDisplay: parseNumberField(state.form.aiBankroll, 'AI bankroll', 0),
      }

      if (target.target === 'toy') {
        payload.toyTrialCount = parseIntegerField(state.form.toyTrialCount, 'Toy DB trial count', 0)
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
        throw new Error(getApiErrorMessage(data, `Failed to update ${target.label} settings`))
      }

      const nextConfig = data.config as RuntimeSettingsConfigDto
      const faucetWarning = (data as {
        faucetSync?: {
          warning?: string | null
        }
      }).faucetSync?.warning

      setState({
        config: nextConfig,
        form: toFormState(nextConfig),
        error: null,
        success: faucetWarning ? `${target.label} settings saved. ${faucetWarning}` : `${target.label} settings saved.`,
      })

      if (target.target === 'toy') {
        window.dispatchEvent(new CustomEvent('endpointarena:trial-runtime-config-updated', {
          detail: {
            toyTrialCount: nextConfig.toyTrialCount,
            season4MarketLiquidityBDisplay: nextConfig.season4MarketLiquidityBDisplay,
          },
        }))
      }

      router.refresh()
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : `Failed to update ${target.label} settings`,
        success: null,
      }))
    } finally {
      setIsSaving(false)
    }
  }

  if (target.errorMessage || !target.config) {
    return (
      <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
        {target.errorMessage ?? `${target.label} runtime settings are unavailable.`}
      </div>
    )
  }

  return (
    <>
      {state.error ? (
        <div className="mb-3 rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="mb-3 rounded-none border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {state.success}
        </div>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Liquidity B</span>
            <input
              type="number"
              min={1}
              step={1}
            value={state.form.liquidityB}
            onChange={(event) => updateForm('liquidityB', event.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Human Bankroll</span>
          <input
            type="number"
            min={0}
            step={1}
            value={state.form.humanBankroll}
            onChange={(event) => updateForm('humanBankroll', event.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">AI Bankroll</span>
          <input
            type="number"
            min={0}
            step={1}
            value={state.form.aiBankroll}
            onChange={(event) => updateForm('aiBankroll', event.target.value)}
            className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
          />
        </label>

        {target.target === 'toy' ? (
          <label className="block space-y-1.5">
            <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">Toy DB Trial Count</span>
            <input
              type="number"
              min={0}
              step={1}
              value={state.form.toyTrialCount}
              onChange={(event) => updateForm('toyTrialCount', event.target.value)}
              className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
            />
          </label>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void saveTarget()}
          disabled={isDisabled}
          className="rounded-none bg-[#1a1a1a] px-4 py-2 text-sm text-white hover:bg-[#333] disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : `Save ${target.label}`}
        </button>
        <button
          type="button"
          onClick={resetTarget}
          disabled={isDisabled}
          className="rounded-none border border-[#e8ddd0] bg-white px-4 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      <p className="mt-3 text-xs text-[#8a8075]">
        Last updated: {getUpdatedLabel(state.config)} UTC
      </p>
    </>
  )
}
