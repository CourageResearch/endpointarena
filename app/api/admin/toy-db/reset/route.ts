import { revalidatePath } from 'next/cache'
import { ensureAdmin } from '@/lib/admin-auth'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { resetToyDatabase } from '@/lib/toy-database'

export async function POST() {
  const requestId = createRequestId()

  try {
    await ensureAdmin()
    const summary = await resetToyDatabase()

    revalidatePath('/', 'layout')
    revalidatePath('/admin/settings')
    revalidatePath('/admin/ai')
    revalidatePath('/leaderboard')
    revalidatePath('/profile')
    revalidatePath('/trials')

    return successResponse({ summary }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to reset Toy DB')
  }
}
