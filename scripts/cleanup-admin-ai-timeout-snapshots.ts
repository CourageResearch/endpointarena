import 'dotenv/config'
import postgres from 'postgres'

type BatchTask = {
  taskKey: string
  marketId: string
  trialQuestionId: string | null
  modelId: string
  status: string
  snapshotId: string | null
  errorMessage: string | null
}

type BatchState = {
  id: string
  runStartedAt: string | null
  createdAt: string
  tasks: BatchTask[]
}

type SnapshotRow = {
  id: string
  market_id: string
  trial_question_id: string | null
  actor_id: string
  created_at: string
  duration_ms: number | null
  linked_market_action_id: string | null
}

function getFlag(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)

  const index = process.argv.findIndex((arg) => arg === name)
  if (index !== -1) {
    return process.argv[index + 1] ?? null
  }

  return null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name) || process.argv.some((arg) => arg.startsWith(`${name}=`))
}

async function main() {
  const batchId = getFlag('--batch-id')
  if (!batchId) {
    throw new Error('Pass --batch-id <id>.')
  }

  const actorId = getFlag('--actor-id') ?? 'deepseek-v3.2'
  const apply = hasFlag('--apply')
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.')
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 })

  try {
    const batchRows = await sql<{ state: BatchState }[]>`
      select state
      from ai_batches
      where id = ${batchId}
      limit 1
    `
    const batch = batchRows[0]?.state

    if (!batch) {
      throw new Error(`Batch ${batchId} was not found.`)
    }

    const batchStartIso = batch.runStartedAt ?? batch.createdAt
    const batchStart = new Date(batchStartIso)
    const actorTasks = batch.tasks.filter((task) => task.modelId === actorId)

    if (actorTasks.length === 0) {
      console.log(JSON.stringify({
        batchId,
        actorId,
        batchStartIso,
        apply,
        deletedSnapshotIds: [],
        reason: 'No tasks matched this actor in the batch.',
      }, null, 2))
      return
    }

    const keepSnapshotIds = new Set(
      actorTasks
        .map((task) => task.snapshotId)
        .filter((snapshotId): snapshotId is string => Boolean(snapshotId)),
    )

    const taskByMarketQuestionKey = new Map(
      actorTasks.map((task) => [`${task.marketId}:${task.trialQuestionId ?? ''}`, task] as const),
    )

    const snapshots = await sql<SnapshotRow[]>`
      select id, market_id, trial_question_id, actor_id, created_at, duration_ms, linked_market_action_id
      from model_decision_snapshots
      where actor_id = ${actorId}
        and created_at >= ${batchStart}
        and market_id in ${sql(actorTasks.map((task) => task.marketId))}
    `

    const orphaned = snapshots.filter((snapshot) => {
      const task = taskByMarketQuestionKey.get(`${snapshot.market_id}:${snapshot.trial_question_id ?? ''}`)
      if (!task) return false
      if (keepSnapshotIds.has(snapshot.id)) return false
      if (snapshot.linked_market_action_id) return false

      const taskTimedOut = typeof task.errorMessage === 'string' && task.errorMessage.includes('timed out')
      const snapshotRanLong = typeof snapshot.duration_ms === 'number' && snapshot.duration_ms >= 90_000

      return taskTimedOut || snapshotRanLong
    })

    if (apply && orphaned.length > 0) {
      await sql`
        delete from model_decision_snapshots
        where id in ${sql(orphaned.map((snapshot) => snapshot.id))}
      `
    }

    console.log(JSON.stringify({
      batchId,
      actorId,
      batchStartIso,
      apply,
      matchedTaskCount: actorTasks.length,
      keptSnapshotIds: Array.from(keepSnapshotIds),
      orphanedSnapshotCount: orphaned.length,
      deletedSnapshotIds: apply ? orphaned.map((snapshot) => snapshot.id) : [],
      orphanedSnapshots: orphaned.map((snapshot) => ({
        id: snapshot.id,
        marketId: snapshot.market_id,
        trialQuestionId: snapshot.trial_question_id,
        createdAt: snapshot.created_at,
        durationMs: snapshot.duration_ms,
      })),
    }, null, 2))
  } finally {
    await sql.end()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
