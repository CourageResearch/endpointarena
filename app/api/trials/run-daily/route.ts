import { createRequestId, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

function buildLegacyDailyRunError() {
  return new ValidationError('Legacy offchain daily trial runs are retired in season 4. Use the season 4 model cycle from /admin/base or /api/admin/season4/model-cycle/run instead.')
}

export async function GET() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyDailyRunError(), requestId, 'Legacy daily run route is disabled')
}

export async function POST() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyDailyRunError(), requestId, 'Legacy daily run route is disabled')
}
