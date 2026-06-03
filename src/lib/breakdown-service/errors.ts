export type BreakdownErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'idempotency_conflict'
  | 'external_run_state'
  | 'upstream_not_ready'
  | 'stale_context'
  | 'database_error'
  | 'execution_error';

export class BreakdownServiceError extends Error {
  readonly code: BreakdownErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: BreakdownErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'BreakdownServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function getErrorResponse(err: unknown): {
  code: BreakdownErrorCode;
  message: string;
  status: number;
  details?: unknown;
} {
  if (err instanceof BreakdownServiceError) {
    return {
      code: err.code,
      message: err.message,
      status: err.status,
      details: err.details,
    };
  }

  if (err instanceof Error) {
    return {
      code: err.message === 'Unauthorized' ? 'unauthorized' : 'execution_error',
      message: err.message,
      status: err.message === 'Unauthorized' ? 401 : 500,
    };
  }

  return {
    code: 'execution_error',
    message: 'Unknown error',
    status: 500,
  };
}

export function throwDbError(message: string): never {
  throw new BreakdownServiceError('database_error', message, 400);
}
