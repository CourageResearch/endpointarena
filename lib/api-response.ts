import { NextResponse } from 'next/server'
import { normalizeError } from '@/lib/errors'
import { ValidationError } from '@/lib/errors'

type ErrorPayload = {
  error: {
    code: string
    message: string
    requestId: string
    details?: Record<string, unknown>
  }
}

export function createRequestId(): string {
  return crypto.randomUUID()
}

export function successResponse<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init)
}

export function errorResponse(
  error: unknown,
  requestId: string,
  fallbackMessage: string = 'Request failed'
): NextResponse<ErrorPayload> {
  const normalized = normalizeError(error)

  const message = normalized.expose
    ? normalized.message
    : fallbackMessage

  const payload: ErrorPayload = {
    error: {
      code: normalized.code,
      message,
      requestId,
      details: normalized.expose ? normalized.details : undefined,
    },
  }

  return NextResponse.json(payload, { status: normalized.status })
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T
  } catch (error) {
    throw new ValidationError('Request body must be valid JSON', {
      cause: error,
    })
  }
}

export async function parseOptionalJsonBody<T>(request: Request, defaultValue: T): Promise<T> {
  try {
    const raw = await request.text()
    if (!raw.trim()) {
      return defaultValue
    }
    return JSON.parse(raw) as T
  } catch (error) {
    throw new ValidationError('Request body must be valid JSON', {
      cause: error,
    })
  }
}
