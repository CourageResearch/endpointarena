import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { ConfigurationError, UnauthorizedError } from '@/lib/errors'
import { runTrialMonitor } from '@/lib/trial-monitor'

function assertAuthorized(request: NextRequest): void {
  const secret = process.env.TRIAL_MONITOR_CRON_SECRET?.trim()
  if (!secret) {
    throw new ConfigurationError('TRIAL_MONITOR_CRON_SECRET is not set')
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    throw new UnauthorizedError('Unauthorized')
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    assertAuthorized(request)

    const result = await runTrialMonitor({
      triggerSource: 'cron',
      force: false,
      questionSelection: 'all_open_trials',
    })

    revalidatePath('/admin/outcomes')

    return successResponse({ result }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to run scheduled trial monitor')
  }
}

export const GET = POST
