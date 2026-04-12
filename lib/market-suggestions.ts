const MARKET_SUGGESTION_HEADER = 'Market suggestion request'
const MARKET_SUGGESTION_REQUESTED_NCT_PREFIX = 'Requested NCT: '
const MARKET_SUGGESTION_DETAILS_LABEL = 'Additional context:'
export const EMPTY_MARKET_SUGGESTION_DETAILS = 'No additional context provided.'
export const MARKET_SUGGESTION_MESSAGE_PREFIX = `${MARKET_SUGGESTION_HEADER}\n${MARKET_SUGGESTION_REQUESTED_NCT_PREFIX}`

const MARKET_SUGGESTION_DETAILS_SEPARATOR = `\n\n${MARKET_SUGGESTION_DETAILS_LABEL}\n`

export function normalizeMarketSuggestionNctNumber(value: string): string {
  return value.trim()
}

export function buildMarketSuggestionMessage(nctNumber: string, details: string): string {
  return [
    MARKET_SUGGESTION_HEADER,
    `${MARKET_SUGGESTION_REQUESTED_NCT_PREFIX}${normalizeMarketSuggestionNctNumber(nctNumber)}`,
    '',
    MARKET_SUGGESTION_DETAILS_LABEL,
    details,
  ].join('\n')
}

function isMarketSuggestionMessage(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false
  return message.replace(/\r\n/g, '\n').trim().startsWith(MARKET_SUGGESTION_MESSAGE_PREFIX)
}

export function parseMarketSuggestionMessage(message: string | null | undefined): {
  nctNumber: string | null
  details: string | null
  rawMessage: string
} | null {
  if (!isMarketSuggestionMessage(message)) {
    return null
  }

  const rawMessage = message!.replace(/\r\n/g, '\n').trim()
  const lines = rawMessage.split('\n')
  const requestedNctLine = lines[1] ?? ''
  const nctCandidate = normalizeMarketSuggestionNctNumber(
    requestedNctLine.startsWith(MARKET_SUGGESTION_REQUESTED_NCT_PREFIX)
      ? requestedNctLine.slice(MARKET_SUGGESTION_REQUESTED_NCT_PREFIX.length)
      : ''
  )
  const detailsStart = rawMessage.indexOf(MARKET_SUGGESTION_DETAILS_SEPARATOR)
  const rawDetails = detailsStart === -1
    ? null
    : rawMessage.slice(detailsStart + MARKET_SUGGESTION_DETAILS_SEPARATOR.length).trim()
  const details = !rawDetails || rawDetails === EMPTY_MARKET_SUGGESTION_DETAILS
    ? null
    : rawDetails

  return {
    nctNumber: nctCandidate.length > 0 ? nctCandidate : null,
    details,
    rawMessage,
  }
}

export function getClinicalTrialsGovStudyUrl(nctNumber: string): string {
  return `https://clinicaltrials.gov/study/${encodeURIComponent(nctNumber)}`
}
