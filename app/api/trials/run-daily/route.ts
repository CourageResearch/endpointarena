import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

function buildLegacyDailyRunError() {
  return new ValidationError('Legacy offchain daily trial runs are retired in season 4. Use /admin/ai to stage a batch, collect/import decisions, then Execute Trades from a ready batch.')
}

export async function GET() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyDailyRunError(), requestId, 'Legacy daily run route is disabled')
}

export async function POST() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyDailyRunError(), requestId, 'Legacy daily run route is disabled')
}
