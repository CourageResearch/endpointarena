interface FDAEventInfo {
  drugName: string
  companyName: string
  applicationType: string
  therapeuticArea: string | null
  eventDescription: string
  drugStatus: string | null
  rivalDrugs: string | null
  marketPotential: string | null
  otherApprovals: string | null
  source: string | null
}

export function buildFDAPredictionPrompt(event: FDAEventInfo): string {
  const additionalInfo = []
  if (event.drugStatus) additionalInfo.push(`**Review Status:** ${event.drugStatus}`)
  if (event.rivalDrugs) additionalInfo.push(`**Competing Drugs:** ${event.rivalDrugs}`)
  if (event.marketPotential) additionalInfo.push(`**Market Potential:** ${event.marketPotential}`)
  if (event.otherApprovals) additionalInfo.push(`**Other Approvals:** ${event.otherApprovals}`)
  if (event.source) additionalInfo.push(`**Source Material:** ${event.source}`)

  const additionalSection = additionalInfo.length > 0
    ? `\n${additionalInfo.join('\n')}\n`
    : ''

  return `You are an expert pharmaceutical analyst specializing in FDA regulatory decisions. Analyze the following FDA decision and predict the outcome.

## Drug Information

**Drug Name:** ${event.drugName}
**Company:** ${event.companyName}
**Application Type:** ${event.applicationType}
**Therapeutic Area:** ${event.therapeuticArea || 'Not specified'}
**Event Description:** ${event.eventDescription}
${additionalSection}
## Your Task

1. Analyze this FDA decision based on:
   - Historical FDA approval rates for this application type (NDA ~85%, BLA ~90%, sNDA/sBLA ~95%)
   - The therapeutic area and unmet medical need
   - Priority Review vs Standard Review (if known)
   - The company's regulatory track record
   - Competitive landscape and existing treatments
   - Any known safety or efficacy concerns from trials

2. Make a prediction:
   - **Prediction:** Either "approved" or "rejected"
   - **Confidence:** A percentage between 50-100% (50% = uncertain, 100% = highly confident)
   - **Reasoning:** A DETAILED explanation (2-3 paragraphs, 150-300 words) supporting your prediction

## Response Format

Respond in the following JSON format ONLY, with no additional text:

{
  "prediction": "approved" or "rejected",
  "confidence": <number between 50-100>,
  "reasoning": "<your DETAILED reasoning - must be 150-300 words explaining the specific factors that led to your prediction, including therapeutic area context, regulatory history, competitive landscape, and any safety/efficacy considerations>"
}

IMPORTANT:
- Your reasoning MUST be detailed and specific (150-300 words minimum)
- Explain WHY you made this prediction with specific factors
- Reference the therapeutic area, company track record, and competitive landscape
- Do NOT give a generic response like "FDA approval is likely" - be specific!`
}

export interface FDAPredictionResult {
  prediction: 'approved' | 'rejected'
  confidence: number
  reasoning: string
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

export function parseFDAPredictionResponse(response: string): FDAPredictionResult {
  if (!response || response.trim().length === 0) {
    throw new Error('Empty response received from model')
  }

  let lastParseError: unknown

  // Try multiple parsing strategies

  // Strategy 1: Look for JSON in code blocks first (```json ... ```)
  const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return parseJsonResponse(codeBlockMatch[1])
    } catch (e) {
      lastParseError = e
    }
  }

  // Strategy 2: Find the outermost JSON object containing "prediction"
  // This handles braces inside quoted strings in the reasoning field.
  const predictionIndex = response.indexOf('"prediction"')
  if (predictionIndex !== -1) {
    const startIndex = response.lastIndexOf('{', predictionIndex)
    if (startIndex !== -1) {
      const jsonStr = extractBalancedJsonObject(response, startIndex)
      if (jsonStr) {
        try {
          return parseJsonResponse(jsonStr)
        } catch (e) {
          lastParseError = e
        }
      }
    }
  }

  // Strategy 3: Find any complete JSON-like object (matching braces)
  const firstBrace = response.indexOf('{')
  if (firstBrace !== -1) {
    const jsonStr = extractBalancedJsonObject(response, firstBrace)
    if (jsonStr) {
      try {
        return parseJsonResponse(jsonStr)
      } catch (e) {
        lastParseError = e
      }
    }
  }

  const parseHint = lastParseError instanceof Error
    ? ` Last parse error: ${lastParseError.message}`
    : ''

  throw new Error(
    `Model response did not contain a valid JSON prediction payload. Preview: ${response.slice(0, 240)}${parseHint}`
  )
}

function parseJsonResponse(jsonStr: string): FDAPredictionResult {
  const normalizedJson = jsonStr.trim()
  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(normalizedJson)
  } catch {
    // Fall back if models include problematic control chars.
    const repairedJson = normalizedJson
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
    parsed = JSON.parse(repairedJson)
  }

  const predictionValue =
    typeof parsed.prediction === 'string'
      ? parsed.prediction.trim().toLowerCase()
      : String(parsed.prediction || '').toLowerCase()

  if (!['approved', 'rejected'].includes(predictionValue)) {
    throw new Error(`Invalid prediction value: ${JSON.stringify(parsed.prediction)}. Expected 'approved' or 'rejected'.`)
  }

  let rawConfidence = parsed.confidence
  if (typeof rawConfidence === 'string') {
    const normalizedConfidence = rawConfidence.replace('%', '').trim()
    rawConfidence = Number(normalizedConfidence)
  }

  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    throw new Error(`Invalid confidence value: ${JSON.stringify(parsed.confidence)}. Expected a number or numeric string.`)
  }

  const confidence = Math.max(50, Math.min(100, Math.round(rawConfidence)))

  // Validate reasoning - must be a non-empty string
  if (typeof parsed.reasoning !== 'string') {
    throw new Error(`Invalid reasoning value: ${JSON.stringify(parsed.reasoning)}. Expected a string.`)
  }
  if (parsed.reasoning.length < 10) {
    throw new Error(`Reasoning too short (${parsed.reasoning.length} chars). Expected at least 10 characters.`)
  }
  const reasoning = parsed.reasoning

  return {
    prediction: predictionValue as 'approved' | 'rejected',
    confidence,
    reasoning,
  }
}
