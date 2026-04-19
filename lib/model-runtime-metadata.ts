import type { ModelId } from '@/lib/constants'
import { MODEL_REGISTRY, type ModelMethodBinding, type ModelRuntimeMetadata } from '@/lib/model-registry'

const MODEL_RUNTIME_METADATA: Record<ModelId, ModelRuntimeMetadata> = Object.fromEntries(
  Object.entries(MODEL_REGISTRY).map(([modelId, model]) => [modelId, model.runtime]),
) as Record<ModelId, ModelRuntimeMetadata>

export const MODEL_METHOD_BINDINGS = Object.fromEntries(
  Object.entries(MODEL_RUNTIME_METADATA).map(([modelId, metadata]) => [modelId, metadata.method]),
) as Record<ModelId, ModelMethodBinding>

export const MODEL_PROVIDER_MODEL_IDS = Object.fromEntries(
  Object.entries(MODEL_RUNTIME_METADATA).map(([modelId, metadata]) => [modelId, metadata.providerModelId]),
) as Record<ModelId, string>
