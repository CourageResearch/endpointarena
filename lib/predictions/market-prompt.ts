import { MARKET_ACTIONS, type MarketActionType } from '@/lib/markets/constants'

export interface OtherOpenMarketContext {
  marketId: string
  fdaEventId: string
  drugName: string
  companyName: string
  pdufaDate: string
  marketPriceYes: number
}

export interface MarketDecisionInput {
  runDateIso: string
  modelId: string
  drugName: string
  companyName: string
  symbols: string | null
  applicationType: string
  pdufaDate: string
  eventDescription: string
  therapeuticArea: string | null
  marketPriceYes: number
  marketPriceNo: number
  accountCash: number
  positionYesShares: number
  positionNoShares: number
  totalOpenMarkets: number
  marketsRemainingThisRun: number
  otherOpenMarkets: OtherOpenMarketContext[]
}

export interface MarketDecisionResult {
  action: MarketActionType
  amountUsd: number
  explanation: string
}

const EXPLANATION_MAX_CHARS = 220
const EXPLANATION_MAX_SENTENCES = 2

function sanitizeAmount(amount: unknown, maxCash: number): number {
  const parsed = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(parsed, maxCash))
}

function sanitizeNonNegativeAmount(amount: unknown): number {
  const parsed = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function sanitizeAction(action: unknown): MarketActionType {
  const value = String(action || '').trim().toUpperCase()
  if ((MARKET_ACTIONS as readonly string[]).includes(value)) {
    return value as MarketActionType
  }
  return 'HOLD'
}

function extractBalancedJsonObject(raw: string, startIndex: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIndex; i < raw.length; i++) {
    const ch = raw[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      depth++
      continue
    }

    if (ch === '}') {
      depth--
      if (depth === 0) {
        return raw.slice(startIndex, i + 1)
      }
    }
  }

  return null
}

function extractJsonBlock(raw: string): string {
  const normalized = raw.trim()
  if (!normalized) {
    throw new Error('Empty model response')
  }

  const codeBlockMatch = normalized.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1]
  }

  const actionKeyIndex = normalized.search(/"(?:action|amountUsd|explanation)"/)
  if (actionKeyIndex !== -1) {
    const start = normalized.lastIndexOf('{', actionKeyIndex)
    if (start !== -1) {
      const balanced = extractBalancedJsonObject(normalized, start)
      if (balanced) return balanced
    }
  }

  const firstBrace = normalized.indexOf('{')
  if (firstBrace !== -1) {
    const balanced = extractBalancedJsonObject(normalized, firstBrace)
    if (balanced) return balanced
  }

  throw new Error(`No JSON object found in model response. Preview: ${normalized.slice(0, 240)}`)
}

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const clipped = text.slice(0, maxChars + 1)
  const boundary = clipped.lastIndexOf(' ')
  const safe = boundary >= Math.floor(maxChars * 0.6) ? clipped.slice(0, boundary) : clipped.slice(0, maxChars)
  return `${safe.replace(/[ ,;:]+$/, '')}...`
}

function sanitizeExplanation(value: unknown): string {
  if (typeof value !== 'string') return 'No explanation provided.'

  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'No explanation provided.'

  const sentenceMatches = normalized.match(/[^.!?]+[.!?]*/g)
  const sentenceLimited = sentenceMatches?.length
    ? sentenceMatches
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, EXPLANATION_MAX_SENTENCES)
        .join(' ')
    : normalized

  return truncateAtWordBoundary(sentenceLimited, EXPLANATION_MAX_CHARS)
}

export function buildMarketDecisionPrompt(input: MarketDecisionInput): string {
  const approxYesPositionValue = input.positionYesShares * input.marketPriceYes
  const approxNoPositionValue = input.positionNoShares * input.marketPriceNo
  const otherOpenMarketsForPrompt = input.otherOpenMarkets.slice(0, 8)
  const otherOpenMarketLines = otherOpenMarketsForPrompt.map((market) => (
    `- ${market.drugName} (${market.companyName}) | YES ${(market.marketPriceYes * 100).toFixed(1)}% | PDUFA ${market.pdufaDate}`
  ))
  const hiddenOtherOpenMarketsCount = Math.max(0, input.otherOpenMarkets.length - otherOpenMarketsForPrompt.length)
  const otherOpenMarketsText = otherOpenMarketLines.length > 0
    ? otherOpenMarketLines.join('\n')
    : '- None'
  const otherOpenMarketsMoreText = hiddenOtherOpenMarketsCount > 0
    ? `\n- ...and ${hiddenOtherOpenMarketsCount} more open market${hiddenOtherOpenMarketsCount === 1 ? '' : 's'}.`
    : ''

  return `You are participating in a play-money FDA approval prediction market.

Current UTC date: ${input.runDateIso}
Model: ${input.modelId}

Market contract:
- Event: ${input.drugName} (${input.companyName}) receives FDA approval by its decision date.
- YES resolves to $1 if Approved, else $0.
- NO resolves to $1 if Rejected, else $0.

Event data:
- Ticker(s): ${input.symbols || 'N/A'}
- Application type: ${input.applicationType}
- PDUFA date: ${input.pdufaDate}
- Therapeutic area: ${input.therapeuticArea || 'N/A'}
- Notes: ${input.eventDescription}

Market state:
- YES price: ${(input.marketPriceYes * 100).toFixed(2)}%
- NO price: ${(input.marketPriceNo * 100).toFixed(2)}%

Market breadth context:
- Open markets this cycle: ${input.totalOpenMarkets}
- Markets remaining after this decision: ${input.marketsRemainingThisRun}
- Other open markets:
${otherOpenMarketsText}${otherOpenMarketsMoreText}

Your portfolio:
- Cash available: $${input.accountCash.toFixed(2)}
- YES shares held: ${input.positionYesShares.toFixed(4)}
- NO shares held: ${input.positionNoShares.toFixed(4)}
- Approx YES position value: $${approxYesPositionValue.toFixed(2)}
- Approx NO position value: $${approxNoPositionValue.toFixed(2)}

Task:
1) Choose exactly one action: BUY_YES, BUY_NO, SELL_YES, SELL_NO, or HOLD.
2) If BUY_YES or BUY_NO, amountUsd is cash to spend (0 to available cash).
3) If SELL_YES or SELL_NO, amountUsd is target proceeds to take off that side (0 to estimated value of shares held on that side). If you hold no shares on that side, use HOLD.
4) Provide explanation as 1-2 short sentences, <= ${EXPLANATION_MAX_CHARS} characters total.
5) Mention only the top probability driver(s) and valuation/stock impact in plain language.
6) No numbered lists, no bullet points, no long background.

Output must be valid JSON only:
{
  "action": "BUY_YES | BUY_NO | SELL_YES | SELL_NO | HOLD",
  "amountUsd": number,
  "explanation": "1-2 short sentences, <= ${EXPLANATION_MAX_CHARS} chars"
}`
}

export function parseMarketDecisionResponse(raw: string, maxCash: number): MarketDecisionResult {
  const json = JSON.parse(extractJsonBlock(raw)) as {
    action?: unknown
    amountUsd?: unknown
    explanation?: unknown
  }

  const action = sanitizeAction(json.action)
  const amountUsd =
    action === 'HOLD'
      ? 0
      : (action === 'BUY_YES' || action === 'BUY_NO')
        ? sanitizeAmount(json.amountUsd, maxCash)
        : sanitizeNonNegativeAmount(json.amountUsd)
  const explanation = sanitizeExplanation(json.explanation)

  return {
    action,
    amountUsd,
    explanation,
  }
}
