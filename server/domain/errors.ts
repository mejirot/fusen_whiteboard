export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'IO'

export class AppError extends Error {
  public readonly details: Readonly<Record<string, unknown>> | undefined

  public constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly statusCode: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'AppError'
    this.details = details
  }
}

export function validationError(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AppError {
  return new AppError('VALIDATION', message, 400, details)
}

export function notFoundError(message: string): AppError {
  return new AppError('NOT_FOUND', message, 404)
}

export function conflictError(
  message: string,
  currentRevision: number,
): AppError {
  return new AppError('CONFLICT', message, 409, { currentRevision })
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
