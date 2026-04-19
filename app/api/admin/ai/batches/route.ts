import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { createAiBatch } from '@/lib/admin-ai'
import {
  AI_API_CONCURRENCY_MAX,
  AI_API_CONCURRENCY_MIN,
  isAiApiConcurrency,
} from '@/lib/admin-ai-shared'
import { validateRequestedAiDatasetForActiveDatabase } from '@/lib/admin-ai-active-dataset'
import { isModelId } from '@/lib/constants'
import { ValidationError } from '@/lib/errors'

type CreateBatchBody = {
  dataset?: string
  enabledModelIds?: string[]
  apiConcurrency?: number
  runDate?: string
}

function parseToyBatchRunDate(value: unknown): Date | undefined {
  if (value == null) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new ValidationError('runDate must be a YYYY-MM-DD string')
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    throw new ValidationError('runDate must be a YYYY-MM-DD string')
  }

  const [, yearRaw, monthRaw, dayRaw] = match
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new ValidationError('runDate must be a real calendar date')
  }

  return parsed
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<CreateBatchBody>(request)
    const dataset = validateRequestedAiDatasetForActiveDatabase(body.dataset)

    const rawEnabledModelIds = Array.isArray(body.enabledModelIds)
      ? body.enabledModelIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
      : []
    const invalidModel = rawEnabledModelIds.find((value) => !isModelId(value))
    if (invalidModel) {
      throw new ValidationError(`Unknown model id: ${invalidModel}`)
    }
    const enabledModelIds = rawEnabledModelIds.filter(isModelId)
    if (body.apiConcurrency != null && !isAiApiConcurrency(body.apiConcurrency)) {
      throw new ValidationError(`apiConcurrency must be an integer between ${AI_API_CONCURRENCY_MIN} and ${AI_API_CONCURRENCY_MAX}`)
    }
    const runDate = parseToyBatchRunDate(body.runDate)
    if (runDate && dataset !== 'toy') {
      throw new ValidationError('runDate backtesting is only available when Toy DB is active.')
    }

    const batch = await createAiBatch({
      dataset,
      enabledModelIds,
      apiConcurrency: body.apiConcurrency,
      runDate,
    })

    return successResponse({ batch }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to create AI batch')
  }
}
