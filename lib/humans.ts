import { and, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { db, users } from '@/lib/db'
import { STARTER_POINTS } from '@/lib/constants'

const DAILY_REFILL_POINTS = 5
const DAILY_REFILL_BALANCE_CAP = 12000

function toUtcDayStamp(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function canApplyDailyRefill(lastRefillAt: Date | null, now: Date): boolean {
  if (!lastRefillAt) return true
  return toUtcDayStamp(lastRefillAt) !== toUtcDayStamp(now)
}

export async function applyDailyRefillIfEligible(userId: string): Promise<{
  pointsBalance: number
  lastPointsRefillAt: Date | null
  refillAwarded: number
}> {
  const now = new Date()
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })

  if (!user) {
    return { pointsBalance: STARTER_POINTS, lastPointsRefillAt: null, refillAwarded: 0 }
  }

  const currentPoints = user.pointsBalance ?? STARTER_POINTS
  const lastRefillAt = user.lastPointsRefillAt ?? null
  const eligible = canApplyDailyRefill(lastRefillAt, now)

  if (!eligible || currentPoints >= DAILY_REFILL_BALANCE_CAP) {
    return {
      pointsBalance: currentPoints,
      lastPointsRefillAt: lastRefillAt,
      refillAwarded: 0,
    }
  }

  const refillAmount = Math.min(DAILY_REFILL_POINTS, DAILY_REFILL_BALANCE_CAP - currentPoints)

  const [updated] = await db.update(users)
    .set({
      pointsBalance: currentPoints + refillAmount,
      lastPointsRefillAt: now,
    })
    .where(eq(users.id, userId))
    .returning({
      pointsBalance: users.pointsBalance,
      lastPointsRefillAt: users.lastPointsRefillAt,
    })

  if (!updated) {
    return {
      pointsBalance: currentPoints,
      lastPointsRefillAt: lastRefillAt,
      refillAwarded: 0,
    }
  }

  return {
    ...updated,
    refillAwarded: refillAmount,
  }
}

export async function getVerifiedHumansRank(pointsBalance: number): Promise<number> {
  const [row] = await db.select({
    higherCount: sql<number>`count(*)::int`,
  })
    .from(users)
    .where(and(
      isNotNull(users.tweetVerifiedAt),
      gt(users.pointsBalance, pointsBalance),
    ))

  return (row?.higherCount ?? 0) + 1
}
