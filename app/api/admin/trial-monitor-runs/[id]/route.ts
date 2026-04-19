import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { deleteTrialMonitorRun } from '@/lib/trial-monitor'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { id } = await params
    await deleteTrialMonitorRun(id)

    revalidatePath('/admin/oracle')

    return successResponse({ success: true }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to delete trial monitor run')
  }
}
