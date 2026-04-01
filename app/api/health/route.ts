import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getHealthState() {
  const timestamp = new Date().toISOString()

  try {
    await db.execute(sql`select 1`)

    return {
      body: {
        ok: true,
        service: 'endpoint-arena',
        database: 'ok' as const,
        timestamp,
      },
      status: 200,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error'

    return {
      body: {
        ok: false,
        service: 'endpoint-arena',
        database: 'error' as const,
        error: 'database_unavailable',
        message,
        timestamp,
      },
      status: 503,
    }
  }
}

export async function GET() {
  const { body, status } = await getHealthState()

  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

export async function HEAD() {
  const { status } = await getHealthState()

  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
