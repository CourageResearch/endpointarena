import { MARKET_ACTIONS, type MarketActionType } from '@/lib/markets/constants'

export interface ModelDecisionOtherMarketInput {
  drugName: string
  companyName: string
  pdufaDate: string
  yesPrice: number
}

export interface ModelDecisionInput {
  meta: {
    eventId: string
    marketId: string
    modelId: string
    asOf: string
    runDateIso: string
  }
  event: {
    drugName: string
    companyName: string
    symbols: string | null
    applicationType: string
    pdufaDate: string
    daysToDecision: number | null
    eventDescription: string
    drugStatus: string | null
    nctId: string | null
  }
  market: {
    yesPrice: number
    noPrice: number
    otherOpenMarkets: ModelDecisionOtherMarketInput[]
  }
  portfolio: {
    cashAvailable: number
    yesSharesHeld: number
    noSharesHeld: number
    maxBuyUsd: number
    maxSellYesUsd: number
    maxSellNoUsd: number
  }
  constraints: {
    allowedActions: MarketActionType[]
    explanationMaxChars: number
  }
}

export interface ModelDecisionForecast {
  approvalProbability: number
  binaryCall: 'approved' | 'rejected'
  confidence: number
  reasoning: string
}

export interface ModelDecisionAction {
  type: MarketActionType
  amountUsd: number
  explanation: string
}

export interface ModelDecisionResult {
  forecast: ModelDecisionForecast
  action: ModelDecisionAction
}

const DEFAULT_EXPLANATION_MAX_CHARS = 220

function extractBalancedJsonObject(raw: string, startIndex: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIndex; i < raw.length; i += 1) {
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
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
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

  const forecastKeyIndex = normalized.search(/"(?:forecast|approvalProbability|binaryCall|action)"/)
  if (forecastKeyIndex !== -1) {
    const start = normalized.lastIndexOf('{', forecastKeyIndex)
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

function clampProbability(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0.5
  if (parsed > 1 && parsed <= 100) {
    return Math.max(0, Math.min(1, parsed / 100))
  }
  return Math.max(0, Math.min(1, parsed))
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace('%', '').trim())
  if (!Number.isFinite(parsed)) return 50
  return Math.max(50, Math.min(100, Math.round(parsed)))
}

function sanitizeBinaryCall(value: unknown, probability: number): 'approved' | 'rejected' {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'approved' || normalized === 'rejected') {
    return normalized
  }
  return probability >= 0.5 ? 'approved' : 'rejected'
}

function sanitizeActionType(value: unknown, allowedActions: readonly MarketActionType[]): MarketActionType {
  const normalized = String(value || '').trim().toUpperCase()
  if ((allowedActions as readonly string[]).includes(normalized)) {
    return normalized as MarketActionType
  }
  return 'HOLD'
}

function sanitizeAmount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const clipped = text.slice(0, maxChars + 1)
  const boundary = clipped.lastIndexOf(' ')
  const safe = boundary >= Math.floor(maxChars * 0.6) ? clipped.slice(0, boundary) : clipped.slice(0, maxChars)
  return `${safe.replace(/[ ,;:]+$/, '')}...`
}

function sanitizeExplanation(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return 'No explanation provided.'
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'No explanation provided.'
  return truncateAtWordBoundary(normalized, maxChars)
}

function sanitizeReasoning(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid reasoning value: ${JSON.stringify(value)}`)
  }
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length < 20) {
    throw new Error(`Reasoning too short (${normalized.length} chars)`)
  }
  return normalized
}

export function buildModelDecisionPrompt(input: ModelDecisionInput): string {
  const explanationMaxChars = input.constraints.explanationMaxChars || DEFAULT_EXPLANATION_MAX_CHARS
  const renderedInput = JSON.stringify(input, null, 2)

  return `You are an expert pharmaceutical analyst and FDA prediction-market decision maker.

First estimate the intrinsic probability of FDA approval from the event facts alone. Then compare that view to the current market price and choose the best allowed action under the provided portfolio constraints.

Your task has two ordered stages.

Stage 1: Intrinsic forecast
- Use only the event fields.
- Do not use market or portfolio fields when estimating intrinsic approval odds.
- Produce:
  - approvalProbability: a number from 0 to 1
  - binaryCall: approved if approvalProbability >= 0.5, otherwise rejected
  - confidence: integer from 50 to 100
  - reasoning: 120 to 220 words, specific and decision-useful

Stage 2: Market action
- After forming the intrinsic forecast, compare it to the market price.
- Use market and portfolio fields only in this stage.
- Use otherOpenMarkets only for capital allocation context, not to estimate this event's approval probability.
- Choose exactly one action from allowedActions.
- Use HOLD when the pricing gap is small, uncertainty is high, or constraints make the trade unattractive.
- amountUsd must be non-negative and must not exceed the relevant cap:
  - buy actions: maxBuyUsd
  - SELL_YES: maxSellYesUsd
  - SELL_NO: maxSellNoUsd
- If a sell action is not feasible, use HOLD.
- action.explanation must be plain language and at most ${explanationMaxChars} characters.

General rules
- Output valid JSON only.
- No markdown.
- No extra keys.
- Do not restate the input.
- Keep forecast.reasoning focused on regulatory and clinical drivers.
- Keep action.explanation focused on valuation and trade logic.

Input JSON:
${renderedInput}

Return exactly:
{
  "forecast": {
    "approvalProbability": 0.0,
    "binaryCall": "approved",
    "confidence": 50,
    "reasoning": "string"
  },
  "action": {
    "type": "HOLD",
    "amountUsd": 0,
    "explanation": "string"
  }
}`
}

export function parseModelDecisionResponse(raw: string, allowedActions: readonly MarketActionType[], explanationMaxChars = DEFAULT_EXPLANATION_MAX_CHARS): ModelDecisionResult {
  const normalized = extractJsonBlock(raw)
  let parsed: {
    forecast?: Record<string, unknown>
    action?: Record<string, unknown>
  }

  try {
    parsed = JSON.parse(normalized)
  } catch {
    const repaired = normalized
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
    parsed = JSON.parse(repaired)
  }

  const forecastPayload = parsed.forecast ?? {}
  const approvalProbability = clampProbability(forecastPayload.approvalProbability)
  const binaryCall = sanitizeBinaryCall(forecastPayload.binaryCall, approvalProbability)
  const confidence = clampConfidence(forecastPayload.confidence)
  const reasoning = sanitizeReasoning(forecastPayload.reasoning)

  const actionPayload = parsed.action ?? {}
  const actionType = sanitizeActionType(actionPayload.type, allowedActions.length > 0 ? allowedActions : MARKET_ACTIONS)
  const amountUsd = actionType === 'HOLD' ? 0 : sanitizeAmount(actionPayload.amountUsd)
  const explanation = sanitizeExplanation(actionPayload.explanation, explanationMaxChars)

  return {
    forecast: {
      approvalProbability,
      binaryCall,
      confidence,
      reasoning,
    },
    action: {
      type: actionType,
      amountUsd,
      explanation,
    },
  }
}
