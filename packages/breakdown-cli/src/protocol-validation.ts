import {
  FIXED_LIMITS,
  type CandidateOutcome,
  type LockRecoveryIntent,
  type WorkPacket,
} from '@breakdown-sh/core';

import type { ProtocolValidationError } from './protocol-validator.js';

const OPERATIONS = [
  'validate_workflow',
  'create_run',
  'inspect_run',
  'prepare_work',
  'read_work_input',
  'submit_candidate',
] as const;

interface BaseOperationRequest {
  schema_version: 'breakdown.operation-request.v1';
}

export type OperationRequest =
  | (BaseOperationRequest & { operation: 'validate_workflow' })
  | (BaseOperationRequest & {
      operation: 'create_run';
      inputs?: Record<string, string>;
    })
  | (BaseOperationRequest & {
      operation: 'inspect_run';
      run_id: string;
    })
  | (BaseOperationRequest & {
      operation: 'prepare_work';
      run_id: string;
      mode: { kind: 'resume' } | { kind: 'refresh'; node_id: string };
      limit?: number;
    })
  | (BaseOperationRequest & {
      operation: 'read_work_input';
      packet: WorkPacket;
      binding: string;
    })
  | (BaseOperationRequest & {
      operation: 'submit_candidate';
      packet: WorkPacket;
      candidate: CandidateOutcome;
      lock_recovery?: LockRecoveryIntent;
    });

export interface RequestDiagnostic {
  code: string;
  path: string;
  message: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOperation(value: unknown): value is OperationRequest['operation'] {
  return typeof value === 'string' && OPERATIONS.some((operation) => operation === value);
}

function escapePointerSegment(value: string) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function diagnosticPath(error: ProtocolValidationError) {
  if (error.keyword === 'additionalProperties') {
    const property = error.params.additionalProperty;
    return typeof property === 'string'
      ? `${error.instancePath}/${escapePointerSegment(property)}`
      : error.instancePath;
  }
  if (error.keyword === 'required') {
    const property = error.params.missingProperty;
    return typeof property === 'string'
      ? `${error.instancePath}/${escapePointerSegment(property)}`
      : error.instancePath;
  }
  return error.instancePath;
}

function diagnosticMessage(error: ProtocolValidationError) {
  if (error.keyword === 'additionalProperties') {
    const property = error.params.additionalProperty;
    if (typeof property === 'string') {
      return `Unknown operation request field: ${property}.`;
    }
  }
  if (error.keyword === 'required') {
    const property = error.params.missingProperty;
    if (typeof property === 'string') return `${property} is required.`;
  }
  return error.message ?? 'The value does not match the public schema.';
}

export function operationRequestDiagnostics(
  errors: ProtocolValidationError[] | null | undefined,
): RequestDiagnostic[] {
  return (errors ?? [])
    .map((error) => ({
      code: 'schema',
      path: diagnosticPath(error),
      message: diagnosticMessage(error),
    }))
    .sort((left, right) =>
      left.path < right.path
        ? -1
        : left.path > right.path
          ? 1
          : left.code < right.code
            ? -1
            : left.code > right.code
              ? 1
              : 0,
    )
    .slice(0, FIXED_LIMITS.diagnostics_returned);
}
