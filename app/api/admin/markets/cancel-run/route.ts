import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

function buildLegacyDailyRunCancelError() {
  return new ValidationError('Legacy offchain daily trial run controls are retired in season 4. Use the season 4 model-cycle controls from /admin/base instead.')
}

export async function POST() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyDailyRunCancelError(), requestId, 'Legacy daily run control route is disabled')
}
