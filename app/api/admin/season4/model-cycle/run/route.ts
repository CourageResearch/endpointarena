import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

export async function POST() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    throw new ValidationError('Direct Season 4 model-cycle execution is retired. Use /admin/ai to stage a batch, collect/import decisions, then Execute Trades from a ready batch.')
  } catch (error) {
    return errorResponse(error, requestId, 'Direct Season 4 model-cycle execution is retired')
  }
}
