'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiErrorMessage } from '@/lib/client-api'

export type AdminDatabaseTargetOptionDto = {
  target: 'main' | 'toy'
  label: string
  description: string
  configured: boolean
  databaseName: string | null
  usersCount: number | null
  trialsCount: number | null
  errorMessage: string | null
}

type TrialRuntimeConfigUpdatedEventDetail = {
  toyTrialCount?: number
}

type Props = {
  activeTarget: 'main' | 'toy'
  options: AdminDatabaseTargetOptionDto[]
  toyTrialCount: number
}

function formatCount(value: number | null): string {
  return value == null ? '-' : value.toLocaleString('en-US')
}

export function AdminDatabaseTargetManager({ activeTarget, options, toyTrialCount }: Props) {
  const router = useRouter()
  const [pendingTarget, setPendingTarget] = useState<'main' | 'toy' | null>(null)
  const [isResettingToy, setIsResettingToy] = useState(false)
  const [currentToyTrialCount, setCurrentToyTrialCount] = useState(toyTrialCount)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    setCurrentToyTrialCount(toyTrialCount)
  }, [toyTrialCount])

  useEffect(() => {
    const handleConfigUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<TrialRuntimeConfigUpdatedEventDetail>
      if (typeof customEvent.detail?.toyTrialCount === 'number') {
        setCurrentToyTrialCount(customEvent.detail.toyTrialCount)
      }
    }

    window.addEventListener('endpointarena:trial-runtime-config-updated', handleConfigUpdated as EventListener)
    return () => {
      window.removeEventListener('endpointarena:trial-runtime-config-updated', handleConfigUpdated as EventListener)
    }
  }, [])

  const switchTarget = async (target: 'main' | 'toy') => {
    if (target === activeTarget || pendingTarget || isResettingToy) {
      return
    }

    setPendingTarget(target)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/admin/database-target', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to switch database target'))
      }

      setSuccessMessage(`Switched the running app to ${target === 'main' ? 'Main DB' : 'Toy DB'}. Refreshing site data...`)
      router.refresh()
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : 'Failed to switch database target')
    } finally {
      setPendingTarget(null)
    }
  }

  const resetToyDatabase = async () => {
    if (isResettingToy || pendingTarget) {
      return
    }

    setIsResettingToy(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/admin/toy-db/reset', {
        method: 'POST',
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to reset Toy DB'))
      }

      const summary = (payload as {
        summary?: {
          toyTrialCount?: number
        }
      }).summary
      const resolvedToyTrialCount = summary?.toyTrialCount

      setSuccessMessage(
        `Toy DB reset to a clean slate with ${typeof resolvedToyTrialCount === 'number' ? resolvedToyTrialCount : 'the configured number of'} trial${resolvedToyTrialCount === 1 ? '' : 's'}. Refreshing site data...`
      )
      router.refresh()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset Toy DB')
    } finally {
      setIsResettingToy(false)
    }
  }

  return (
    <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
      <div>
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Site Database</h3>
      </div>

      {error ? (
        <div className="mt-4 rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div className="mt-4 rounded-none border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {successMessage}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {options.map((option) => {
          const isActive = option.target === activeTarget
          const isPending = pendingTarget === option.target
          const isBusy = pendingTarget != null || isResettingToy
          const disabled = !option.configured || isPending || isBusy || isActive
          const canResetToy = option.target === 'toy' && option.configured
          const showToyResetTarget = option.target === 'toy'

          return (
            <article key={option.target} className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-[#1a1a1a]">{option.label}</h4>
                  <p className="mt-1 text-xs leading-5 text-[#8a8075]">{option.description}</p>
                </div>
                <span className={`rounded-none px-2 py-1 text-xs font-medium ${
                  isActive
                    ? 'bg-[#3a8a2e]/10 text-[#2f6f24]'
                    : option.configured
                      ? 'bg-[#F5F2ED] text-[#6f665b]'
                      : 'bg-[#EF6F67]/10 text-[#8d2c22]'
                }`}>
                  {isActive ? 'Active' : option.configured ? 'Available' : 'Unavailable'}
                </span>
              </div>

              <div className="mt-3 space-y-2 text-sm text-[#5b5148]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Database</span>
                    <div className="mt-1 font-medium text-[#1a1a1a]">{option.databaseName ?? 'Not configured'}</div>
                  </div>
                  {canResetToy ? (
                    <button
                      type="button"
                      onClick={() => void resetToyDatabase()}
                      disabled={isBusy}
                      className="shrink-0 rounded-none border border-[#c43a2b]/25 bg-[#fff5f4] px-3 py-2 text-sm font-medium text-[#8d2c22] transition-colors hover:bg-[#fde9e7] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isResettingToy ? 'Resetting...' : 'Reset Toy DB'}
                    </button>
                  ) : null}
                </div>

                <div className={`grid gap-2 ${showToyResetTarget ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Users</div>
                    <div className="mt-1 font-medium text-[#1a1a1a]">{formatCount(option.usersCount)}</div>
                  </div>

                  <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Trials</div>
                    <div className="mt-1 font-medium text-[#1a1a1a]">{formatCount(option.trialsCount)}</div>
                  </div>

                  {showToyResetTarget ? (
                    <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Reset Target</div>
                      <div className="mt-1 font-medium text-[#1a1a1a]">
                        {currentToyTrialCount.toLocaleString('en-US')}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {option.errorMessage ? (
                <div className="mt-3 rounded-none border border-[#c43a2b]/25 bg-[#fff5f4] px-3 py-2 text-xs leading-5 text-[#8d2c22]">
                  {option.errorMessage}
                </div>
              ) : null}

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void switchTarget(option.target)}
                  disabled={disabled}
                  className="w-full rounded-none border border-[#d9cdbf] bg-white px-3 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isActive ? 'Currently Active' : isPending ? 'Switching...' : `Switch to ${option.label}`}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
