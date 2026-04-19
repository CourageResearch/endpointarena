import type { ModelId } from '@/lib/constants'
import { getModelPositionLabel, MODEL_REGISTRY } from '@/lib/model-registry'

export function getSeason4ModelFullName(modelId: ModelId): string {
  return MODEL_REGISTRY[modelId].fullName
}

export function getSeason4PositionModelLabel(modelId: ModelId): string {
  return getModelPositionLabel(modelId)
}

export function getSeason4ModelName(modelId: ModelId): string {
  return MODEL_REGISTRY[modelId].fullName
}

export function getSeason4ModelInfo(modelId: ModelId) {
  const model = MODEL_REGISTRY[modelId]
  return {
    name: model.name,
    fullName: model.fullName,
    color: model.color,
    provider: model.provider,
    features: [...model.features],
  }
}
