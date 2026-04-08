import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import {
  DAILY_RUN_AUTOMATION_SOURCES,
  type DailyRunAutomationSource,
} from '@/lib/markets/automation-handoff-shared'
import { getDailyRunAutomationPaths } from '@/lib/markets/automation-handoff'

function resolveAutomationSource(value: string | null): DailyRunAutomationSource {
  if (!value) {
    throw new ValidationError('source is required')
  }

  const normalized = value.trim() as DailyRunAutomationSource
  if (!DAILY_RUN_AUTOMATION_SOURCES.includes(normalized)) {
    throw new ValidationError(`Unsupported automation source: ${value}`)
  }

  return normalized
}

function matchesSource(filename: string, source: DailyRunAutomationSource) {
  const lower = filename.toLowerCase()
  return source === 'codex-subscription'
    ? lower.includes('codex')
    : lower.includes('claude')
}

export async function GET(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const source = resolveAutomationSource(new URL(request.url).searchParams.get('source'))
    const { decisionsDir } = getDailyRunAutomationPaths()
    const entries = await readdir(decisionsDir, { withFileTypes: true })

    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json') && matchesSource(entry.name, source))
      .map((entry) => entry.name)

    if (candidates.length === 0) {
      throw new ValidationError(`No ${source} decision JSON files were found in ${decisionsDir}`)
    }

    const enriched = await Promise.all(candidates.map(async (filename) => {
      const fullPath = path.join(decisionsDir, filename)
      const stats = await stat(fullPath)
      return {
        filename,
        fullPath,
        modifiedAtMs: stats.mtimeMs,
      }
    }))

    const latest = enriched.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0]
    const contents = await readFile(latest.fullPath, 'utf8')

    return successResponse({
      filename: latest.filename,
      filePath: latest.fullPath,
      contents,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load automation decision file')
  }
}
