import { NextRequest } from 'next/server'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    throw new ValidationError('Legacy FDA-only prediction writes are disabled. Use /api/model-decisions/stream instead.')
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to generate predictions')
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    throw new ValidationError('Legacy FDA-only prediction deletion is disabled. Decision snapshots are append-only.')
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to delete predictions')
  }
}
