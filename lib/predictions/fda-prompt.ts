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
}

export function buildFDAPredictionPrompt(event: FDAEventInfo): string {
  const additionalInfo = []
  if (event.drugStatus) additionalInfo.push(`**Review Status:** ${event.drugStatus}`)
  if (event.rivalDrugs) additionalInfo.push(`**Competing Drugs:** ${event.rivalDrugs}`)
  if (event.marketPotential) additionalInfo.push(`**Market Potential:** ${event.marketPotential}`)
  if (event.otherApprovals) additionalInfo.push(`**Other Approvals:** ${event.otherApprovals}`)

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

export function parseFDAPredictionResponse(response: string): FDAPredictionResult {
  if (!response || response.trim().length === 0) {
    throw new Error('Empty response received from model')
  }

  // Try multiple parsing strategies

  // Strategy 1: Look for JSON in code blocks first (```json ... ```)
  const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return parseJsonResponse(codeBlockMatch[1])
    } catch (e) {
      // Continue to other strategies
    }
  }

  // Strategy 2: Find the outermost JSON object containing "prediction"
  // This handles nested braces in the reasoning field
  const predictionIndex = response.indexOf('"prediction"')
  if (predictionIndex !== -1) {
    // Find the opening brace before "prediction"
    let startIndex = response.lastIndexOf('{', predictionIndex)
    if (startIndex !== -1) {
      // Find matching closing brace by counting braces
      let braceCount = 1
      let endIndex = startIndex + 1
      while (endIndex < response.length && braceCount > 0) {
        if (response[endIndex] === '{') braceCount++
        else if (response[endIndex] === '}') braceCount--
        endIndex++
      }
      if (braceCount === 0) {
        const jsonStr = response.substring(startIndex, endIndex)
        try {
          return parseJsonResponse(jsonStr)
        } catch (e) {
          // Continue to other strategies
        }
      }
    }
  }

  // Strategy 3: Find any complete JSON-like object (matching braces)
  const firstBrace = response.indexOf('{')
  if (firstBrace !== -1) {
    let braceCount = 1
    let endIndex = firstBrace + 1
    while (endIndex < response.length && braceCount > 0) {
      if (response[endIndex] === '{') braceCount++
      else if (response[endIndex] === '}') braceCount--
      endIndex++
    }
    if (braceCount === 0) {
      const jsonStr = response.substring(firstBrace, endIndex)
      try {
        return parseJsonResponse(jsonStr)
      } catch (e) {
        // Continue to fallback
      }
    }
  }

  // Strategy 4: Extract from natural language response
  return parseNaturalLanguageResponse(response)
}

function parseJsonResponse(jsonStr: string): FDAPredictionResult {
  // Clean up the JSON string - remove control characters that break parsing
  // but preserve the structure for proper JSON parsing
  const cleanedJson = jsonStr
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove most control chars but keep \n, \r, \t
    .replace(/\r\n/g, '\\n')           // Convert Windows newlines to escaped
    .replace(/\n/g, '\\n')             // Convert newlines to escaped
    .replace(/\r/g, '\\n')             // Convert carriage returns to escaped
    .replace(/\t/g, ' ')               // Replace tabs with spaces

  let parsed
  try {
    parsed = JSON.parse(cleanedJson)
  } catch (e) {
    // Try more aggressive cleaning if initial parse fails
    const aggressiveCleaned = jsonStr
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
    parsed = JSON.parse(aggressiveCleaned)
  }

  if (!['approved', 'rejected'].includes(parsed.prediction)) {
    throw new Error(`Invalid prediction value: ${JSON.stringify(parsed.prediction)}. Expected 'approved' or 'rejected'.`)
  }

  // Validate confidence - must be a number
  if (typeof parsed.confidence !== 'number') {
    throw new Error(`Invalid confidence value: ${JSON.stringify(parsed.confidence)}. Expected a number.`)
  }
  const confidence = Math.max(50, Math.min(100, Math.round(parsed.confidence)))

  // Validate reasoning - must be a non-empty string
  if (typeof parsed.reasoning !== 'string') {
    throw new Error(`Invalid reasoning value: ${JSON.stringify(parsed.reasoning)}. Expected a string.`)
  }
  if (parsed.reasoning.length < 10) {
    throw new Error(`Reasoning too short (${parsed.reasoning.length} chars). Expected at least 10 characters.`)
  }
  const reasoning = parsed.reasoning

  return {
    prediction: parsed.prediction,
    confidence,
    reasoning,
  }
}

function parseNaturalLanguageResponse(response: string): FDAPredictionResult {
  const lowerResponse = response.toLowerCase()

  // Determine prediction
  let prediction: 'approved' | 'rejected'

  // Look for explicit prediction statements
  if (lowerResponse.includes('predict: approved') ||
      lowerResponse.includes('prediction: approved') ||
      lowerResponse.includes('prediction is approved') ||
      lowerResponse.includes('will be approved') ||
      lowerResponse.includes('likely to be approved') ||
      lowerResponse.includes('expect approval') ||
      lowerResponse.includes('recommend approval')) {
    prediction = 'approved'
  } else if (lowerResponse.includes('predict: rejected') ||
             lowerResponse.includes('prediction: rejected') ||
             lowerResponse.includes('prediction is rejected') ||
             lowerResponse.includes('will be rejected') ||
             lowerResponse.includes('likely to be rejected') ||
             lowerResponse.includes('expect rejection') ||
             lowerResponse.includes('will not be approved')) {
    prediction = 'rejected'
  } else {
    // Count positive vs negative indicators
    const approvalWords = ['approved', 'approval', 'approve', 'favorable', 'positive', 'success', 'grant']
    const rejectionWords = ['rejected', 'rejection', 'reject', 'unfavorable', 'negative', 'denied', 'refuse']

    let approvalScore = 0
    let rejectionScore = 0

    for (const word of approvalWords) {
      approvalScore += (lowerResponse.match(new RegExp(word, 'g')) || []).length
    }
    for (const word of rejectionWords) {
      rejectionScore += (lowerResponse.match(new RegExp(word, 'g')) || []).length
    }

    prediction = approvalScore >= rejectionScore ? 'approved' : 'rejected'
  }

  // Extract confidence
  let confidence = 75 // Default
  const confidenceMatch = response.match(/(\d{2,3})\s*%\s*(?:confidence|confident|certainty|probability|likely)/i) ||
                          response.match(/(?:confidence|confident|certainty|probability)[:\s]+(\d{2,3})\s*%/i) ||
                          response.match(/(\d{2,3})\s*%/i)
  if (confidenceMatch) {
    const parsed = parseInt(confidenceMatch[1])
    if (parsed >= 50 && parsed <= 100) {
      confidence = parsed
    }
  }

  // Extract reasoning - take a meaningful chunk of the response
  // First try to keep the full response, just clean it up
  let reasoning = response
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/\n+/g, ' ')           // Normalize newlines
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim()

  // If that removed too much, use the original response
  if (reasoning.length < 50) {
    reasoning = response
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Limit reasoning length
  if (reasoning.length > 1500) {
    reasoning = reasoning.substring(0, 1500) + '...'
  }

  // If reasoning is STILL too short, throw an error with more context
  if (reasoning.length < 20) {
    throw new Error(`Failed to extract meaningful reasoning from model response. Response length: ${response.length}, extracted reasoning length: ${reasoning.length}. Response preview: ${response.substring(0, 200)}`)
  }

  return { prediction, confidence, reasoning }
}
