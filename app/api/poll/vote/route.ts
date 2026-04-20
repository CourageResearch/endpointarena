import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import {
  POLL_VOTER_COOKIE_NAME,
  formatPollDate,
  getPollVoterCookieOptions,
  getPollVoterHash,
  getPollWeekStartDate,
  isSuggestedPollNctNumber,
  normalizePollNctNumber,
  normalizePollVoterToken,
  recordPollVote,
} from '@/lib/poll'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PollVoteRequest = {
  nctNumber?: unknown
}

function normalizeRequestNctNumber(value: unknown): string {
  const nctNumber = normalizePollNctNumber(typeof value === 'string' ? value : null)
  if (!nctNumber) {
    throw new ValidationError('Choose a valid NCT number.')
  }
  return nctNumber
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const body = await parseJsonBody<PollVoteRequest>(request)
    const nctNumber = normalizeRequestNctNumber(body.nctNumber)
    const isSuggested = await isSuggestedPollNctNumber(nctNumber)

    if (!isSuggested) {
      throw new ValidationError('This NCT is not in the suggestion inbox yet.')
    }

    const cookieStore = await cookies()
    const existingToken = normalizePollVoterToken(cookieStore.get(POLL_VOTER_COOKIE_NAME)?.value)
    const voterToken = existingToken ?? crypto.randomUUID()
    const voterHash = await getPollVoterHash(voterToken)
    const weekStartDate = getPollWeekStartDate()
    const vote = await recordPollVote({
      nctNumber,
      voterHash,
      weekStartDate,
    })

    revalidatePath('/poll')

    const response = successResponse(
      {
        ok: true,
        nctNumber: vote.nctNumber,
        weekStartDate: formatPollDate(vote.weekStartDate),
      },
      {
        headers: {
          'X-Request-Id': requestId,
        },
      },
    )

    response.cookies.set(POLL_VOTER_COOKIE_NAME, voterToken, getPollVoterCookieOptions())
    return response
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to record poll vote')
  }
}
