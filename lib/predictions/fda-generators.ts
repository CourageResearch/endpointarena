import Anthropic from '@anthropic-ai/sdk'

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

interface PredictionSummary {
  modelId: string
  modelName: string
  prediction: string
  confidence: number
  reasoning: string
}

// Generate meta-analysis comparing all model predictions.
export async function generateMetaAnalysis(
  event: FDAEventInfo,
  predictions: PredictionSummary[]
): Promise<string> {
  if (predictions.length < 2) {
    return ''
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const predictionsText = predictions
    .map((p) => `### ${p.modelName}\n**Prediction:** ${p.prediction.toUpperCase()} (${p.confidence}% confidence)\n**Reasoning:** ${p.reasoning}`)
    .join('\n\n')

  const prompt = `You are analyzing FDA drug approval predictions from multiple AI models. Compare their reasoning approaches and identify key differences.

## Drug Information
- **Drug:** ${event.drugName}
- **Company:** ${event.companyName}
- **Application Type:** ${event.applicationType}
- **Therapeutic Area:** ${event.therapeuticArea || 'Not specified'}

## Model Predictions
${predictionsText}

## Your Task
Write a concise meta-analysis (2-3 paragraphs) that:
1. Identifies the key factors each model emphasized differently
2. Explains why models may have reached different conclusions (if they disagree)
3. Highlights any blind spots or unique insights from specific models
4. Notes the confidence spread and what it suggests about prediction difficulty

Be specific and reference actual reasoning from each model. Focus on analytical differences, not just restating predictions. Keep it under 300 words.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in meta-analysis response')
  }

  return textContent.text
}
