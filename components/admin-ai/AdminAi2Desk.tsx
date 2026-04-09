'use client'

import { Fragment, startTransition, useEffect, useMemo, useState } from 'react'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import {
  AI2_SUBSCRIPTION_MODEL_IDS,
  type Ai2AvailableModel,
  type Ai2BatchState,
  type Ai2Dataset,
  type Ai2DeskState,
  type Ai2SubscriptionModelId,
} from '@/lib/admin-ai2-shared'

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function isTerminal(status: Ai2BatchState['status'] | undefined): boolean {
  return status === 'cleared' || status === 'failed' || status === 'reset'
}

function laneStatusLabel(status: string): string {
  if (status === 'staged') return 'Staged'
  if (status === 'collecting') return 'Collecting'
  if (status === 'waiting') return 'Waiting'
  if (status === 'ready') return 'Ready'
  if (status === 'clearing') return 'Clearing'
  if (status === 'done') return 'Done'
  if (status === 'failed') return 'Failed'
  return status
}

function getDeskStatusLabel(batch: Ai2BatchState | null): string {
  if (!batch) return 'Idle'
  if (!batch.runStartedAt) return 'Staged'
  if (batch.status === 'cleared') return 'Completed'
  if (batch.status === 'reset') return 'Reset'
  return laneStatusLabel(batch.status)
}

function getDeskStatusDetail(batch: Ai2BatchState | null): string {
  if (!batch) {
    return 'Stage a batch to start a new run.'
  }

  if (!batch.runStartedAt) {
    return 'Batch is staged. Import any subscription outputs, then click Run Batch.'
  }

  if (batch.status === 'collecting' || batch.status === 'waiting') {
    return 'Model decisions are still coming in. The AMM has not executed yet.'
  }

  if (batch.status === 'ready') {
    return 'All model decisions are in. The batch is ready to clear.'
  }

  if (batch.status === 'clearing') {
    return 'The batch is executing against the shared AMM now.'
  }

  if (batch.status === 'cleared') {
    return 'All model decisions are in, the AMM trades were executed, and this batch is final.'
  }

  if (batch.status === 'failed') {
    const hasSuccessfulFill = batch.fills.some((fill) => fill.status === 'ok')
    return hasSuccessfulFill
      ? 'A task failed after live AMM movement. Reset and stage a fresh batch to preserve fairness.'
      : 'A task failed before clearing completed. You can retry the failed task in place.'
  }

  if (batch.status === 'reset') {
    return 'This batch was reset.'
  }

  return 'Batch state updated.'
}

function chipClass(status: string): string {
  if (status === 'collecting' || status === 'running' || status === 'clearing') return 'border-[#5BA5ED]/40 bg-[#5BA5ED]/10 text-[#265f8f]'
  if (status === 'ready' || status === 'done' || status === 'cleared') return 'border-[#3a8a2e]/30 bg-[#3a8a2e]/10 text-[#2f6f24]'
  if (status === 'failed' || status === 'error') return 'border-[#c43a2b]/30 bg-[#fff3f1] text-[#8d2c22]'
  return 'border-[#d8ccb9] bg-[#f8f4ee] text-[#6f665b]'
}

function getOrderBookTaskBadge(task: Ai2BatchState['tasks'][number]): string {
  if (task.fill?.status === 'ok' || task.status === 'cleared') return 'DONE'
  if (task.fill?.status === 'error' || task.status === 'error') return 'FAILED'
  if (task.status === 'waiting-import') return 'WAITING'
  if (task.status === 'running') return 'RUNNING'
  if (task.status === 'ready') return 'READY'
  return 'QUEUED'
}

function getOrderBookTaskTone(task: Ai2BatchState['tasks'][number]): string {
  return chipClass(task.fill?.status === 'error' ? 'error' : task.fill?.status === 'ok' ? 'done' : task.status)
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Request failed'))
  }
  return payload as T
}

function getDefaultEnabledModels(availableModels: Ai2AvailableModel[]): Ai2AvailableModel['modelId'][] {
  return availableModels.filter((model) => model.defaultEnabled).map((model) => model.modelId)
}

function getLaneStatus(batch: Ai2BatchState | null, modelIds: string[]): string {
  if (!batch) return 'waiting'

  const tasks = batch.tasks.filter((task) => modelIds.includes(task.modelId))
  if (tasks.length === 0) return 'waiting'
  if (tasks.some((task) => task.status === 'error')) return 'failed'
  if (batch.status === 'clearing') return 'clearing'
  if (tasks.every((task) => task.status === 'cleared')) return 'done'
  if (tasks.every((task) => task.status === 'ready' || task.status === 'cleared')) return 'ready'
  if (!batch.runStartedAt) return 'waiting'
  if (tasks.some((task) => task.status === 'waiting-import')) return 'waiting'
  return 'collecting'
}

type Props = {
  initialState: Ai2DeskState
}

export function AdminAi2Desk({ initialState }: Props) {
  const [deskState, setDeskState] = useState(initialState)
  const [dataset, setDataset] = useState<Ai2Dataset>(initialState.batch?.dataset ?? initialState.dataset)
  const [selectedModels, setSelectedModels] = useState<Ai2AvailableModel['modelId'][]>(
    initialState.batch?.enabledModelIds ?? getDefaultEnabledModels(initialState.availableModels),
  )
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(initialState.batch?.trials[0]?.marketId ?? null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)
  const [exportPackets, setExportPackets] = useState<Record<string, string>>({})
  const [importTexts, setImportTexts] = useState<Record<string, string>>({})
  const [copiedPacketModelId, setCopiedPacketModelId] = useState<Ai2SubscriptionModelId | null>(null)

  const batch = deskState.batch
  const availableModelById = useMemo(() => (
    new Map(deskState.availableModels.map((model) => [model.modelId, model] as const))
  ), [deskState.availableModels])

  useEffect(() => {
    if (!batch?.trials.length) {
      setSelectedMarketId(null)
      return
    }
    if (!selectedMarketId || !batch.trials.some((trial) => trial.marketId === selectedMarketId)) {
      setSelectedMarketId(batch.trials[0].marketId)
    }
  }, [batch, selectedMarketId])

  useEffect(() => {
    if (!batch || isTerminal(batch.status)) return

    const source = new EventSource(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/stream`)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; batch?: Ai2BatchState; message?: string }
        if (payload.type === 'state' && payload.batch) {
          startTransition(() => {
            setDeskState((current) => ({
              ...current,
              batch: payload.batch ?? current.batch,
            }))
          })
        }
        if (payload.type === 'error' && payload.message) {
          setUiError(payload.message)
        }
      } catch {
        setUiError('Failed to parse AI stream update.')
      }
    }
    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [batch?.id, batch?.status])

  useEffect(() => {
    if (!batch || batch.runStartedAt || isTerminal(batch.status) || busyKey != null) {
      return
    }

    const modelIdsToExport = AI2_SUBSCRIPTION_MODEL_IDS.filter((modelId) => (
      batch.enabledModelIds.includes(modelId) && !exportPackets[modelId]?.trim()
    ))

    if (modelIdsToExport.length === 0) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const packets = await Promise.all(modelIdsToExport.map(async (modelId) => {
          const payload = await fetchJson<{ packet: unknown }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/subscription/export?modelId=${encodeURIComponent(modelId)}`, {
            method: 'POST',
          })
          return [modelId, JSON.stringify(payload.packet, null, 2)] as const
        }))

        if (cancelled) {
          return
        }

        setExportPackets((current) => {
          const next = { ...current }
          for (const [modelId, packet] of packets) {
            next[modelId] = packet
          }
          return next
        })
      } catch (error) {
        if (!cancelled) {
          setUiError(error instanceof Error ? error.message : 'Failed to export packet')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [batch, busyKey, exportPackets])

  const selectedTrial = useMemo(() => (
    batch?.trials.find((trial) => trial.marketId === selectedMarketId) ?? batch?.trials[0] ?? null
  ), [batch, selectedMarketId])

  const orderedModelIds = useMemo<Ai2AvailableModel['modelId'][]>(() => {
    if (batch) {
      return batch.clearOrder.filter((modelId) => batch.enabledModelIds.includes(modelId))
    }
    return selectedModels
  }, [batch, selectedModels])

  const selectedTasks = useMemo(() => {
    if (!batch || !selectedTrial) return []
    const order = new Map(orderedModelIds.map((modelId, index) => [modelId, index] as const))
    return batch.tasks
      .filter((task) => task.marketId === selectedTrial.marketId)
      .sort((a, b) => (order.get(a.modelId) ?? 0) - (order.get(b.modelId) ?? 0))
  }, [batch, orderedModelIds, selectedTrial])

  const pendingSubscriptionImports = useMemo(() => (
    batch?.tasks.filter((task) => task.lane === 'subscription' && task.status === 'waiting-import').length ?? 0
  ), [batch])
  const canRunBatch = Boolean(batch && !batch.runStartedAt && pendingSubscriptionImports === 0 && !isTerminal(batch.status))
  const successfulFillCount = useMemo(() => (
    batch?.fills.filter((fill) => fill.status === 'ok').length ?? 0
  ), [batch])

  const apiModels = useMemo(() => deskState.availableModels.filter((model) => model.lane === 'api').map((model) => model.modelId), [deskState.availableModels])
  const laneCards = useMemo(() => {
    return [
      {
        id: 'api',
        label: 'API Lane',
        description: 'API-backed models stay queued until you click Run Batch, then they execute in parallel.',
        status: getLaneStatus(batch, apiModels),
        modelIds: apiModels,
      },
      {
        id: 'claude-opus',
        label: 'Claude Subscription',
        description: 'Export Claude tasks, run them in your subscription workflow, then import JSON.',
        status: getLaneStatus(batch, ['claude-opus']),
        modelIds: ['claude-opus'],
      },
      {
        id: 'gpt-5.2',
        label: 'OpenAI Subscription',
        description: 'Export GPT tasks, run them in your subscription workflow, then import JSON.',
        status: getLaneStatus(batch, ['gpt-5.2']),
        modelIds: ['gpt-5.2'],
      },
    ]
  }, [apiModels, batch])

  async function refreshState(nextDataset: Ai2Dataset) {
    const response = await fetchJson<Ai2DeskState>(`/api/admin/ai/state?dataset=${encodeURIComponent(nextDataset)}`)
    startTransition(() => {
      setDeskState(response)
      setDataset(nextDataset)
      setSelectedModels(response.batch?.enabledModelIds ?? getDefaultEnabledModels(response.availableModels))
      setExportPackets({})
      setImportTexts({})
    })
  }

  async function openBatch() {
    setBusyKey('open')
    setUiError(null)
    try {
      const payload = await fetchJson<{ batch: Ai2BatchState }>('/api/admin/ai/batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataset,
          enabledModelIds: selectedModels,
        }),
      })
      startTransition(() => {
        setDeskState((current) => ({ ...current, batch: payload.batch }))
      })
      startTransition(() => {
        setExportPackets({})
        setImportTexts({})
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to open batch')
    } finally {
      setBusyKey(null)
    }
  }

  async function resetBatch() {
    if (!batch) return
    setBusyKey('reset')
    setUiError(null)
    try {
      const response = await fetch(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/reset`, { method: 'POST' })
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, 'Failed to reset batch'))
      }
      await refreshState(dataset)
      startTransition(() => {
        setDeskState((current) => ({ ...current, batch: null }))
        setExportPackets({})
        setImportTexts({})
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to reset batch')
    } finally {
      setBusyKey(null)
    }
  }

  async function importPacket(modelId: Ai2SubscriptionModelId) {
    if (!batch) return
    const text = importTexts[modelId]?.trim()
    if (!text) {
      setUiError('Paste a decision JSON payload before importing.')
      return
    }

    setBusyKey(`import:${modelId}`)
    setUiError(null)
    try {
      let requestBody: unknown

      try {
        requestBody = JSON.parse(text)
      } catch {
        requestBody = {
          batchId: batch.id,
          modelId,
          rawText: text,
        }
      }

      const payload = await fetchJson<{ batch: Ai2BatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/subscription/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      startTransition(() => {
        setDeskState((current) => ({ ...current, batch: payload.batch }))
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to import packet')
    } finally {
      setBusyKey(null)
    }
  }

  async function copyExportPacket(modelId: Ai2SubscriptionModelId) {
    const packet = exportPackets[modelId]?.trim()
    if (!packet) return

    setUiError(null)

    try {
      await navigator.clipboard.writeText(packet)
      setCopiedPacketModelId(modelId)
      window.setTimeout(() => {
        setCopiedPacketModelId((current) => (current === modelId ? null : current))
      }, 1500)
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to copy packet')
    }
  }

  async function runBatchNow() {
    if (!batch) return
    setBusyKey('run')
    setUiError(null)
    try {
      const payload = await fetchJson<{ batch: Ai2BatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/run`, {
        method: 'POST',
      })
      startTransition(() => {
        setDeskState((current) => ({ ...current, batch: payload.batch }))
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to run batch')
    } finally {
      setBusyKey(null)
    }
  }

  async function retryTask(taskKey: string) {
    if (!batch) return
    setBusyKey(`retry:${taskKey}`)
    setUiError(null)
    try {
      const payload = await fetchJson<{ batch: Ai2BatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/tasks/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskKey }),
      })
      startTransition(() => {
        setDeskState((current) => ({ ...current, batch: payload.batch }))
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to retry task')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <section className="hidden">
        {batch ? (
          <div className="border border-[#d8ccb9] bg-[#fcfaf7] px-3 py-3 text-sm text-[#6f665b]">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Clear Order</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {orderedModelIds.map((modelId, index) => (
                <Fragment key={`order-top:${modelId}`}>
                  <span className="border border-[#d8ccb9] bg-white px-3 py-2 text-sm font-medium text-[#1a1a1a]">
                    {availableModelById.get(modelId)?.label ?? modelId}
                  </span>
                  {index < orderedModelIds.length - 1 ? (
                    <span className="text-sm text-[#8a8075]">→</span>
                  ) : null}
                </Fragment>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="border border-[#e8ddd0] bg-white/85 p-5">
        <div className="flex flex-col gap-5">
          <div className="hidden">
            {deskState.datasets.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => void refreshState(entry.key)}
                className={`border px-4 py-2 text-sm ${dataset === entry.key ? 'border-[#c9b59a] bg-[#efe5d7] text-[#5b4d3f]' : 'border-[#d8ccb9] bg-[#f8f4ee] text-[#6f665b]'}`}
              >
                {entry.label} · {entry.candidateCount}
              </button>
            ))}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Enabled Models</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {deskState.availableModels.map((model) => {
                const checked = selectedModels.includes(model.modelId)
                const disabled = Boolean(batch && !isTerminal(batch.status)) || !model.available
                return (
                  <label key={model.modelId} className={`border px-3 py-2 text-sm ${checked ? 'border-[#c9b59a] bg-[#efe5d7] text-[#5b4d3f]' : 'border-[#d8ccb9] bg-white text-[#5f564c]'} ${disabled ? 'opacity-60' : ''}`}>
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => {
                        setSelectedModels((current) => (
                          checked
                            ? current.filter((entry) => entry !== model.modelId)
                            : [...current, model.modelId]
                        ))
                      }}
                    />
                    {model.label}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void openBatch()}
              disabled={busyKey != null || (batch != null && !isTerminal(batch.status))}
              className="border border-[#c1ab8e] bg-[#eadfce] px-5 py-3 text-sm font-medium text-[#5b4d3f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyKey === 'open' ? 'Staging...' : 'Stage Batch'}
            </button>
            <button
              type="button"
              onClick={() => void resetBatch()}
              disabled={!batch || busyKey != null}
              className="border border-[#d8ccb9] bg-[#f8f4ee] px-5 py-3 text-sm font-medium text-[#6f665b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyKey === 'reset' ? 'Resetting...' : 'Reset Batch'}
            </button>
            {batch && !batch.runStartedAt ? (
              <button
                type="button"
                onClick={() => void runBatchNow()}
                disabled={busyKey != null || !canRunBatch}
                className="border border-[#3a8a2e] bg-[#3a8a2e] px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyKey === 'run' ? 'Running...' : 'Run Batch'}
              </button>
            ) : null}
          </div>
          <div className="border border-[#d8ccb9] bg-white/80 p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Desk Status</p>
            <p className="mt-2 text-sm font-medium text-[#1a1a1a]">{getDeskStatusLabel(batch)}</p>
            <p className="mt-2 text-xs leading-5 text-[#6f665b]">{getDeskStatusDetail(batch)}</p>
          </div>
          {batch && !batch.runStartedAt ? (
            <div className="border border-[#d8ccb9] bg-[#f8f4ee] px-3 py-2 text-sm text-[#6f665b]">
              {pendingSubscriptionImports > 0
                ? `Batch is staged. Import ${pendingSubscriptionImports} remaining subscription task${pendingSubscriptionImports === 1 ? '' : 's'} before running.`
                : 'Batch is staged. The API lane is idle, and everything starts only after you click Run Batch.'}
            </div>
          ) : null}
          {batch?.runStartedAt && !isTerminal(batch.status) ? (
            <div className="border border-[#5BA5ED]/30 bg-[#5BA5ED]/10 px-3 py-2 text-sm text-[#265f8f]">
              Run is live. Decisions and shared-market clearing will keep updating here until the batch is done.
            </div>
          ) : null}
          {batch?.status === 'failed' && successfulFillCount === 0 ? (
            <div className="border border-[#c9982b]/30 bg-[#fff7e5] px-3 py-2 text-sm text-[#8a6418]">
              A task failed before any live-market fill happened. You can retry the failed task and keep the same frozen snapshot and clear order.
            </div>
          ) : null}
          {batch?.status === 'failed' && successfulFillCount > 0 ? (
            <div className="border border-[#c43a2b]/30 bg-[#fff3f1] px-3 py-2 text-sm text-[#8d2c22]">
              Clearing already touched the live AMM before the failure. To preserve fairness, reset this batch and stage a fresh one instead of retrying in place.
            </div>
          ) : null}
          {batch?.status === 'cleared' ? (
            <div className="border border-[#3a8a2e]/30 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2f6f24]">
              Batch complete. All selected models have finished, and the AMM clearing tape is final.
            </div>
          ) : null}
          {uiError ? (
            <div className="border border-[#c43a2b]/30 bg-[#fff3f1] px-3 py-2 text-sm text-[#8d2c22]">{uiError}</div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr,1.6fr]">
        <div className="hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">1. Batch Snapshot</p>
              <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Frozen trial slate</h3>
            </div>
            <p className="text-xs text-[#8a8075]">{batch ? `${batch.trials.length} trial${batch.trials.length === 1 ? '' : 's'}` : 'No active batch'}</p>
          </div>
          <div className="mt-4 space-y-3">
            {batch ? batch.trials.map((trial) => {
              const active = selectedTrial?.marketId === trial.marketId
              return (
                <button
                  key={trial.marketId}
                  type="button"
                  onClick={() => setSelectedMarketId(trial.marketId)}
                  className={`w-full border px-4 py-4 text-left transition-colors ${active ? 'border-[#c7b197] bg-[#f3e8da] text-[#4f4337]' : 'border-[#d8ccb9] bg-[#fcfaf7] text-[#1a1a1a]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{trial.shortTitle}</p>
                      <p className={`mt-1 text-xs ${active ? 'text-[#7b6b5a]' : 'text-[#8a8075]'}`}>{trial.sponsorName}{trial.nctNumber ? ` · ${trial.nctNumber}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[11px] uppercase tracking-[0.08em] ${active ? 'text-[#7b6b5a]' : 'text-[#8a8075]'}`}>Start Price</p>
                      <p className="mt-1 text-sm font-medium">{formatPercent(trial.marketSnapshot.priceYes)} yes</p>
                    </div>
                  </div>
                  <div className={`mt-3 grid grid-cols-2 gap-2 text-xs ${active ? 'text-[#6a5a49]' : 'text-[#6f665b]'}`}>
                    <p>Decision date: {formatDate(trial.decisionDate)}</p>
                    <p>Expected models: {batch.enabledModelIds.length}</p>
                  </div>
                </button>
              )
            }) : (
              <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
                Stage a batch to freeze the trial research snapshot and publish the clearing order.
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">2. Research Lanes</p>
          <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Parallel decision collection</h3>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {laneCards.map((lane) => {
              const laneActive = batch
                ? lane.modelIds.some((modelId) => batch.enabledModelIds.includes(modelId as (typeof batch.enabledModelIds)[number]))
                : false
              const laneTasks = batch?.tasks.filter((task) => lane.modelIds.includes(task.modelId)) ?? []
              const failedLaneTasks = laneTasks.filter((task) => task.status === 'error')
              const firstFailedLaneTask = failedLaneTasks[0] ?? null

              return (
              <div key={lane.id} className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">{lane.label}</p>
                    {batch && !laneActive ? (
                      <p className="mt-2 text-[11px] uppercase tracking-[0.08em] text-[#b26a25]">Not enabled in this batch</p>
                    ) : null}
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${chipClass(lane.status)}`}>
                    {laneStatusLabel(lane.status)}
                  </span>
                </div>
                {lane.id === 'claude-opus' || lane.id === 'gpt-5.2' ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!batch || !laneActive || busyKey != null || !importTexts[lane.id]?.trim()}
                        onClick={() => void importPacket(lane.id as Ai2SubscriptionModelId)}
                        className="border border-[#c1ab8e] bg-[#eadfce] px-3 py-2 text-xs font-medium text-[#5b4d3f] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyKey === `import:${lane.id}` ? 'Importing...' : 'Import JSON'}
                      </button>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        disabled={!exportPackets[lane.id]?.trim()}
                        onClick={() => void copyExportPacket(lane.id as Ai2SubscriptionModelId)}
                        title={copiedPacketModelId === lane.id ? 'Copied' : 'Copy export packet'}
                        aria-label={copiedPacketModelId === lane.id ? 'Copied' : 'Copy export packet'}
                        className={`absolute top-3 right-8 z-10 inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          copiedPacketModelId === lane.id
                            ? 'bg-[#efe5d7] text-[#5b4d3f]'
                            : 'bg-transparent text-[#5f564c] hover:bg-[#f3ebe0]'
                        }`}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className="h-4.5 w-4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="7" y="7" width="9" height="9" rx="1.5" />
                          <rect x="3" y="3" width="9" height="9" rx="1.5" />
                        </svg>
                      </button>
                      <textarea
                        value={exportPackets[lane.id] ?? ''}
                        readOnly
                        placeholder={laneActive ? 'Export packet appears here.' : 'Enable this model when opening the batch to export this lane.'}
                        className="min-h-[110px] w-full border border-[#e8ddd0] bg-white px-3 pt-7 pr-16 pb-2 text-xs text-[#5f564c] placeholder-[#b5aa9e] focus:outline-none"
                      />
                    </div>
                    <textarea
                      value={importTexts[lane.id] ?? ''}
                      onChange={(event) => setImportTexts((current) => ({ ...current, [lane.id]: event.target.value }))}
                      placeholder={laneActive ? 'Paste the import JSON or the raw Claude/ChatGPT response here.' : 'Enable this model when opening the batch to use this lane.'}
                      className="min-h-[110px] w-full border border-[#e8ddd0] bg-white px-3 py-2 text-xs text-[#5f564c] placeholder-[#b5aa9e] focus:outline-none"
                      disabled={!laneActive}
                    />
                  </div>
                ) : (
                  <div className="mt-4 rounded border border-[#e8ddd0] bg-white px-3 py-3 text-xs text-[#6f665b]">
                    {batch ? `${batch.tasks.filter((task) => apiModels.includes(task.modelId)).length} API task${batch.tasks.filter((task) => apiModels.includes(task.modelId)).length === 1 ? '' : 's'} in this batch.` : 'API tasks stay idle until you stage a batch and click Run Batch.'}
                  </div>
                )}
                {firstFailedLaneTask ? (
                  <div className="mt-3 border border-[#c43a2b]/30 bg-[#fff3f1] px-3 py-3 text-xs text-[#8d2c22]">
                    <p className="font-medium">
                      {failedLaneTasks.length} failed task{failedLaneTasks.length === 1 ? '' : 's'} in this lane.
                    </p>
                    <p className="mt-1">
                      {firstFailedLaneTask.modelId} on {batch?.trials.find((trial) => trial.marketId === firstFailedLaneTask.marketId)?.nctNumber ?? firstFailedLaneTask.marketId}
                    </p>
                    <p className="mt-2 leading-5">
                      {firstFailedLaneTask.errorMessage ?? batch?.failureMessage ?? 'The lane hit an error before returning a decision.'}
                    </p>
                  </div>
                ) : null}
              </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="border border-[#e8ddd0] bg-white/85 p-5">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">3. Order Book</p>
            <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Batch-wide decision matrix</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6f665b]">
              Trial rows, progress in the middle, and one model column per clearing slot. Click any row to inspect the full reasoning below.
            </p>
          </div>
        </div>
        {batch?.trials.length ? (
          <div className="mt-4">
            <div className="max-h-[72vh] overflow-auto rounded-none border border-[#e8ddd0] bg-white">
              <table className="min-w-[1140px] w-full border-separate border-spacing-0">
                <thead>
                  <tr className="bg-[#f8f4ee]">
                    <th className="sticky left-0 top-0 z-30 w-[190px] min-w-[190px] max-w-[190px] border-b border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8075] shadow-[1px_0_0_0_#e8ddd0]">
                      Trial
                    </th>
                    <th className="sticky top-0 z-20 min-w-[132px] border-b border-l border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8075]">
                      Progress
                    </th>
                    {orderedModelIds.map((modelId, index) => {
                      const model = availableModelById.get(modelId)
                      return (
                        <th
                          key={modelId}
                          className="sticky top-0 z-20 min-w-[160px] border-b border-l border-[#e8ddd0] bg-[#f8f4ee] px-3 py-2 text-left align-top"
                        >
                          <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Model {index + 1}</p>
                          <p className="mt-1 text-xs font-medium text-[#1a1a1a]">{availableModelById.get(modelId)?.label ?? modelId}</p>
                          <p className="mt-1 text-[11px] text-[#6f665b]">
                            {model?.lane === 'subscription' ? 'Subscription lane' : 'API lane'}
                          </p>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {batch.trials.map((trial, trialIndex) => {
                    const trialTasks = batch.tasks.filter((task) => task.marketId === trial.marketId)
                    const taskByModel = new Map(trialTasks.map((task) => [task.modelId, task] as const))
                    const closedCount = trialTasks.filter((task) => task.status === 'ready' || task.status === 'error' || task.status === 'cleared').length
                    const readyCount = trialTasks.filter((task) => task.status === 'ready' || task.status === 'cleared').length
                    const filledCount = trialTasks.filter((task) => task.fill?.status === 'ok').length
                    const active = selectedTrial?.marketId === trial.marketId
                    const stickyCellClass = active ? 'bg-[#fcf7f0]' : 'bg-white'
                    const progressCellClass = active ? 'bg-[#f8f1e6]' : 'bg-[#fcfaf7]'
                    const rowCellClass = active ? 'bg-[#fffdf9]' : 'bg-white'

                    return (
                      <tr
                        key={trial.marketId}
                        className="align-top cursor-pointer"
                        onClick={() => setSelectedMarketId(trial.marketId)}
                      >
                        <td className={`sticky left-0 z-10 w-[190px] min-w-[190px] max-w-[190px] border-t border-[#e8ddd0] px-3 py-3 shadow-[1px_0_0_0_#e8ddd0] ${stickyCellClass}`}>
                          <p className="truncate text-sm font-medium text-[#1a1a1a]" title={trial.nctNumber ?? trial.shortTitle}>
                            {trialIndex + 1}. {trial.nctNumber?.trim() || trial.shortTitle}
                          </p>
                        </td>
                        <td className={`border-l border-t border-[#e8ddd0] px-3 py-3 ${progressCellClass}`}>
                          <p className="text-sm font-medium text-[#1a1a1a]">
                            {closedCount}/{orderedModelIds.length || trialTasks.length}
                          </p>
                          <p className="mt-2 text-xs text-[#6f665b]">
                            {filledCount > 0
                              ? `${filledCount} filled`
                              : readyCount > 0
                                ? `${readyCount} ready`
                                : 'Waiting'}
                          </p>
                          <p className="mt-2 text-[11px] text-[#8a8075]">{formatPercent(trial.marketSnapshot.priceYes)} start yes</p>
                        </td>
                        {orderedModelIds.map((modelId, index) => {
                          const task = taskByModel.get(modelId)
                          const model = availableModelById.get(modelId)

                          if (!task) {
                            return (
                              <td
                                key={`${trial.marketId}:${modelId}`}
                                className={`border-l border-t border-[#e8ddd0] px-3 py-2 align-top ${rowCellClass}`}
                              >
                                <p className="text-xs text-[#8a8075]">{model?.available === false ? 'Unavailable' : 'Not scheduled'}</p>
                              </td>
                            )
                          }

                          const primaryDetail = task.fill
                            ? `Filled ${task.fill.executedAction}${task.fill.executedAmountUsd > 0 ? ` ${formatUsd(task.fill.executedAmountUsd)}` : ''}`
                            : task.decision
                              ? `${task.decision.forecast.binaryCall.toUpperCase()} / ${task.decision.forecast.confidence} / ${task.decision.action.type}${task.decision.action.amountUsd > 0 ? ` ${formatUsd(task.decision.action.amountUsd)}` : ''}`
                              : task.status === 'error'
                                ? 'Decision failed'
                                : !batch.runStartedAt && task.lane === 'api'
                                  ? 'Queued for Run Batch'
                                  : task.status === 'waiting-import'
                                    ? 'Waiting for import'
                                    : task.status === 'running'
                                      ? 'Computing decision'
                                      : 'Waiting for decision'
                          const secondaryDetail = task.fill
                            ? `Price ${formatPercent(task.fill.priceBefore)} to ${formatPercent(task.fill.priceAfter)}`
                            : task.decision
                              ? truncateText(task.decision.action.explanation || task.reasoningPreview || task.decision.forecast.reasoning, 92)
                              : task.status === 'error'
                                ? truncateText(task.errorMessage ?? batch.failureMessage ?? 'Task failed before returning a decision.', 92)
                                : !batch.runStartedAt && task.lane === 'api'
                                  ? 'Queued until you click Run Batch.'
                                  : task.status === 'waiting-import'
                                    ? 'Waiting for subscription JSON.'
                                    : task.status === 'running'
                                      ? 'The API lane is evaluating this trial now.'
                                      : 'Still waiting for this lane to return.'

                          return (
                            <td
                              key={task.taskKey}
                              className={`border-l border-t border-[#e8ddd0] px-3 py-2 align-top ${rowCellClass}`}
                            >
                              <div className="flex items-start gap-1.5">
                                <span className={`rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${getOrderBookTaskTone(task)}`}>
                                  {getOrderBookTaskBadge(task)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-4 text-[#5f564c]">{primaryDetail}</p>
                              <p className="mt-1 text-[11px] leading-4 text-[#6f665b]">{secondaryDetail}</p>
                              {task.estimatedCostUsd ? (
                                <p className="mt-1 text-[11px] text-[#8a8075]">{formatUsd(task.estimatedCostUsd)} est.</p>
                              ) : null}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {selectedTrial ? (
          <div className="mt-4">
            <div className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Selected Trial Detail</p>
                  <h4 className="mt-1 text-base font-semibold text-[#1a1a1a]">{selectedTrial.shortTitle}</h4>
                  <p className="mt-2 text-sm leading-6 text-[#6f665b]">{selectedTrial.briefSummary}</p>
                </div>
                <div className="hidden">
                  <div className="hidden">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Frozen Start</p>
                    <p className="mt-2">Price: {formatPercent(selectedTrial.marketSnapshot.priceYes)} yes</p>
                    <p className="mt-1">Decision date: {formatDate(selectedTrial.decisionDate)}</p>
                  </div>
                  <div className="border border-[#e8ddd0] bg-white px-3 py-3 text-sm text-[#5f564c]">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Clear Order</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {orderedModelIds.map((modelId, index) => (
                        <Fragment key={`order-detail:${modelId}`}>
                          <span className="border border-[#d8ccb9] bg-[#fcfaf7] px-3 py-2 text-sm font-medium text-[#1a1a1a]">
                            {availableModelById.get(modelId)?.label ?? modelId}
                          </span>
                          {index < orderedModelIds.length - 1 ? (
                            <span className="text-sm text-[#8a8075]">→</span>
                          ) : null}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
            {selectedTasks.map((task) => (
              <article key={task.taskKey} className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">{availableModelById.get(task.modelId)?.label ?? task.modelId}</p>
                    <p className="mt-1 text-xs text-[#8a8075]">{task.lane === 'api' ? 'API lane' : 'Subscription lane'}</p>
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${getOrderBookTaskTone(task)}`}>
                    {getOrderBookTaskBadge(task)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Locked Snapshot</p>
                    <p className="mt-2 text-sm text-[#1a1a1a]">Price: {formatPercent(task.frozenMarket.priceYes)} yes</p>
                    <p className="mt-1 text-xs text-[#6f665b]">Cash: {formatUsd(task.frozenPortfolio.cashAvailable)}</p>
                    <p className="mt-1 text-xs text-[#6f665b]">YES held: {task.frozenPortfolio.yesSharesHeld.toFixed(0)}</p>
                    <p className="mt-1 text-xs text-[#6f665b]">NO held: {task.frozenPortfolio.noSharesHeld.toFixed(0)}</p>
                  </div>
                  <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Intent</p>
                    <p className="mt-2 text-sm font-medium text-[#1a1a1a]">
                      {task.decision
                        ? `${task.decision.forecast.binaryCall.toUpperCase()} / ${task.decision.forecast.confidence}`
                        : !batch?.runStartedAt && task.lane === 'api'
                          ? 'Queued for Run Batch'
                          : task.status === 'waiting-import'
                            ? 'Waiting for import'
                            : 'Waiting for decision'}
                    </p>
                    <p className="mt-1 text-xs text-[#6f665b]">
                      {task.decision
                        ? `${task.decision.action.type} ${task.decision.action.amountUsd > 0 ? formatUsd(task.decision.action.amountUsd) : ''}`.trim()
                        : !batch?.runStartedAt && task.lane === 'api'
                          ? 'No trade intent yet. This lane has not started.'
                          : task.status === 'waiting-import'
                            ? 'No trade intent yet. Import the JSON for this model.'
                            : 'No trade intent yet'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Reasoning</p>
                  <p className="mt-2 text-sm leading-6 text-[#5f564c]">
                    {task.decision?.forecast.reasoning
                      ?? task.errorMessage
                      ?? (!batch?.runStartedAt && task.lane === 'api'
                        ? 'Queued. This API model will not run until you click Run Batch.'
                        : task.status === 'waiting-import'
                          ? 'Waiting for imported subscription JSON.'
                          : 'Waiting for the lane to return.')}
                  </p>
                </div>
                {task.status === 'error' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void retryTask(task.taskKey)}
                      disabled={successfulFillCount > 0 || batch?.status === 'reset' || batch?.status === 'cleared' || busyKey != null}
                      className="border border-[#1a1a1a] bg-white px-3 py-2 text-xs font-medium text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyKey === `retry:${task.taskKey}`
                        ? 'Retrying...'
                        : task.decision
                          ? 'Retry From Frozen Decision'
                          : task.lane === 'api'
                            ? 'Retry API Task'
                            : 'Reopen Import'}
                    </button>
                    <p className="text-xs text-[#8a8075]">
                      {successfulFillCount === 0
                        ? 'Retry keeps the original frozen snapshot and clear order.'
                        : 'Retry is disabled because the live AMM has already moved in this batch.'}
                    </p>
                  </div>
                ) : null}
                {task.fill ? (
                  <div className="mt-3 border border-[#e8ddd0] bg-[#f8f4ee] px-3 py-3 text-sm text-[#5f564c]">
                    Filled {task.fill.executedAction} from {formatPercent(task.fill.priceBefore)} to {formatPercent(task.fill.priceAfter)}.
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          </div>
        ) : (
          <div className="mt-4 border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
            Stage a batch to inspect model reasoning and trade intents.
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.5fr,1fr]">
        <div className="hidden">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">4. Clearing Tape</p>
          <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Shared-market fills</h3>
          <div className="mt-4 space-y-3">
            {batch?.fills.length ? batch.fills.map((fill) => (
              <div key={fill.id} className="border border-[#d8ccb9] bg-[#fcfaf7] px-4 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">{fill.modelId} on {batch.trials.find((trial) => trial.marketId === fill.marketId)?.shortTitle ?? fill.marketId}</p>
                    <p className="mt-1 text-xs text-[#8a8075]">{fill.executedAction} / requested {formatUsd(fill.requestedAmountUsd)} / executed {formatUsd(fill.executedAmountUsd)}</p>
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${chipClass(fill.status)}`}>{fill.status}</span>
                </div>
                <p className="mt-2 text-sm text-[#5f564c]">{fill.explanation}</p>
                <p className="mt-2 text-xs text-[#6f665b]">Price path: {formatPercent(fill.priceBefore)} to {formatPercent(fill.priceAfter)} / shares delta {fill.sharesDelta.toFixed(0)}</p>
              </div>
            )) : (
              <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
                The tape stays empty until the batch reaches clearing.
              </div>
            )}
          </div>
        </div>

        <div className="hidden">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">4. Portfolio State</p>
          <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Model books after clearing</h3>
          <div className="mt-4 space-y-3">
            {batch?.portfolioStates.length ? batch.portfolioStates.map((portfolio) => (
              <div key={portfolio.modelId} className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">{portfolio.modelId}</p>
                    <p className="mt-1 text-xs text-[#8a8075]">{portfolio.latestActionSummary ?? 'No cleared fill yet'}</p>
                  </div>
                  <p className="text-sm font-medium text-[#1a1a1a]">{formatUsd(portfolio.cashBalance)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#6f665b]">
                  <div className="border border-[#e8ddd0] bg-white px-3 py-2">YES shares: {portfolio.totalYesShares.toFixed(0)}</div>
                  <div className="border border-[#e8ddd0] bg-white px-3 py-2">NO shares: {portfolio.totalNoShares.toFixed(0)}</div>
                </div>
                <div className="mt-3 space-y-2">
                  {portfolio.markets.slice(0, 3).map((market) => (
                    <div key={`${portfolio.modelId}:${market.marketId}`} className="border border-[#e8ddd0] bg-white px-3 py-2 text-xs text-[#6f665b]">
                      {market.shortTitle}: YES {market.yesShares.toFixed(0)} · NO {market.noShares.toFixed(0)}
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
                Portfolio balances appear here once the batch is open.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
