import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

function buildLegacyDailyRunCancelError() {
  return new ValidationError('Legacy offchain daily trial run controls are retired in season 4. Use Admin AI to stage a batch, collect/import decisions, then Execute Trades from a ready batch.')
}

export async function POST() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyDailyRunCancelError(), requestId, 'Legacy daily run control route is disabled')
}
