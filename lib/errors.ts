export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CONFIGURATION_ERROR'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'INTERNAL_ERROR'

type AppErrorOptions = {
  cause?: unknown
  details?: Record<string, unknown>
  expose?: boolean
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>
  readonly expose: boolean

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: AppErrorOptions = {}
  ) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = options.details
    this.expose = options.expose ?? status < 500
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('VALIDATION_ERROR', 400, message, options)
    this.name = 'ValidationError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required', options: AppErrorOptions = {}) {
    super('UNAUTHORIZED', 401, message, options)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', options: AppErrorOptions = {}) {
    super('FORBIDDEN', 403, message, options)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('NOT_FOUND', 404, message, options)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('CONFLICT', 409, message, options)
    this.name = 'ConflictError'
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('CONFIGURATION_ERROR', 500, message, {
      ...options,
      expose: options.expose ?? true,
    })
    this.name = 'ConfigurationError'
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('EXTERNAL_SERVICE_ERROR', 502, message, options)
    this.name = 'ExternalServiceError'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', 500, error.message || 'Internal server error')
  }

  return new AppError('INTERNAL_ERROR', 500, 'Internal server error')
}

