import { NextRequest } from 'next/server'
import { createRequestId, errorResponse } from '@/lib/api-response'
import { ensureAdmin } from '@/lib/admin-auth'
import { ValidationError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    throw new ValidationError('Manual decision reruns on the legacy snapshot stream are disabled in season 4. Use Admin AI to stage a batch, collect/import decisions, then Execute Trades from a ready batch.')
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to start streaming model decision')
  }
}

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    throw new ValidationError('The legacy model decision stream is retired in season 4. Use /api/admin/season4/decision-snapshots for read-only snapshot history.')
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch model decisions')
  }
}
