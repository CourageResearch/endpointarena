import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { db, marketActions, predictionMarkets, trialQuestions } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { normalizeRunDate } from '@/lib/markets/engine'
import { prepareDailyRunContext, getDailyRunPositionKey } from '@/lib/markets/daily-run-planning'
import {
  buildDailyRunAutomationTaskKey,
  getDailyRunAutomationModelId,
  getDailyRunAutomationModelLabel,
  getDailyRunAutomationSourceLabel,
  type DailyRunAutomationDecisionItem,
  type DailyRunAutomationExportPacket,
  type DailyRunAutomationImportFile,
  type DailyRunAutomationPreview,
  type DailyRunAutomationPreviewItem,
  type DailyRunAutomationSource,
} from '@/lib/markets/automation-handoff-shared'
import { getModelActorIds } from '@/lib/market-actors'
import { buildModelDecisionSnapshotInput } from '@/lib/model-decision-snapshots'
import { buildModelDecisionPrompt, parseModelDecisionResponse, type ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

const HANDOFF_ROOT = path.join(process.cwd(), 'tmp', 'admin-ai-handoff')
const HANDOFF_EXPORTS_DIR = path.join(HANDOFF_ROOT, 'exports')
const HANDOFF_DECISIONS_DIR = path.join(HANDOFF_ROOT, 'decisions')
const HANDOFF_ARCHIVE_DIR = path.join(HANDOFF_ROOT, 'archive')

type ParsedAutomationImport = {
  source: DailyRunAutomationSource
  modelId: ReturnType<typeof getDailyRunAutomationModelId>
  runDate: Date
  filename: string | null
  decisions: DailyRunAutomationDecisionItem[]
}

export type PreparedAutomationImportPreview = {
  preview: DailyRunAutomationPreview
  normalizedRunDate: Date
  marketIds: string[]
  modelId: ReturnType<typeof getDailyRunAutomationModelId>
  readyDecisionMap: Map<string, DailyRunAutomationDecisionItem>
}

function buildExportFilename(source: DailyRunAutomationSource, runDate: Date, nctNumber?: string | null): string {
  const sourceSlug = source === 'claude-code-subscription' ? 'claude-code' : 'codex'
  const runDatePart = runDate.toISOString().slice(0, 10)
  const scopePart = nctNumber ? nctNumber.toLowerCase() : 'all-open'
  const timestampPart = new Date().toISOString().replace(/[:.]/g, '-')
  return `${runDatePart}-${sourceSlug}-${scopePart}-${timestampPart}.json`
}

function buildArchiveFilename(filename: string | null): string {
  const safeBaseName = filename
    ? path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '-')
    : 'imported-decisions.json'
  const timestampPart = new Date().toISOString().replace(/[:.]/g, '-')
  return `${timestampPart}-${safeBaseName}`
}

async function ensureAutomationHandoffDirectories(): Promise<void> {
  await Promise.all([
    mkdir(HANDOFF_EXPORTS_DIR, { recursive: true }),
    mkdir(HANDOFF_DECISIONS_DIR, { recursive: true }),
    mkdir(HANDOFF_ARCHIVE_DIR, { recursive: true }),
  ])
}

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message)
  }
}

function normalizeImportedAutomationModelId(value: string): string {
  return value === 'gpt-5.2' ? 'gpt-5.4' : value
}

function normalizeImportedAutomationTaskKey(taskKey: string): string {
  const parts = taskKey.split(':')
  if (parts.length < 2) {
    return taskKey
  }

  const tail = normalizeImportedAutomationModelId(parts[parts.length - 1] ?? '')
  if (tail === parts[parts.length - 1]) {
    return taskKey
  }

  parts[parts.length - 1] = tail
  return parts.join(':')
}

function normalizeImportDecision(raw: unknown, modelId: ReturnType<typeof getDailyRunAutomationModelId>): DailyRunAutomationDecisionItem {
  assertObject(raw, 'Each imported decision must be an object')

  const marketId = typeof raw.marketId === 'string' ? raw.marketId.trim() : ''
  const trialQuestionId = typeof raw.trialQuestionId === 'string' ? raw.trialQuestionId.trim() : ''
  const rawModelId = typeof raw.modelId === 'string' ? raw.modelId.trim() : ''
  if (!marketId || !trialQuestionId || !rawModelId) {
    throw new ValidationError('Each imported decision must include marketId, trialQuestionId, and modelId')
  }
  const normalizedRawModelId = normalizeImportedAutomationModelId(rawModelId)
  if (normalizedRawModelId !== modelId) {
    throw new ValidationError(`Imported modelId ${rawModelId} does not match the selected automation source`)
  }

  const decision = parseModelDecisionResponse(
    JSON.stringify(raw.decision ?? null),
    ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
    220,
  )

  return {
    taskKey: typeof raw.taskKey === 'string' && raw.taskKey.trim().length > 0
      ? normalizeImportedAutomationTaskKey(raw.taskKey.trim())
      : buildDailyRunAutomationTaskKey(marketId, modelId),
    marketId,
    trialQuestionId,
    modelId,
    decision,
  }
}

function parseAutomationImportFile(args: {
  contents: string
  source?: DailyRunAutomationSource
  filename?: string | null
}): ParsedAutomationImport {
  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(args.contents)
  } catch (error) {
    throw new ValidationError('Decision file must be valid JSON', { cause: error })
  }

  const fallbackSource = args.source

  if (Array.isArray(parsedRaw)) {
    if (!fallbackSource) {
      throw new ValidationError('source is required when importing a bare decision array')
    }

    const modelId = getDailyRunAutomationModelId(fallbackSource)
    return {
      source: fallbackSource,
      modelId,
      runDate: normalizeRunDate(new Date()),
      filename: args.filename ?? null,
      decisions: parsedRaw.map((item) => normalizeImportDecision(item, modelId)),
    }
  }

  assertObject(parsedRaw, 'Decision file must be a JSON object or array')
  if (parsedRaw.workflow !== 'admin-ai-automation-handoff') {
    throw new ValidationError('Decision file workflow must be admin-ai-automation-handoff')
  }

  const fileSource = typeof parsedRaw.source === 'string' ? parsedRaw.source.trim() as DailyRunAutomationSource : undefined
  const source = fileSource ?? fallbackSource
  if (!source) {
    throw new ValidationError('Decision file must include a supported source')
  }

  const modelId = getDailyRunAutomationModelId(source)
  const runDate = typeof parsedRaw.runDate === 'string'
    ? new Date(parsedRaw.runDate)
    : new Date()
  if (Number.isNaN(runDate.getTime())) {
    throw new ValidationError('Decision file runDate must be a valid ISO string')
  }

  const decisionsRaw = parsedRaw.decisions
  if (!Array.isArray(decisionsRaw) || decisionsRaw.length === 0) {
    throw new ValidationError('Decision file must include a non-empty decisions array')
  }

  return {
    source,
    modelId,
    runDate: normalizeRunDate(runDate),
    filename: args.filename ?? null,
    decisions: decisionsRaw.map((item) => normalizeImportDecision(item, modelId)),
  }
}

export async function exportDailyRunAutomationPacket(args: {
  source: DailyRunAutomationSource
  runDate?: Date
  nctNumber?: string
}): Promise<{
  packet: DailyRunAutomationExportPacket
  filePath: string
}> {
  await ensureAutomationHandoffDirectories()

  const runDate = normalizeRunDate(args.runDate ?? new Date())
  const modelId = getDailyRunAutomationModelId(args.source)
  const prepared = await prepareDailyRunContext(runDate, {
    nctNumber: args.nctNumber,
    modelIds: [modelId],
  })
  const actorId = prepared.actorIdByModelId.get(modelId)
  if (!actorId) {
    throw new Error(`Missing market actor for ${modelId}`)
  }

  const tasks = prepared.scopedOpenMarkets.map((market) => {
    const question = prepared.questionById.get(market.trialQuestionId)
    if (!question) {
      throw new Error(`Missing trial question for market ${market.id}`)
    }

    const account = prepared.accountByActorId.get(actorId)
    const position = prepared.positionByMarketActorKey.get(getDailyRunPositionKey(market.id, actorId))
    if (!account || !position) {
      throw new Error(`Missing account or position state for ${modelId} on market ${market.id}`)
    }

    const { input } = buildModelDecisionSnapshotInput({
      runSource: 'cycle',
      runId: null,
      modelId,
      actorId,
      runDate,
      trial: question.trial,
      trialQuestionId: question.id,
      questionPrompt: normalizeTrialQuestionPrompt(question.prompt),
      market,
      account,
      position,
      runtimeConfig: prepared.runtimeConfig,
    })

    return {
      taskKey: buildDailyRunAutomationTaskKey(market.id, modelId),
      marketId: market.id,
      trialQuestionId: question.id,
      modelId,
      shortTitle: question.trial.shortTitle,
      sponsorName: question.trial.sponsorName,
      nctNumber: question.trial.nctNumber,
      decisionDate: question.trial.estPrimaryCompletionDate.toISOString(),
      input,
      prompt: buildModelDecisionPrompt(input),
    }
  })

  const packet: DailyRunAutomationExportPacket = {
    version: 1,
    workflow: 'admin-ai-automation-handoff',
    exportedAt: new Date().toISOString(),
    runDate: prepared.runDateIso,
    source: args.source,
    modelId,
    nctNumber: prepared.scopedNctNumber,
    taskCount: tasks.length,
    tasks,
  }

  const filePath = path.join(
    HANDOFF_EXPORTS_DIR,
    buildExportFilename(args.source, runDate, prepared.scopedNctNumber),
  )
  await writeFile(filePath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')

  return {
    packet,
    filePath,
  }
}

export async function previewDailyRunAutomationImport(args: {
  contents: string
  source?: DailyRunAutomationSource
  filename?: string | null
}): Promise<PreparedAutomationImportPreview> {
  const parsed = parseAutomationImportFile(args)
  const duplicateKeys = new Set<string>()
  const seenKeys = new Set<string>()

  for (const item of parsed.decisions) {
    const taskKey = item.taskKey ?? buildDailyRunAutomationTaskKey(item.marketId, item.modelId)
    if (seenKeys.has(taskKey)) {
      duplicateKeys.add(taskKey)
    }
    seenKeys.add(taskKey)
  }

  const uniqueMarketIds = Array.from(new Set(parsed.decisions.map((item) => item.marketId)))
  const [markets, actorIdByModelId] = await Promise.all([
    db.query.predictionMarkets.findMany({
      where: inArray(predictionMarkets.id, uniqueMarketIds),
      with: {
        trialQuestion: {
          with: {
            trial: true,
          },
        },
      },
    }),
    getModelActorIds([parsed.modelId]),
  ])

  const openMarketById = new Map(
    markets
      .filter((market) => market.status === 'OPEN' && market.trialQuestionId && market.trialQuestion)
      .map((market) => [market.id, market] as const),
  )

  const actorId = actorIdByModelId.get(parsed.modelId)
  if (!actorId) {
    throw new Error(`Missing market actor for ${parsed.modelId}`)
  }

  const existingActions = await db.query.marketActions.findMany({
    where: and(
      inArray(marketActions.marketId, uniqueMarketIds),
      eq(marketActions.actorId, actorId),
      eq(marketActions.runDate, parsed.runDate),
      eq(marketActions.actionSource, 'cycle'),
    ),
  })
  const existingActionByMarketId = new Map(existingActions.map((action) => [action.marketId, action]))

  const items: DailyRunAutomationPreviewItem[] = []
  const readyDecisionMap = new Map<string, DailyRunAutomationDecisionItem>()

  for (const item of parsed.decisions) {
    const taskKey = item.taskKey ?? buildDailyRunAutomationTaskKey(item.marketId, item.modelId)
    const market = openMarketById.get(item.marketId)
    const existingAction = existingActionByMarketId.get(item.marketId)
    const trialQuestion = market?.trialQuestion

    let status: DailyRunAutomationPreviewItem['status'] = 'ready'
    let message = 'Ready to apply imported decision.'

    if (duplicateKeys.has(taskKey)) {
      status = 'invalid'
      message = 'Duplicate task key inside the imported decision file.'
    } else if (!market || !trialQuestion) {
      status = 'invalid'
      message = 'Market is no longer open or no longer linked to a live trial question.'
    } else if (trialQuestion.id !== item.trialQuestionId) {
      status = 'invalid'
      message = 'trialQuestionId does not match the current open market.'
    } else if (existingAction && existingAction.status !== 'error') {
      status = 'duplicate'
      message = 'Action already exists for this model and run date.'
    } else if (existingAction?.status === 'error') {
      message = 'Existing error action will be retried on apply.'
    }

    items.push({
      taskKey,
      marketId: item.marketId,
      trialQuestionId: item.trialQuestionId,
      modelId: item.modelId,
      shortTitle: trialQuestion?.trial.shortTitle ?? 'Unknown trial',
      nctNumber: trialQuestion?.trial.nctNumber ?? null,
      status,
      message,
      actionType: item.decision.action.type,
      amountUsd: item.decision.action.amountUsd,
    })

    if (status === 'ready') {
      readyDecisionMap.set(taskKey, item)
    }
  }

  const readyCount = items.filter((item) => item.status === 'ready').length
  const duplicateCount = items.filter((item) => item.status === 'duplicate').length
  const invalidCount = items.filter((item) => item.status === 'invalid').length

  return {
    preview: {
      source: parsed.source,
      sourceLabel: getDailyRunAutomationSourceLabel(parsed.source),
      modelId: parsed.modelId,
      modelLabel: getDailyRunAutomationModelLabel(parsed.source),
      runDate: parsed.runDate.toISOString(),
      filename: parsed.filename,
      totalDecisions: items.length,
      readyCount,
      duplicateCount,
      invalidCount,
      items,
    },
    normalizedRunDate: parsed.runDate,
    marketIds: uniqueMarketIds,
    modelId: parsed.modelId,
    readyDecisionMap,
  }
}

export async function archiveDailyRunAutomationImport(args: {
  contents: string
  filename?: string | null
}): Promise<string> {
  await ensureAutomationHandoffDirectories()
  const archivePath = path.join(HANDOFF_ARCHIVE_DIR, buildArchiveFilename(args.filename ?? null))
  await writeFile(archivePath, args.contents, 'utf8')
  return archivePath
}

export function getDailyRunAutomationPaths(): {
  root: string
  exportsDir: string
  decisionsDir: string
  archiveDir: string
} {
  return {
    root: HANDOFF_ROOT,
    exportsDir: HANDOFF_EXPORTS_DIR,
    decisionsDir: HANDOFF_DECISIONS_DIR,
    archiveDir: HANDOFF_ARCHIVE_DIR,
  }
}
