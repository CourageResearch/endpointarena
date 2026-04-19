import type { AiBatchState, AiDataset } from '@/lib/admin-ai-shared'
import { isAiDataset } from '@/lib/admin-ai-shared'
import { ValidationError } from '@/lib/errors'

export function getAiDatasetForActiveDatabase(): AiDataset {
  return 'live'
}

function getActiveDatabaseDatasetMessage(): string {
  return 'The AI desk uses Season 4 onchain batches for the active database target.'
}

export function validateRequestedAiDatasetForActiveDatabase(value: string | null | undefined): AiDataset {
  const activeDataset = getAiDatasetForActiveDatabase()

  if (value == null || value.trim().length === 0) {
    return activeDataset
  }

  const requestedDataset = value.trim()
  if (!isAiDataset(requestedDataset)) {
    throw new ValidationError('dataset must be toy or live')
  }

  if (requestedDataset !== activeDataset) {
    throw new ValidationError(getActiveDatabaseDatasetMessage())
  }

  return activeDataset
}

export function assertAiBatchMatchesActiveDatabase(batch: Pick<AiBatchState, 'dataset'>): void {
  if (batch.dataset !== getAiDatasetForActiveDatabase()) {
    throw new ValidationError(getActiveDatabaseDatasetMessage())
  }
}
