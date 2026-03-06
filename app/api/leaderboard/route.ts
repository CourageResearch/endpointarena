import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboardData } from '@/lib/leaderboard-data'
import type { LeaderboardPredictionMode } from '@/lib/model-decision-snapshots'

export const dynamic = 'force-dynamic'

function parseMode(value: string | null): LeaderboardPredictionMode {
  return value === 'first' ? 'first' : 'final'
}

export async function GET(request: NextRequest) {
  const mode = parseMode(new URL(request.url).searchParams.get('mode'))
  const { leaderboard } = await getLeaderboardData(mode)

  const entries = leaderboard
    .map((entry) => ({
      predictorId: entry.id,
      predictorType: 'model',
      totalPredictions: entry.decided,
      correctPredictions: entry.correct,
      accuracy: entry.accuracy,
      pendingPredictions: entry.pending,
      mode,
    }))
    .sort((a, b) =>
      b.accuracy - a.accuracy ||
      b.correctPredictions - a.correctPredictions ||
      b.totalPredictions - a.totalPredictions ||
      a.predictorId.localeCompare(b.predictorId)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }))

  return NextResponse.json(entries)
}
