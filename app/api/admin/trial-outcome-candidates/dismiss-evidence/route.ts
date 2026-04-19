import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdminSession } from '@/lib/admin-auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { dismissTrialOutcomeCandidates } from '@/lib/trial-monitor'

type PostBody = {
  candidateIds?: unknown
}

function normalizeCandidateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('candidateIds must be a non-empty array')
  }

  const normalizedCandidateIds = value.map((candidateId) => {
    if (typeof candidateId !== 'string') {
      throw new ValidationError('candidateIds must be an array of strings')
    }

    const trimmedCandidateId = candidateId.trim()
    if (trimmedCandidateId.length === 0) {
      throw new ValidationError('candidateIds must not contain empty ids')
    }

    return trimmedCandidateId
  })

  return Array.from(new Set(normalizedCandidateIds))
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    const session = await requireAdminSession()
    const reviewerId = session.user.id ?? null
    const body = await parseJsonBody<PostBody>(request)
    const candidateIds = normalizeCandidateIds(body.candidateIds)

    const result = await dismissTrialOutcomeCandidates({
      candidateIds,
      reviewerId,
      reviewNotes: null,
    })

    revalidatePath('/')
    revalidatePath('/leaderboard')
    revalidatePath('/trials')
    revalidatePath('/admin/ai')
    revalidatePath('/admin/trials')
    revalidatePath('/admin/oracle')

    return successResponse({
      success: true,
      dismissedIds: result.dismissedIds,
      dismissedCount: result.dismissedCount,
      skippedCount: result.skippedCount,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to dismiss evidence-only oracle items')
  }
}
