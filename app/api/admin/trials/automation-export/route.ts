import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseOptionalJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import {
  DAILY_RUN_AUTOMATION_SOURCES,
  type DailyRunAutomationSource,
} from '@/lib/markets/automation-handoff-shared'
import {
  exportDailyRunAutomationPacket,
  getDailyRunAutomationPaths,
} from '@/lib/markets/automation-handoff'

function resolveAutomationSource(value: unknown): DailyRunAutomationSource {
  if (typeof value !== 'string') {
    throw new ValidationError('source is required')
  }

  const normalized = value.trim() as DailyRunAutomationSource
  if (!DAILY_RUN_AUTOMATION_SOURCES.includes(normalized)) {
    throw new ValidationError(`Unsupported automation source: ${value}`)
  }

  return normalized
}

function resolveScopedNctNumber(input: unknown): string | undefined {
  if (input == null || input === '') {
    return undefined
  }

  if (typeof input !== 'string') {
    throw new ValidationError('nctNumber must be a string')
  }

  const normalized = input.trim().toUpperCase()
  if (!/^NCT\d{8}$/.test(normalized)) {
    throw new ValidationError('nctNumber must look like NCT12345678')
  }

  return normalized
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseOptionalJsonBody<{
      source?: string
      nctNumber?: string
    }>(request, {})

    const source = resolveAutomationSource(body.source)
    const nctNumber = resolveScopedNctNumber(body.nctNumber)
    const result = await exportDailyRunAutomationPacket({
      source,
      nctNumber,
    })

    return successResponse({
      ...result,
      paths: getDailyRunAutomationPaths(),
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to export automation packet')
  }
}
