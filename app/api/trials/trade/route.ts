import {
  createRequestId,
  errorResponse,
} from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'

function buildLegacyTradingError() {
  return new ValidationError('Legacy offchain trial trading is retired in season 4. Use the season 4 market page and onchain trade flow instead.')
}

export async function GET() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyTradingError(), requestId, 'Legacy trading route is disabled')
}

export async function POST() {
  const requestId = createRequestId()
  return errorResponse(buildLegacyTradingError(), requestId, 'Legacy trading route is disabled')
}
