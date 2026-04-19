import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import {
  getDatabaseTargetRuntimeState,
  listDatabaseTargets,
  parseDatabaseTarget,
  setActiveDatabaseTarget,
} from '@/lib/database-target'
import { ensureToyDatabaseSchema } from '@/lib/toy-database'

type RequestBody = {
  target?: unknown
}

export async function GET() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const runtimeState = getDatabaseTargetRuntimeState()

    return successResponse({
      target: runtimeState.activeTarget,
      targets: listDatabaseTargets(),
      runtimeState,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load database target')
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<RequestBody>(request)
    const target = parseDatabaseTarget(body.target)
    const runtimeState = getDatabaseTargetRuntimeState()
    if (!runtimeState.switchingAllowed) {
      throw new ValidationError(runtimeState.sourceDescription)
    }

    if (target === 'toy') {
      await ensureToyDatabaseSchema()
    }
    const activeTarget = setActiveDatabaseTarget(target)

    revalidatePath('/', 'layout')
    revalidatePath('/admin/settings')

    return successResponse({
      target: activeTarget,
      targets: listDatabaseTargets(),
      runtimeState: getDatabaseTargetRuntimeState(),
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to switch database target')
  }
}
