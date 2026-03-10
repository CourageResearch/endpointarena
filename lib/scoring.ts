import { db, fdaCalendarEvents } from './db'
import { getUnifiedPredictionHistoriesByEventIds, selectPredictionFromHistory } from './model-decision-snapshots'

export async function scoreFdaPredictions(_fdaEventId: string, _outcome: 'Approved' | 'Rejected') {
  // Snapshot correctness is computed on read from the FDA outcome and is no longer
  // denormalized back into a legacy prediction table.
}

export async function calculateLeaderboard() {
  const events = await db.query.fdaCalendarEvents.findMany()
  const eventOutcomeById = new Map(events.map((event) => [event.id, event.outcome]))
  const historyByEventId = await getUnifiedPredictionHistoriesByEventIds(
    events.map((event) => event.id),
    eventOutcomeById,
  )

  const stats = new Map<string, { correct: number; total: number; type: 'model' }>()
  for (const event of events) {
    const eventHistory = historyByEventId.get(event.id)
    if (!eventHistory) continue

    for (const [predictorId, history] of eventHistory.entries()) {
      const selected = selectPredictionFromHistory(history, 'final')
      if (!selected || selected.correct == null) continue

      const current = stats.get(predictorId) ?? { correct: 0, total: 0, type: 'model' as const }
      current.total += 1
      if (selected.correct) current.correct += 1
      stats.set(predictorId, current)
    }
  }

  return Array.from(stats.entries())
    .map(([id, data]) => ({
      predictorId: id,
      predictorType: data.type,
      totalPredictions: data.total,
      correctPredictions: data.correct,
      accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}
