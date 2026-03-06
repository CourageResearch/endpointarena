import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

export async function POST(_request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    throw new ValidationError('Legacy FDA-only streaming writes are disabled. Use /api/model-decisions/stream instead.')
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to start streaming prediction')
  }
}
