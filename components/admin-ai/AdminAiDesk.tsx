'use client'

import { Fragment, startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import {
  AI_API_CONCURRENCY_DEFAULT,
  AI_API_CONCURRENCY_MAX,
  AI_API_CONCURRENCY_MIN,
  AI_SUBSCRIPTION_MODEL_IDS,
  deriveAiBatchProgress,
  type AiAvailableModel,
  type AiBatchProgress,
  type AiBatchState,
  type AiBatchTaskCounts,
  type AiDataset,
  type AiDeskState,
  type AiSubscriptionModelId,
} from '@/lib/admin-ai-shared'

const ACTIVE_BATCH_FULL_REFRESH_INTERVAL_MS = 15_000
const EMPTY_TASK_COUNTS: AiBatchTaskCounts = {
  total: 0,
  queued: 0,
  running: 0,
  waitingImport: 0,
  ready: 0,
  cleared: 0,
  error: 0,
}

function taskCountsChanged(left: AiBatchTaskCounts | null | undefined, right: AiBatchTaskCounts | null | undefined): boolean {
  if (!left || !right) return left !== right

  return left.total !== right.total
    || left.queued !== right.queued
    || left.running !== right.running
    || left.waitingImport !== right.waitingImport
    || left.ready !== right.ready
    || left.cleared !== right.cleared
    || left.error !== right.error
}

function shouldRefreshLiveBatchSnapshot(current: AiBatchProgress | null, next: AiBatchProgress): boolean {
  if (!current || current.batchId !== next.batchId) return true
  if (current.status !== next.status) return true
  if (current.logCount !== next.logCount || current.fillCount !== next.fillCount) return true
  if (taskCountsChanged(current.taskCounts, next.taskCounts)) return true
  if (taskCountsChanged(current.laneCounts.api, next.laneCounts.api)) return true
  if (taskCountsChanged(current.laneCounts.subscription, next.laneCounts.subscription)) return true
  return false
}

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

function formatDateInputValue(value: Date): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addLocalDays(value: Date, deltaDays: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + deltaDays)
  return next
}

function formatClockTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function formatActionLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isTerminal(status: AiBatchState['status'] | undefined): boolean {
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

function getDeskStatusLabel(batch: AiBatchState | null, progress: AiBatchProgress | null): string {
  if (!batch) return 'Idle'
  if (!batch.runStartedAt) return 'Staged'
  const status = progress?.status ?? batch.status
  if (status === 'cleared') return 'Completed'
  if (status === 'reset') return 'Reset'
  return laneStatusLabel(status)
}

function getDeskStatusDetail(batch: AiBatchState | null, progress: AiBatchProgress | null): string {
  if (!batch) {
    return 'Stage a batch to start a new run.'
  }

  const status = progress?.status ?? batch.status
  const pendingSubscriptionImports = progress?.laneCounts.subscription.waitingImport
    ?? batch.tasks.filter((task) => task.lane === 'subscription' && task.status === 'waiting-import').length
  const apiTaskCounts = progress?.laneCounts.api ?? batch.tasks
    .filter((task) => task.lane === 'api')
    .reduce<AiBatchTaskCounts>((counts, task) => {
      counts.total += 1
      if (task.status === 'queued') counts.queued += 1
      if (task.status === 'running') counts.running += 1
      if (task.status === 'waiting-import') counts.waitingImport += 1
      if (task.status === 'ready') counts.ready += 1
      if (task.status === 'cleared') counts.cleared += 1
      if (task.status === 'error') counts.error += 1
      return counts
    }, { ...EMPTY_TASK_COUNTS })
  const hasEnabledApiLane = apiTaskCounts.total > 0
  const apiLaneReady = hasEnabledApiLane && apiTaskCounts.ready + apiTaskCounts.cleared >= apiTaskCounts.total

  if (!batch.runStartedAt) {
    if (pendingSubscriptionImports > 0 && hasEnabledApiLane) {
      return `Batch is staged. Start the API lane now, then import ${pendingSubscriptionImports} remaining subscription task${pendingSubscriptionImports === 1 ? '' : 's'} while it runs.`
    }

    if (pendingSubscriptionImports > 0) {
      return `Batch is staged. Import ${pendingSubscriptionImports} remaining subscription task${pendingSubscriptionImports === 1 ? '' : 's'}, then run the batch.`
    }

    return 'Batch is staged. All subscription outputs are in and the batch is ready to run.'
  }

  if (status === 'collecting' || status === 'waiting') {
    if (pendingSubscriptionImports > 0 && apiLaneReady) {
      return `The API lane is done. Import ${pendingSubscriptionImports} remaining subscription task${pendingSubscriptionImports === 1 ? '' : 's'} before the batch can clear.`
    }

    if (pendingSubscriptionImports > 0) {
      return `The API lane has started. Import ${pendingSubscriptionImports} remaining subscription task${pendingSubscriptionImports === 1 ? '' : 's'} while decisions continue to collect. The AMM has not executed yet.`
    }

    return 'Model decisions are still coming in. The AMM has not executed yet.'
  }

  if (status === 'ready') {
    return 'All model decisions are in. The batch is ready to clear.'
  }

  if (status === 'clearing') {
    return 'The batch is executing against the shared AMM now.'
  }

  if (status === 'cleared') {
    return 'All model decisions are in, the AMM trades were executed, and this batch is final.'
  }

  if (status === 'failed') {
    const hasSuccessfulFill = batch.fills.some((fill) => fill.status === 'ok')
    return hasSuccessfulFill
      ? 'A task failed after live AMM movement. Reset and stage a fresh batch to preserve fairness.'
      : 'A task failed before clearing completed. You can retry the failed task in place.'
  }

  if (status === 'reset') {
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

function getOrderBookTaskBadge(task: AiBatchState['tasks'][number]): string {
  if (task.fill?.status === 'ok' || task.status === 'cleared') return 'DONE'
  if (task.fill?.status === 'error' || task.status === 'error') return 'FAILED'
  if (task.status === 'waiting-import') return 'WAITING'
  if (task.status === 'running') return 'RUNNING'
  if (task.status === 'ready') return 'READY'
  return 'QUEUED'
}

function getOrderBookTaskTone(task: AiBatchState['tasks'][number]): string {
  return chipClass(task.fill?.status === 'error' ? 'error' : task.fill?.status === 'ok' ? 'done' : task.status)
}

function logToneClass(tone: AiBatchProgress['recentLogs'][number]['tone']): string {
  if (tone === 'success') return 'border-[#3a8a2e]/30 bg-[#3a8a2e]/10 text-[#2f6f24]'
  if (tone === 'warning') return 'border-[#c9982b]/30 bg-[#fff7e5] text-[#8a6418]'
  if (tone === 'error') return 'border-[#c43a2b]/30 bg-[#fff3f1] text-[#8d2c22]'
  return 'border-[#d8ccb9] bg-[#f8f4ee] text-[#6f665b]'
}

function formatEta(progress: AiBatchProgress | null): string {
  if (!progress) return '--'
  if (progress.status === 'cleared') return 'Complete'
  if (progress.etaBasis === 'blocked') return 'Waiting for import'
  if (progress.etaMs == null || progress.etaMs <= 0) return '--'
  return formatDurationMs(progress.etaMs)
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Request failed'))
  }
  return payload as T
}

function getDefaultEnabledModels(availableModels: AiAvailableModel[]): AiAvailableModel['modelId'][] {
  return availableModels.filter((model) => model.defaultEnabled).map((model) => model.modelId)
}

function getLaneStatus(batch: AiBatchState | null, modelIds: string[]): string {
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
  initialState: AiDeskState
  initialProgress: AiBatchProgress | null
  activeDatabaseTarget: 'main' | 'toy'
}

export function AdminAiDesk({ initialState, initialProgress, activeDatabaseTarget }: Props) {
  const [deskState, setDeskState] = useState(initialState)
  const [dataset, setDataset] = useState<AiDataset>(initialState.batch?.dataset ?? initialState.dataset)
  const [selectedModels, setSelectedModels] = useState<AiAvailableModel['modelId'][]>(
    initialState.batch?.enabledModelIds ?? getDefaultEnabledModels(initialState.availableModels),
  )
  const [selectedApiConcurrency, setSelectedApiConcurrency] = useState<number>(
    initialState.batch?.apiConcurrency ?? AI_API_CONCURRENCY_DEFAULT,
  )
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(initialState.batch?.trials[0]?.marketId ?? null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)
  const [exportPackets, setExportPackets] = useState<Record<string, string>>({})
  const [importTexts, setImportTexts] = useState<Record<string, string>>({})
  const [copiedPacketModelId, setCopiedPacketModelId] = useState<AiSubscriptionModelId | null>(null)
  const [toyRunDate, setToyRunDate] = useState<string>(() => {
    const seed = initialState.batch?.dataset === 'toy' && initialState.batch.createdAt
      ? new Date(initialState.batch.createdAt)
      : new Date()
    return formatDateInputValue(seed)
  })
  const [progress, setProgress] = useState<AiBatchProgress | null>(initialProgress)
  const snapshotRefreshInFlightRef = useRef(false)
  const progressRef = useRef<AiBatchProgress | null>(initialProgress)

  const batch = deskState.batch
  const availableModelById = useMemo(() => (
    new Map(deskState.availableModels.map((model) => [model.modelId, model] as const))
  ), [deskState.availableModels])
  const liveProgress = progress

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  const replaceBatch = useEffectEvent((nextBatch: AiBatchState | null) => {
    startTransition(() => {
      setDeskState((current) => ({
        ...current,
        batch: nextBatch,
      }))
      setProgress(deriveAiBatchProgress(nextBatch))
    })
  })

  const applyBatchSnapshot = useEffectEvent((batchId: string, nextBatch: AiBatchState | null) => {
    startTransition(() => {
      setDeskState((current) => (
        current.batch?.id === batchId
          ? {
              ...current,
              batch: nextBatch,
            }
          : current
      ))
      setProgress((current) => (
        current == null || current.batchId === batchId
          ? deriveAiBatchProgress(nextBatch)
          : current
      ))
    })
  })

  const refreshBatchSnapshot = useEffectEvent(async (batchId: string, options?: { force?: boolean; silent?: boolean }) => {
    if (!options?.force && snapshotRefreshInFlightRef.current) {
      return
    }

    snapshotRefreshInFlightRef.current = true
    try {
      const response = await fetchJson<AiDeskState>(`/api/admin/ai/state?dataset=${encodeURIComponent(dataset)}&batchId=${encodeURIComponent(batchId)}`)
      applyBatchSnapshot(batchId, response.batch)
    } catch (error) {
      if (!options?.silent) {
        setUiError(error instanceof Error ? error.message : 'Failed to refresh live AI batch state')
      }
    } finally {
      snapshotRefreshInFlightRef.current = false
    }
  })

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
    if (batch?.apiConcurrency != null) {
      setSelectedApiConcurrency(batch.apiConcurrency)
    }
  }, [batch?.id, batch?.apiConcurrency])

  useEffect(() => {
    if (!batch || isTerminal(batch.status)) return

    const source = new EventSource(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/stream`)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; progress?: AiBatchProgress | null; message?: string }
        if (payload.type === 'progress' && payload.progress) {
          const nextProgress = payload.progress
          const currentProgress = progressRef.current
          const shouldRefreshSnapshot = shouldRefreshLiveBatchSnapshot(currentProgress, nextProgress)

          progressRef.current = nextProgress
          startTransition(() => {
            setProgress(nextProgress)
          })

          if (shouldRefreshSnapshot || isTerminal(nextProgress.status)) {
            void refreshBatchSnapshot(batch.id, { force: true, silent: true })
          }
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
  }, [batch?.id, batch?.status, refreshBatchSnapshot])

  useEffect(() => {
    if (!batch?.runStartedAt || isTerminal(batch.status)) {
      return
    }

    const intervalId = window.setInterval(() => {
      void refreshBatchSnapshot(batch.id, { silent: true })
    }, ACTIVE_BATCH_FULL_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [batch?.id, batch?.runStartedAt, batch?.status, refreshBatchSnapshot])

  useEffect(() => {
    if (!batch || isTerminal(batch.status) || busyKey != null) {
      return
    }

    const modelIdsToExport = AI_SUBSCRIPTION_MODEL_IDS.filter((modelId) => (
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

  const orderedModelIds = useMemo<AiAvailableModel['modelId'][]>(() => {
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

  const apiModels = useMemo(() => deskState.availableModels.filter((model) => model.lane === 'api').map((model) => model.modelId), [deskState.availableModels])
  const pendingSubscriptionImports = useMemo(() => (
    batch?.tasks.filter((task) => task.lane === 'subscription' && task.status === 'waiting-import').length ?? 0
  ), [batch])
  const apiLaneTasks = useMemo(() => (
    batch?.tasks.filter((task) => apiModels.includes(task.modelId)) ?? []
  ), [batch, apiModels])
  const hasEnabledApiLane = apiLaneTasks.length > 0
  const canRunBatch = Boolean(batch && !batch.runStartedAt && pendingSubscriptionImports === 0 && !isTerminal(batch.status))
  const canStartApiLaneEarly = Boolean(batch && hasEnabledApiLane && !batch.runStartedAt && pendingSubscriptionImports > 0 && !isTerminal(batch.status))
  const successfulFillCount = useMemo(() => (
    batch?.fills.filter((fill) => fill.status === 'ok').length ?? 0
  ), [batch])
  const canRetryFailedTaskInPlace = Boolean(successfulFillCount === 0 && batch?.status !== 'reset' && batch?.status !== 'cleared')
  const apiLaneReadyForClear = useMemo(() => (
    hasEnabledApiLane && apiLaneTasks.every((task) => task.status === 'ready' || task.status === 'cleared')
  ), [apiLaneTasks, hasEnabledApiLane])
  const displayedApiConcurrency = batch?.apiConcurrency ?? selectedApiConcurrency
  const apiConcurrencyLocked = Boolean(batch?.runStartedAt)
  const liveTaskCounts = liveProgress?.taskCounts ?? EMPTY_TASK_COUNTS
  const liveApiTaskCounts = liveProgress?.laneCounts.api ?? EMPTY_TASK_COUNTS
  const liveSubscriptionTaskCounts = liveProgress?.laneCounts.subscription ?? EMPTY_TASK_COUNTS
  const livePendingSubscriptionImports = liveProgress?.laneCounts.subscription.waitingImport ?? pendingSubscriptionImports
  const liveHasEnabledApiLane = liveApiTaskCounts.total > 0 || hasEnabledApiLane
  const liveApiLaneReadyForClear = liveApiTaskCounts.total > 0
    ? liveApiTaskCounts.ready + liveApiTaskCounts.cleared >= liveApiTaskCounts.total
    : apiLaneReadyForClear
  const liveBatchSizeLabel = liveProgress
    ? `${liveProgress.trialCount} trials / ${liveProgress.modelCount} models / ${liveTaskCounts.total} tasks`
    : 'No active batch'
  const fullRefreshIntervalSeconds = Math.round(ACTIVE_BATCH_FULL_REFRESH_INTERVAL_MS / 1000)
  const toyBacktestEnabled = activeDatabaseTarget === 'toy' && dataset === 'toy'
  const toyRunDatePresets = [0, 1, 2, 3, 4, 5]
  const laneCards = useMemo(() => {
    return [
      {
        id: 'api',
        label: 'API Lane',
        description: 'API-backed models stay queued until you start the API lane or run the fully ready batch, then they execute with your chosen parallelization.',
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
        id: 'gpt-5.4',
        label: 'OpenAI Subscription',
        description: 'Export GPT tasks, run them in your subscription workflow, then import JSON.',
        status: getLaneStatus(batch, ['gpt-5.4']),
        modelIds: ['gpt-5.4'],
      },
    ]
  }, [apiModels, batch])

  useEffect(() => {
    if (batch?.dataset === 'toy' && batch.createdAt) {
      setToyRunDate(formatDateInputValue(new Date(batch.createdAt)))
    }
  }, [batch?.createdAt, batch?.dataset, batch?.id])

  async function refreshState(nextDataset: AiDataset) {
    const response = await fetchJson<AiDeskState>(`/api/admin/ai/state?dataset=${encodeURIComponent(nextDataset)}`)
    startTransition(() => {
      setDeskState(response)
      setDataset(nextDataset)
      setSelectedModels(response.batch?.enabledModelIds ?? getDefaultEnabledModels(response.availableModels))
      setExportPackets({})
      setImportTexts({})
      setProgress(deriveAiBatchProgress(response.batch))
    })
  }

  async function openBatch() {
    setBusyKey('open')
    setUiError(null)
    try {
      const payload = await fetchJson<{ batch: AiBatchState }>('/api/admin/ai/batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataset,
          enabledModelIds: selectedModels,
          apiConcurrency: selectedApiConcurrency,
          runDate: toyBacktestEnabled ? toyRunDate : undefined,
        }),
      })
      replaceBatch(payload.batch)
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

  async function updateApiConcurrency(nextValue: number) {
    setSelectedApiConcurrency(nextValue)

    if (!batch || batch.runStartedAt || isTerminal(batch.status)) {
      return
    }

    setBusyKey('api-concurrency')
    setUiError(null)
    try {
      const payload = await fetchJson<{ batch: AiBatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiConcurrency: nextValue,
        }),
      })
      replaceBatch(payload.batch)
    } catch (error) {
      setSelectedApiConcurrency(batch.apiConcurrency)
      setUiError(error instanceof Error ? error.message : 'Failed to update API parallelization')
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
        setProgress(null)
      })
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to reset batch')
    } finally {
      setBusyKey(null)
    }
  }

  async function importPacket(modelId: AiSubscriptionModelId) {
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

      const payload = await fetchJson<{ batch: AiBatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/subscription/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      replaceBatch(payload.batch)
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Failed to import packet')
    } finally {
      setBusyKey(null)
    }
  }

  async function copyExportPacket(modelId: AiSubscriptionModelId) {
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
      const payload = await fetchJson<{ batch: AiBatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/run`, {
        method: 'POST',
      })
      replaceBatch(payload.batch)
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
      const payload = await fetchJson<{ batch: AiBatchState }>(`/api/admin/ai/batches/${encodeURIComponent(batch.id)}/tasks/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskKey }),
      })
      replaceBatch(payload.batch)
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
          <div className={`flex flex-col gap-3 ${toyBacktestEnabled ? 'xl:flex-row xl:items-stretch' : ''}`}>
            <div className="shrink-0 border border-[#d8ccb9] bg-[#fcfaf7] px-5 py-4">
              <div className="flex flex-col gap-3">
                <label className="flex flex-col items-start gap-3">
                  <span className="text-[11px] uppercase leading-[1.5] tracking-[0.08em] text-[#8a8075]">Concurrent tasks</span>
                  <select
                    value={displayedApiConcurrency}
                    disabled={busyKey != null || apiConcurrencyLocked || Boolean(batch && isTerminal(batch.status))}
                    onChange={(event) => void updateApiConcurrency(Number(event.target.value))}
                    className="h-[41px] border border-[#d8ccb9] bg-white px-3 py-2 text-sm text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {Array.from({ length: AI_API_CONCURRENCY_MAX - AI_API_CONCURRENCY_MIN + 1 }, (_, index) => {
                      const value = AI_API_CONCURRENCY_MIN + index
                      return (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      )
                    })}
                  </select>
                </label>
              </div>
            </div>
            {toyBacktestEnabled ? (
              <div className="flex-1 border border-[#d8ccb9] bg-[#fcfaf7] px-5 py-4">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Toy Backtest Date</p>
                  </div>
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <input
                      type="date"
                      value={toyRunDate}
                      max={formatDateInputValue(new Date())}
                      disabled={busyKey != null || (batch != null && !isTerminal(batch.status))}
                      onChange={(event) => setToyRunDate(event.target.value)}
                      className="border border-[#d8ccb9] bg-white px-3 py-2 text-sm text-[#1a1a1a] xl:w-[190px] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="flex flex-wrap gap-2 xl:flex-nowrap xl:gap-1.5">
                      {toyRunDatePresets.map((daysAgo) => {
                        const presetValue = formatDateInputValue(addLocalDays(new Date(), -daysAgo))
                        const active = toyRunDate === presetValue
                        return (
                          <button
                            key={daysAgo}
                            type="button"
                            disabled={busyKey != null || (batch != null && !isTerminal(batch.status))}
                            onClick={() => setToyRunDate(presetValue)}
                            className={`border px-3 py-2 text-xs font-medium whitespace-nowrap xl:px-2.5 xl:text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-[#c9b59a] bg-[#efe5d7] text-[#5b4d3f]' : 'border-[#d8ccb9] bg-white text-[#6f665b]'}`}
                          >
                            {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
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
            <p className="mt-2 text-sm font-medium text-[#1a1a1a]">{getDeskStatusLabel(batch, liveProgress)}</p>
            <p className="mt-2 text-xs leading-5 text-[#6f665b]">{getDeskStatusDetail(batch, liveProgress)}</p>
          </div>
          {batch && !batch.runStartedAt ? (
            <div className="border border-[#d8ccb9] bg-[#f8f4ee] px-3 py-2 text-sm text-[#6f665b]">
              {livePendingSubscriptionImports > 0
                ? liveHasEnabledApiLane
                  ? `Batch is staged. Start the API lane now, then import ${livePendingSubscriptionImports} remaining subscription task${livePendingSubscriptionImports === 1 ? '' : 's'} while it runs.`
                  : `Batch is staged. Import ${livePendingSubscriptionImports} remaining subscription task${livePendingSubscriptionImports === 1 ? '' : 's'} before running the batch.`
                : liveHasEnabledApiLane
                  ? `Batch is staged. The API lane is ready to start with up to ${batch.apiConcurrency} task${batch.apiConcurrency === 1 ? '' : 's'} at once when you click Run Batch.`
                  : 'Batch is staged. All subscription outputs are in and the batch is ready to run.'}
            </div>
          ) : null}
          {batch?.runStartedAt && !isTerminal(batch.status) ? (
            <div className="border border-[#5BA5ED]/30 bg-[#5BA5ED]/10 px-3 py-2 text-sm text-[#265f8f]">
              {livePendingSubscriptionImports > 0
                ? liveApiLaneReadyForClear
                  ? `The API lane is done. Import ${livePendingSubscriptionImports} remaining subscription task${livePendingSubscriptionImports === 1 ? '' : 's'} before the shared AMM can clear.`
                  : `The API lane is live. Import ${livePendingSubscriptionImports} remaining subscription task${livePendingSubscriptionImports === 1 ? '' : 's'} while decisions continue to collect.`
                : `Run is live. Decisions are collecting with API parallelization locked at ${batch.apiConcurrency}, and the detailed matrix now refreshes automatically as tasks finish.`}
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

      <section className="border border-[#e8ddd0] bg-white/85 p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">1. Run Health</p>
              <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Live batch pace</h3>
            </div>
            <p className="text-xs text-[#8a8075]">
              {batch?.runStartedAt && !isTerminal(batch.status)
                ? `Live counts update every second, and the order book refreshes as tasks change.`
                : liveBatchSizeLabel}
            </p>
          </div>

          {liveProgress ? (
            <>
              <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Current Phase</p>
                    <p className="mt-1 text-sm font-medium text-[#1a1a1a]">{laneStatusLabel(liveProgress.status)}</p>
                    <p className="mt-1 text-xs text-[#6f665b]">{liveBatchSizeLabel}</p>
                  </div>
                  <div className="min-w-0 flex-1 lg:max-w-[440px]">
                    <div className="flex items-center justify-between gap-3 text-xs text-[#6f665b]">
                      <span>{liveTaskCounts.cleared} / {liveTaskCounts.total} cleared</span>
                      <span>{formatPercent(liveProgress.completionRatio)} complete</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eadfce]">
                      <div
                        className="h-full bg-[#5BA5ED] transition-[width] duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, Math.round(liveProgress.completionRatio * 100)))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Tasks</p>
                  <p className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{liveTaskCounts.total}</p>
                  <p className="mt-1 text-xs text-[#6f665b]">{liveProgress.trialCount} trials / {liveProgress.modelCount} models</p>
                </div>
                <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Queue</p>
                  <p className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{liveTaskCounts.running}</p>
                  <p className="mt-1 text-xs text-[#6f665b]">Running / {liveTaskCounts.ready} ready / {liveTaskCounts.queued} queued</p>
                </div>
                <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Timing</p>
                  <p className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{liveProgress.elapsedMs != null ? formatDurationMs(liveProgress.elapsedMs) : '--'}</p>
                  <p className="mt-1 text-xs text-[#6f665b]">Elapsed / ETA {formatEta(liveProgress)}</p>
                </div>
                <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">API Lane</p>
                  <p className="mt-2 text-2xl font-semibold text-[#1a1a1a]">{liveApiTaskCounts.running}</p>
                  <p className="mt-1 text-xs text-[#6f665b]">{liveApiTaskCounts.ready} ready / {displayedApiConcurrency} concurrency / {liveSubscriptionTaskCounts.waitingImport} waiting import</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="border border-[#e8ddd0] bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Cleared</p>
                  <p className="mt-2 text-lg font-semibold text-[#1a1a1a]">{liveTaskCounts.cleared}</p>
                </div>
                <div className="border border-[#e8ddd0] bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Failed</p>
                  <p className="mt-2 text-lg font-semibold text-[#1a1a1a]">{liveTaskCounts.error}</p>
                </div>
                <div className="border border-[#e8ddd0] bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Recent Activity</p>
                  <p className="mt-2 text-lg font-semibold text-[#1a1a1a]">{formatClockTime(liveProgress.latestActivityAt)}</p>
                </div>
                <div className="border border-[#e8ddd0] bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Debug Feed</p>
                  <p className="mt-2 text-lg font-semibold text-[#1a1a1a]">{liveProgress.logCount} logs</p>
                  <p className="mt-1 text-xs text-[#6f665b]">{liveProgress.fillCount} fills recorded</p>
                </div>
              </div>
            </>
          ) : (
            <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
              Stage a batch to start live run-health tracking and debug output.
            </div>
          )}
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
              const laneEnabledModelIds = (batch?.enabledModelIds ?? selectedModels).filter((modelId) => lane.modelIds.includes(modelId))
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
                {lane.id === 'api' ? (
                  <div className="mt-4 border border-[#e8ddd0] bg-white px-3 py-3 text-xs text-[#6f665b]">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Parallelization</p>
                    <p className="mt-2 text-sm font-medium text-[#1a1a1a]">
                      {displayedApiConcurrency} concurrent API task{displayedApiConcurrency === 1 ? '' : 's'}
                    </p>
                    <p className="mt-1 text-[11px] text-[#8a8075]">
                      {apiConcurrencyLocked
                        ? 'Locked for the active run.'
                        : batch
                          ? 'Editable until the API lane starts.'
                          : 'Set this before staging the next batch.'}
                    </p>
                  </div>
                ) : null}
                {lane.id === 'api' && canStartApiLaneEarly ? (
                  <button
                    type="button"
                    disabled={busyKey != null}
                    onClick={() => void runBatchNow()}
                    className="mt-4 w-full border border-[#3a8a2e] bg-[#3a8a2e] px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyKey === 'run' ? 'Starting...' : 'Start API Lane'}
                  </button>
                ) : null}
                {lane.id === 'claude-opus' || lane.id === 'gpt-5.4' ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!batch || !laneActive || busyKey != null || !importTexts[lane.id]?.trim()}
                        onClick={() => void importPacket(lane.id as AiSubscriptionModelId)}
                        className="border border-[#c1ab8e] bg-[#eadfce] px-3 py-2 text-xs font-medium text-[#5b4d3f] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyKey === `import:${lane.id}` ? 'Importing...' : 'Import JSON'}
                      </button>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        disabled={!exportPackets[lane.id]?.trim()}
                        onClick={() => void copyExportPacket(lane.id as AiSubscriptionModelId)}
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
                    {batch
                      ? !batch.runStartedAt
                        ? pendingSubscriptionImports > 0
                          ? `Start the API lane to begin ${laneTasks.length} queued API task${laneTasks.length === 1 ? '' : 's'} while subscription imports continue.`
                          : `${laneTasks.length} API task${laneTasks.length === 1 ? '' : 's'} are staged in this batch and ready to start.`
                        : pendingSubscriptionImports > 0
                          ? apiLaneReadyForClear
                            ? `${laneTasks.length} API task${laneTasks.length === 1 ? '' : 's'} are done. Import ${pendingSubscriptionImports} remaining subscription task${pendingSubscriptionImports === 1 ? '' : 's'} before clearing can begin.`
                            : `${laneTasks.length} API task${laneTasks.length === 1 ? '' : 's'} are running in this batch while subscription imports continue.`
                          : `${laneTasks.length} API task${laneTasks.length === 1 ? '' : 's'} in this batch.`
                      : 'API tasks stay idle until you stage a batch.'}
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
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMarketId(firstFailedLaneTask.marketId)
                          void retryTask(firstFailedLaneTask.taskKey)
                        }}
                        disabled={!canRetryFailedTaskInPlace || busyKey != null}
                        className="border border-[#1a1a1a] bg-white px-3 py-2 text-xs font-medium text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyKey === `retry:${firstFailedLaneTask.taskKey}`
                          ? 'Retrying...'
                          : firstFailedLaneTask.decision
                            ? 'Retry From Frozen Decision'
                            : firstFailedLaneTask.lane === 'api'
                              ? 'Retry API Task'
                              : 'Reopen Import'}
                      </button>
                      <p className="text-[11px] text-[#8d2c22]/80">
                        {canRetryFailedTaskInPlace
                          ? 'Retry keeps the original frozen snapshot and clear order.'
                          : 'Retry is disabled because the live AMM has already moved in this batch.'}
                      </p>
                    </div>
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
            {batch?.runStartedAt && !isTerminal(batch.status) ? (
              <p className="mt-2 text-xs text-[#8a8075]">
                This matrix refreshes automatically when live task state changes, with a background full sync every {fullRefreshIntervalSeconds}s.
              </p>
            ) : null}
          </div>
        </div>
        {batch?.trials.length ? (
          <div className="mt-4">
            <div className="overflow-x-auto rounded-none border border-[#e8ddd0] bg-white">
              <div className="min-w-[760px]">
                <table className="w-full table-fixed border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-[#f8f4ee]">
                      <th className="sticky left-0 z-30 w-[108px] min-w-[108px] max-w-[108px] border-b border-[#e8ddd0] bg-[#f8f4ee] px-2 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8075] shadow-[1px_0_0_0_#e8ddd0]">
                        Trial
                      </th>
                      {orderedModelIds.map((modelId, index) => {
                        const model = availableModelById.get(modelId)
                        return (
                          <th
                            key={modelId}
                            className="z-20 w-[88px] min-w-[88px] max-w-[88px] border-b border-l border-[#e8ddd0] bg-[#f8f4ee] px-2 py-2 text-left align-top"
                          >
                            <p className="text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">Model {index + 1}</p>
                            <p className="mt-1 text-xs leading-4 font-medium text-[#1a1a1a]">{availableModelById.get(modelId)?.label ?? modelId}</p>
                            <p className="mt-1 text-[11px] text-[#6f665b]">
                              {model?.lane === 'subscription' ? 'Subscription lane' : 'API lane'}
                            </p>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                </table>
                <div className="max-h-[72vh] overflow-y-auto">
                  <table className="w-full table-fixed border-separate border-spacing-0">
                    <tbody>
                      {batch.trials.map((trial, trialIndex) => {
                        const trialTasks = batch.tasks.filter((task) => task.marketId === trial.marketId)
                        const taskByModel = new Map(trialTasks.map((task) => [task.modelId, task] as const))
                        const closedCount = trialTasks.filter((task) => task.status === 'ready' || task.status === 'error' || task.status === 'cleared').length
                        const readyCount = trialTasks.filter((task) => task.status === 'ready' || task.status === 'cleared').length
                        const filledCount = trialTasks.filter((task) => task.fill?.status === 'ok').length
                        const active = selectedTrial?.marketId === trial.marketId
                        const stickyCellClass = active ? 'bg-[#fcf7f0]' : 'bg-white'
                        const rowCellClass = active ? 'bg-[#fffdf9]' : 'bg-white'

                        return (
                          <tr
                            key={trial.marketId}
                            className="align-top cursor-pointer"
                            onClick={() => setSelectedMarketId(trial.marketId)}
                          >
                            <td className={`sticky left-0 z-10 w-[108px] min-w-[108px] max-w-[108px] border-t border-[#e8ddd0] px-2 py-2 shadow-[1px_0_0_0_#e8ddd0] ${stickyCellClass}`}>
                              <div title={trial.nctNumber ?? trial.shortTitle}>
                                <p className="text-sm font-medium text-[#1a1a1a]">{trialIndex + 1}.</p>
                                <p className="truncate text-[11px] leading-tight text-[#8a8075]">{trial.nctNumber?.trim() || trial.shortTitle}</p>
                              </div>
                              <div className="mt-1 pt-0.5">
                                <p className="text-[11px] text-[#8a8075]">
                                  {closedCount}/{orderedModelIds.length || trialTasks.length}
                                </p>
                                <p className="mt-1.5 text-[11px] text-[#8a8075]">Frozen start {formatPercent(trial.marketSnapshot.priceYes)} yes</p>
                              </div>
                            </td>
                            {orderedModelIds.map((modelId, index) => {
                              const task = taskByModel.get(modelId)
                              const model = availableModelById.get(modelId)

                              if (!task) {
                                return (
                                  <td
                                    key={`${trial.marketId}:${modelId}`}
                                    className={`w-[88px] min-w-[88px] max-w-[88px] border-l border-t border-[#e8ddd0] px-2 py-2 align-top ${rowCellClass}`}
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
                                      ? 'Queued for API lane start'
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
                                      ? 'Queued until you start the API lane.'
                                      : task.status === 'waiting-import'
                                        ? 'Waiting for subscription JSON.'
                                        : task.status === 'running'
                                          ? 'The API lane is evaluating this trial now.'
                                          : 'Still waiting for this lane to return.'

                              return (
                                <td
                                  key={task.taskKey}
                                  className={`w-[88px] min-w-[88px] max-w-[88px] border-l border-t border-[#e8ddd0] px-2 py-2 align-top ${rowCellClass}`}
                                >
                                  <div className="flex items-start gap-1.5">
                                    <span className={`rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${getOrderBookTaskTone(task)}`}>
                                      {getOrderBookTaskBadge(task)}
                                    </span>
                                  </div>
                                  {task.fill ? (
                                    <>
                                      <p className="mt-1 text-xs leading-4 text-[#5f564c]">Filled</p>
                                      <p className="mt-0.5 text-xs leading-4 font-medium text-[#5f564c]">
                                        {formatActionLabel(task.fill.executedAction)}
                                      </p>
                                      {task.fill.executedAmountUsd > 0 ? (
                                        <p className="mt-0.5 text-[11px] leading-4 text-[#6f665b]">
                                          {formatUsd(task.fill.executedAmountUsd)}
                                        </p>
                                      ) : null}
                                      <p className="mt-1 text-[11px] leading-4 text-[#6f665b]">{secondaryDetail}</p>
                                    </>
                                  ) : (
                                    <>
                                      <p className="mt-1 text-xs leading-4 text-[#5f564c]">{primaryDetail}</p>
                                      <p className="mt-1 text-[11px] leading-4 text-[#6f665b]">{secondaryDetail}</p>
                                    </>
                                  )}
                                  {task.durationMs != null ? (
                                    <p className="mt-1 text-[11px] text-[#8a8075]">{formatDurationMs(task.durationMs)} run time</p>
                                  ) : null}
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
                    <p className="mt-2">Frozen price: {formatPercent(selectedTrial.marketSnapshot.priceYes)} yes</p>
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
                    {task.durationMs != null ? (
                      <p className="mt-1 text-xs text-[#8a8075]">Run time: {formatDurationMs(task.durationMs)}</p>
                    ) : null}
                    {task.estimatedCostUsd ? (
                      <p className="mt-1 text-xs text-[#8a8075]">{formatUsd(task.estimatedCostUsd)} estimated cost</p>
                    ) : null}
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${getOrderBookTaskTone(task)}`}>
                    {getOrderBookTaskBadge(task)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Locked Snapshot</p>
                    <p className="mt-2 text-sm text-[#1a1a1a]">Frozen price: {formatPercent(task.frozenMarket.priceYes)} yes</p>
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
                          ? 'Queued for API lane start'
                          : task.status === 'waiting-import'
                            ? 'Waiting for import'
                            : 'Waiting for decision'}
                    </p>
                    <p className="mt-1 text-xs text-[#6f665b]">
                      {task.decision
                        ? `${task.decision.action.type} ${task.decision.action.amountUsd > 0 ? formatUsd(task.decision.action.amountUsd) : ''}`.trim()
                        : !batch?.runStartedAt && task.lane === 'api'
                          ? 'No trade intent yet. Start the API lane to begin this model.'
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
                        ? 'Queued. This API model will not run until you start the API lane.'
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

      <section className="grid gap-5 xl:grid-cols-[1.5fr,1fr]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">4. Live Debug</p>
          <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Recent logs and fills</h3>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#1a1a1a]">Recent logs</p>
                  <p className="mt-1 text-xs text-[#8a8075]">{liveProgress ? `${liveProgress.logCount} total` : 'No active batch'}</p>
                </div>
                {liveProgress ? (
                  <span className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Newest first</span>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                {liveProgress?.recentLogs.length ? liveProgress.recentLogs.map((entry) => (
                  <div key={entry.id} className={`border px-3 py-3 text-sm ${logToneClass(entry.tone)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.08em]">{entry.tone}</span>
                      <span className="text-[11px]">{formatClockTime(entry.at)}</span>
                    </div>
                    <p className="mt-2 leading-5">{entry.message}</p>
                  </div>
                )) : (
                  <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
                    Live logs appear here once a batch starts moving.
                  </div>
                )}
              </div>
            </div>

            <div className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#1a1a1a]">Recent fills</p>
                  <p className="mt-1 text-xs text-[#8a8075]">{liveProgress ? `${liveProgress.fillCount} total` : 'No active batch'}</p>
                </div>
                {liveProgress ? (
                  <span className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Newest first</span>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                {liveProgress?.recentFills.length ? liveProgress.recentFills.map((fill) => (
                  <div key={fill.id} className={`border px-3 py-3 text-sm ${chipClass(fill.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[#1a1a1a]">{fill.modelLabel}</p>
                        <p className="mt-1 text-xs text-[#6f665b]">{fill.trialLabel}</p>
                      </div>
                      <span className="text-[11px] text-[#8a8075]">{formatClockTime(fill.at)}</span>
                    </div>
                    <p className="mt-2 text-xs text-[#5f564c]">
                      {formatActionLabel(fill.executedAction)}
                      {fill.executedAmountUsd > 0 ? ` ${formatUsd(fill.executedAmountUsd)}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-[#6f665b]">Price {formatPercent(fill.priceBefore)} to {formatPercent(fill.priceAfter)}</p>
                  </div>
                )) : (
                  <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
                    Fills will appear here as the shared AMM clears each task.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#b5aa9e]">5. Timing</p>
          <h3 className="mt-1 text-lg font-semibold text-[#1a1a1a]">Per-model pace</h3>
          <div className="mt-4 space-y-3">
            {liveProgress?.modelDurations.length ? liveProgress.modelDurations.map((entry) => (
              <div key={entry.modelId} className="border border-[#d8ccb9] bg-[#fcfaf7] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">{entry.label}</p>
                    <p className="mt-1 text-xs text-[#8a8075]">{entry.lane === 'api' ? 'API lane' : 'Subscription lane'}</p>
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${chipClass(entry.runningCount > 0 ? 'running' : entry.clearedCount > 0 ? 'done' : entry.readyCount > 0 ? 'ready' : 'waiting')}`}>
                    {entry.averageDurationMs != null ? formatDurationMs(entry.averageDurationMs) : 'No runtime yet'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#6f665b]">
                  <div className="border border-[#e8ddd0] bg-white px-3 py-2">Completed: {entry.completedCount}</div>
                  <div className="border border-[#e8ddd0] bg-white px-3 py-2">Cleared: {entry.clearedCount}</div>
                  <div className="border border-[#e8ddd0] bg-white px-3 py-2">Running: {entry.runningCount}</div>
                  <div className="border border-[#e8ddd0] bg-white px-3 py-2">Queued: {entry.queuedCount}</div>
                </div>
              </div>
            )) : (
              <div className="border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-6 text-sm text-[#8a8075]">
                Per-model timing appears here once the active batch records decisions.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
