import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import {
  getActiveDatabaseTarget,
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

    return successResponse({
      target: getActiveDatabaseTarget(),
      targets: listDatabaseTargets(),
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
    if (target === 'toy') {
      await ensureToyDatabaseSchema()
    }
    const activeTarget = setActiveDatabaseTarget(target)

    revalidatePath('/', 'layout')
    revalidatePath('/admin/settings')

    return successResponse({
      target: activeTarget,
      targets: listDatabaseTargets(),
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to switch database target')
  }
}
