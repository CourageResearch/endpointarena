import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { executeDailyRun } from '@/lib/markets/daily-run'
import {
  DAILY_RUN_AUTOMATION_SOURCES,
  type DailyRunAutomationSource,
} from '@/lib/markets/automation-handoff-shared'
import {
  archiveDailyRunAutomationImport,
  getDailyRunAutomationPaths,
  previewDailyRunAutomationImport,
} from '@/lib/markets/automation-handoff'

function resolveMode(requestUrl: string): 'dry-run' | 'apply' {
  const mode = new URL(requestUrl).searchParams.get('mode') ?? 'dry-run'
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new ValidationError('mode must be dry-run or apply')
  }
  return mode
}

function resolveAutomationSource(value: unknown): DailyRunAutomationSource | undefined {
  if (value == null || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new ValidationError('source must be a string')
  }

  const normalized = value.trim() as DailyRunAutomationSource
  if (!DAILY_RUN_AUTOMATION_SOURCES.includes(normalized)) {
    throw new ValidationError(`Unsupported automation source: ${value}`)
  }
  return normalized
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const mode = resolveMode(request.url)
    const body = await parseOptionalJsonBody<{
      source?: string
      contents?: string
      filename?: string | null
    }>(request, {})

    const source = resolveAutomationSource(body.source)
    const contents = typeof body.contents === 'string' ? body.contents.trim() : ''
    if (!contents) {
      throw new ValidationError('contents is required')
    }

    const previewResult = await previewDailyRunAutomationImport({
      source,
      contents,
      filename: body.filename ?? null,
    })

    if (mode === 'dry-run') {
      return successResponse({
        preview: previewResult.preview,
        paths: getDailyRunAutomationPaths(),
      }, {
        headers: {
          'X-Request-Id': requestId,
        },
      })
    }

    if (previewResult.preview.invalidCount > 0) {
      throw new ValidationError('Fix invalid imported decisions before apply')
    }

    const executionDecisions = new Map(
      Array.from(previewResult.readyDecisionMap.entries()).map(([taskKey, item]) => [taskKey, {
        source: previewResult.preview.source,
        decision: item.decision,
      }]),
    )

    const payload = await executeDailyRun(previewResult.normalizedRunDate, {
      marketIds: previewResult.marketIds,
      modelIds: [previewResult.modelId],
      importedDecisions: executionDecisions,
      importedDecisionSource: previewResult.preview.source,
    })

    const archivePath = await archiveDailyRunAutomationImport({
      contents,
      filename: body.filename ?? null,
    })

    return successResponse({
      preview: previewResult.preview,
      payload,
      archivePath,
      paths: getDailyRunAutomationPaths(),
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to import automation decisions')
  }
}
