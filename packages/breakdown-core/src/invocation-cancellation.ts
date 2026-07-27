import type { OperationFailure, OperationResult } from './index.js';

export class InvocationCancelledError extends Error {}

export function cancelledFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'cancelled',
      code: 'cancelled',
      message: 'The operation was cancelled.',
      diagnostics: [],
    },
  };
}

export function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function preferCancellation<T>(
  signal: AbortSignal | undefined,
  result: OperationResult<T>,
): OperationResult<T> {
  return isCancelled(signal) ? cancelledFailure() : result;
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (isCancelled(signal)) throw new InvocationCancelledError('The operation was cancelled.');
}
