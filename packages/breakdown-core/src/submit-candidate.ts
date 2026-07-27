import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalizeJson } from './canonical-json.js';
import { FIXED_LIMITS } from './fixed-limits.js';
import {
  cancelledFailure,
  InvocationCancelledError,
  isCancelled,
  throwIfCancelled,
} from './invocation-cancellation.js';
import type {
  Diagnostic,
  InspectRunValue,
  OperationFailure,
  OperationResult,
  WorkflowDefinition,
} from './index.js';
import type { SubmissionIdentity, WorkPacket } from './prepare-work.js';
import { validateDataContractInstance } from './run-inspection.js';
import {
  acquireRunWriterLock,
  type LockRecoveryBoundary,
  LockRecoveryMismatchError,
  type LockRecoveryIntent,
  recoverRunWriterLock,
  releaseRunWriterLock,
  RunLockedError,
  type RunWriterLock,
} from './run-writer-lock.js';
import { publishPrivateFileNoReplace, syncDirectory, writePrivateFile } from './secure-store.js';
import { isUnicodeScalarString } from './unicode.js';

const RUN_ID_PATTERN = /^\d{8}T\d{6}\.\d{3}Z--[a-z][a-z0-9]*(?:-[a-z0-9]+)*--[a-z2-7]{12}$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type CandidateSubmission = SubmissionIdentity;

export interface CandidateExecutor {
  kind: 'agent' | 'human' | 'program';
  name: string;
  version?: string;
  model?: string;
}

export interface CandidateProblem {
  code: string;
  message: string;
}

export interface SuccessfulCandidateOutcome {
  schema_version: 'breakdown.candidate.v1';
  submission: SubmissionIdentity;
  status: 'succeeded';
  executor: CandidateExecutor;
  markdown: string;
  json?: unknown;
}

export interface NonSuccessfulCandidateOutcome {
  schema_version: 'breakdown.candidate.v1';
  submission: SubmissionIdentity;
  status: 'failed' | 'blocked' | 'cancelled';
  executor: CandidateExecutor;
  markdown: string;
  problem: CandidateProblem;
}

export type CandidateOutcome = SuccessfulCandidateOutcome | NonSuccessfulCandidateOutcome;

export interface SuccessfulSubmitCandidateRequest {
  operation: 'submit_candidate';
  packet: WorkPacket;
  candidate: SuccessfulCandidateOutcome;
  lock_recovery?: LockRecoveryIntent;
}

export interface NonSuccessfulSubmitCandidateRequest {
  operation: 'submit_candidate';
  packet: WorkPacket;
  candidate: NonSuccessfulCandidateOutcome;
  lock_recovery?: LockRecoveryIntent;
}

export type SubmitCandidateRequest =
  | SuccessfulSubmitCandidateRequest
  | NonSuccessfulSubmitCandidateRequest;

interface SubmittedCandidateValue {
  run_id: string;
  node_id: string;
  attempt: number;
  started_at: string;
  settled_at: string;
  context_sha256: string;
}

export interface SuccessfulSubmitCandidateValue extends SubmittedCandidateValue {
  status: 'succeeded';
  result: {
    markdown: {
      path: string;
      sha256: string;
    };
    json: {
      path: string;
      sha256: string;
    } | null;
  };
}

export interface NonSuccessfulSubmitCandidateValue extends SubmittedCandidateValue {
  status: 'failed' | 'blocked' | 'cancelled';
  problem: CandidateProblem;
  result: null;
}

export type SubmitCandidateValue =
  | SuccessfulSubmitCandidateValue
  | NonSuccessfulSubmitCandidateValue;

export type StepPublicationBoundary =
  | 'after_lock_acquired'
  | 'after_staging_written'
  | 'before_commit'
  | 'after_commit_visible'
  | 'after_commit';

interface SubmitCandidateDependencies {
  inspect(runId: string): Promise<OperationResult<InspectRunValue>>;
  loadWorkflow(inspected: InspectRunValue): Promise<OperationResult<WorkflowDefinition>>;
  now(): Date;
  randomBytes(size: number): Uint8Array;
  onPublicationBoundary?: (boundary: StepPublicationBoundary) => void | Promise<void>;
  onLockRecoveryBoundary?: (boundary: LockRecoveryBoundary) => void | Promise<void>;
  signal?: AbortSignal;
}

interface ValidatedCandidate {
  submission: SubmissionIdentity;
  status: 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  executor: CandidateExecutor;
  markdown: string;
  problem?: CandidateProblem;
  json?: {
    value: unknown;
    bytes: Buffer;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diagnostic(path: string, message: string): Diagnostic {
  return { code: 'schema', path, message, file: 'candidate' };
}

function invalidCandidateFailure(diagnostics: Diagnostic[]): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'invalid',
      code: 'invalid_candidate',
      message: 'The Candidate Outcome is invalid.',
      diagnostics,
    },
  };
}

function unsupportedCandidateFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'unsupported',
      code: 'unsupported_version',
      message: 'The Candidate Outcome uses an unsupported version.',
      diagnostics: [
        {
          code: 'unsupported_version',
          path: '/schema_version',
          message: 'schema_version must be breakdown.candidate.v1.',
          file: 'candidate',
        },
      ],
    },
  };
}

function lockRecoveryMismatchFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'conflict',
      code: 'lock_recovery_mismatch',
      message: 'The observed Run lock changed or is missing.',
      diagnostics: [],
    },
  };
}

function resourceLimitFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'resource_limit',
      code: 'limit_exceeded',
      message: 'A fixed resource limit was exceeded.',
      diagnostics: [],
    },
  };
}

function ioFailure(message = 'Could not publish the StepArtifact.'): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'io',
      code: 'io_error',
      message,
      diagnostics: [],
    },
  };
}

function internalFailure(message: string): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'internal',
      code: 'internal_error',
      message,
      diagnostics: [],
    },
  };
}

function conflictFailure(code: string, message: string): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'conflict',
      code,
      message,
      diagnostics: [],
    },
  };
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  diagnostics: Diagnostic[],
  requiredFields: readonly string[] = fields,
) {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      diagnostics.push(
        diagnostic(`${path}/${field}`, `Unknown Candidate Outcome field: ${field}.`),
      );
    }
  }
  for (const field of requiredFields) {
    if (!Object.hasOwn(value, field)) {
      diagnostics.push(diagnostic(`${path}/${field}`, `${field} is required.`));
    }
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validateResultFileDescriptor(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic(path, 'Result file descriptor must be a mapping.'));
    return;
  }
  exactFields(value, ['path', 'sha256'], path, diagnostics);
  if (
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    !isUnicodeScalarString(value.path)
  ) {
    diagnostics.push(diagnostic(`${path}/path`, 'Result path is invalid.'));
  }
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    diagnostics.push(diagnostic(`${path}/sha256`, 'Result sha256 is invalid.'));
  }
}

function validateRefreshBase(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic(path, 'refresh_base must be a Selected Result mapping.'));
    return;
  }
  exactFields(value, ['node_id', 'attempt', 'markdown', 'json'], path, diagnostics, [
    'node_id',
    'attempt',
    'markdown',
  ]);
  if (
    typeof value.node_id !== 'string' ||
    value.node_id.length > 64 ||
    !IDENTIFIER_PATTERN.test(value.node_id)
  ) {
    diagnostics.push(diagnostic(`${path}/node_id`, 'refresh_base node_id is invalid.'));
  }
  if (
    typeof value.attempt !== 'number' ||
    !Number.isInteger(value.attempt) ||
    value.attempt < 1 ||
    value.attempt > FIXED_LIMITS.attempts_per_node
  ) {
    diagnostics.push(diagnostic(`${path}/attempt`, 'refresh_base attempt is invalid.'));
  }
  validateResultFileDescriptor(value.markdown, `${path}/markdown`, diagnostics);
  if (Object.hasOwn(value, 'json')) {
    validateResultFileDescriptor(value.json, `${path}/json`, diagnostics);
  }
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

function escapePointerSegment(segment: string) {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function validateStrictJsonValue(
  value: unknown,
  path: string,
  depth: number,
  activeObjects: Set<object>,
  diagnostics: Diagnostic[],
): boolean {
  if (depth > FIXED_LIMITS.yaml_json_nesting_depth) return false;
  if (diagnostics.length >= FIXED_LIMITS.diagnostics_returned) return true;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    if (!isUnicodeScalarString(value)) {
      diagnostics.push(diagnostic(path, 'JSON strings must contain valid Unicode.'));
    }
    return true;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      diagnostics.push(diagnostic(path, 'JSON numbers must be finite IEEE-754 values.'));
    }
    return true;
  }
  if (typeof value !== 'object') {
    diagnostics.push(diagnostic(path, 'json must contain only strict JSON values.'));
    return true;
  }

  if (activeObjects.has(value)) {
    diagnostics.push(diagnostic(path, 'json must not contain circular references.'));
    return true;
  }
  activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some((key) => {
          if (key === 'length') return false;
          if (typeof key !== 'string') return true;
          const index = Number(key);
          return (
            !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key
          );
        })
      ) {
        diagnostics.push(diagnostic(path, 'JSON arrays must not have named properties.'));
      }
      for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${path}/${index}`;
        if (!Object.hasOwn(value, index)) {
          diagnostics.push(diagnostic(itemPath, 'JSON arrays must not be sparse.'));
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value')
        ) {
          diagnostics.push(diagnostic(itemPath, 'JSON array items must be data values.'));
          continue;
        }
        if (
          !validateStrictJsonValue(
            descriptor.value,
            itemPath,
            depth + 1,
            activeObjects,
            diagnostics,
          )
        ) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      diagnostics.push(diagnostic(path, 'json objects must be ordinary JSON mappings.'));
      return true;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        diagnostics.push(diagnostic(path, 'JSON object property names must be strings.'));
        continue;
      }
      const propertyPath = `${path}/${escapePointerSegment(key)}`;
      if (!isUnicodeScalarString(key)) {
        diagnostics.push(
          diagnostic(propertyPath, 'JSON object property names must contain valid Unicode.'),
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        diagnostics.push(diagnostic(propertyPath, 'JSON object properties must be data values.'));
        continue;
      }
      if (
        !validateStrictJsonValue(
          descriptor.value,
          propertyPath,
          depth + 1,
          activeObjects,
          diagnostics,
        )
      ) {
        return false;
      }
    }
    return true;
  } finally {
    activeObjects.delete(value);
  }
}

function validateCandidate(value: unknown): OperationResult<ValidatedCandidate> {
  if (!isRecord(value)) {
    return invalidCandidateFailure([diagnostic('/candidate', 'A Candidate Outcome is required.')]);
  }
  if (
    typeof value.schema_version === 'string' &&
    value.schema_version !== 'breakdown.candidate.v1'
  ) {
    return unsupportedCandidateFailure();
  }
  const diagnostics: Diagnostic[] = [];
  exactFields(
    value,
    ['schema_version', 'submission', 'status', 'executor', 'markdown', 'json', 'problem'],
    '',
    diagnostics,
    ['schema_version', 'submission', 'status', 'executor', 'markdown'],
  );
  if (value.schema_version !== 'breakdown.candidate.v1') {
    diagnostics.push(
      diagnostic('/schema_version', 'schema_version must be breakdown.candidate.v1.'),
    );
  }
  const statuses = new Set<unknown>(['succeeded', 'failed', 'blocked', 'cancelled']);
  if (!statuses.has(value.status)) {
    diagnostics.push(diagnostic('/status', 'status must be a settled Candidate Outcome status.'));
  }
  if (value.status === 'succeeded') {
    if (Object.hasOwn(value, 'problem')) {
      diagnostics.push(
        diagnostic('/problem', 'A succeeded Candidate Outcome must not have a problem.'),
      );
    }
  } else if (statuses.has(value.status)) {
    if (Object.hasOwn(value, 'json')) {
      diagnostics.push(
        diagnostic('/json', 'A non-success Candidate Outcome must not include JSON.'),
      );
    }
    if (!isRecord(value.problem)) {
      diagnostics.push(
        diagnostic('/problem', 'A non-success Candidate Outcome requires a problem.'),
      );
    } else {
      exactFields(value.problem, ['code', 'message'], '/problem', diagnostics);
      if (
        typeof value.problem.code !== 'string' ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(value.problem.code)
      ) {
        diagnostics.push(diagnostic('/problem/code', 'problem code is invalid.'));
      }
      if (
        typeof value.problem.message !== 'string' ||
        value.problem.message.length === 0 ||
        !isUnicodeScalarString(value.problem.message)
      ) {
        diagnostics.push(
          diagnostic('/problem/message', 'problem message must be a nonempty Unicode string.'),
        );
      }
    }
  }

  const submission = value.submission;
  if (!isRecord(submission)) {
    diagnostics.push(diagnostic('/submission', 'submission must be a mapping.'));
  } else {
    exactFields(
      submission,
      [
        'run_id',
        'node_id',
        'intent',
        'prepared_at',
        'expected_attempt',
        'context_sha256',
        'refresh_base',
      ],
      '/submission',
      diagnostics,
      ['run_id', 'node_id', 'intent', 'prepared_at', 'expected_attempt', 'context_sha256'],
    );
    if (typeof submission.run_id !== 'string' || !RUN_ID_PATTERN.test(submission.run_id)) {
      diagnostics.push(diagnostic('/submission/run_id', 'run_id is invalid.'));
    }
    if (
      typeof submission.node_id !== 'string' ||
      submission.node_id.length > 64 ||
      !IDENTIFIER_PATTERN.test(submission.node_id)
    ) {
      diagnostics.push(diagnostic('/submission/node_id', 'node_id is invalid.'));
    }
    if (submission.intent !== 'resume' && submission.intent !== 'refresh') {
      diagnostics.push(diagnostic('/submission/intent', 'intent is invalid.'));
    }
    if (!validTimestamp(submission.prepared_at)) {
      diagnostics.push(diagnostic('/submission/prepared_at', 'prepared_at is invalid.'));
    }
    if (
      typeof submission.expected_attempt !== 'number' ||
      !Number.isInteger(submission.expected_attempt) ||
      submission.expected_attempt < 1 ||
      submission.expected_attempt > FIXED_LIMITS.attempts_per_node
    ) {
      diagnostics.push(diagnostic('/submission/expected_attempt', 'expected_attempt is invalid.'));
    }
    if (
      typeof submission.context_sha256 !== 'string' ||
      !SHA256_PATTERN.test(submission.context_sha256)
    ) {
      diagnostics.push(diagnostic('/submission/context_sha256', 'context_sha256 is invalid.'));
    }
    if (submission.intent === 'refresh') {
      if (!Object.hasOwn(submission, 'refresh_base')) {
        diagnostics.push(
          diagnostic('/submission/refresh_base', 'Refresh submission requires refresh_base.'),
        );
      } else {
        validateRefreshBase(submission.refresh_base, '/submission/refresh_base', diagnostics);
      }
    } else if (submission.intent === 'resume' && Object.hasOwn(submission, 'refresh_base')) {
      diagnostics.push(
        diagnostic('/submission/refresh_base', 'Resume submission must not have refresh_base.'),
      );
    }
  }

  const executor = value.executor;
  if (!isRecord(executor)) {
    diagnostics.push(diagnostic('/executor', 'executor must be a mapping.'));
  } else {
    const requiredExecutorFields = ['kind', 'name'];
    const allowedExecutorFields = new Set([...requiredExecutorFields, 'version', 'model']);
    for (const field of Object.keys(executor)) {
      if (!allowedExecutorFields.has(field)) {
        diagnostics.push(diagnostic(`/executor/${field}`, `Unknown executor field: ${field}.`));
      }
    }
    for (const field of requiredExecutorFields) {
      if (!Object.hasOwn(executor, field)) {
        diagnostics.push(diagnostic(`/executor/${field}`, `${field} is required.`));
      }
    }
    if (!['agent', 'human', 'program'].includes(String(executor.kind))) {
      diagnostics.push(diagnostic('/executor/kind', 'executor kind is invalid.'));
    }
    for (const field of ['name', 'version', 'model'] as const) {
      const fieldValue = executor[field];
      if (
        (field === 'name' || fieldValue !== undefined) &&
        (typeof fieldValue !== 'string' ||
          fieldValue.length === 0 ||
          !isUnicodeScalarString(fieldValue))
      ) {
        diagnostics.push(
          diagnostic(`/executor/${field}`, `${field} must be a nonempty Unicode string.`),
        );
      }
    }
  }

  if (typeof value.markdown !== 'string') {
    diagnostics.push(diagnostic('/markdown', 'markdown must be a string.'));
  } else if (!isUnicodeScalarString(value.markdown)) {
    diagnostics.push(diagnostic('/markdown', 'markdown must contain valid Unicode.'));
  } else if (value.markdown.startsWith('\uFEFF')) {
    diagnostics.push(diagnostic('/markdown', 'markdown must not begin with a BOM.'));
  } else if (value.markdown.includes('\r')) {
    diagnostics.push(diagnostic('/markdown', 'markdown must use LF line endings.'));
  }

  let jsonBytes: Buffer | undefined;
  if (value.status === 'succeeded' && Object.hasOwn(value, 'json')) {
    const withinDepthLimit = validateStrictJsonValue(
      value.json,
      '/json',
      0,
      new Set(),
      diagnostics,
    );
    if (!withinDepthLimit) return resourceLimitFailure();
    if (diagnostics.length === 0) {
      try {
        jsonBytes = Buffer.from(canonicalizeJson(value.json), 'utf8');
      } catch {
        diagnostics.push(diagnostic('/json', 'json must contain one strict JSON value.'));
      }
    }
  }

  if (diagnostics.length > 0) return invalidCandidateFailure(diagnostics);
  if (Buffer.byteLength(value.markdown as string, 'utf8') > FIXED_LIMITS.candidate_markdown_bytes) {
    return resourceLimitFailure();
  }
  if (jsonBytes !== undefined && jsonBytes.byteLength > FIXED_LIMITS.candidate_json_bytes) {
    return resourceLimitFailure();
  }
  return {
    ok: true,
    value: {
      submission: submission as unknown as SubmissionIdentity,
      status: value.status as ValidatedCandidate['status'],
      executor: executor as unknown as CandidateExecutor,
      markdown: value.markdown as string,
      ...(value.status === 'succeeded'
        ? {}
        : { problem: value.problem as unknown as CandidateProblem }),
      ...(jsonBytes === undefined ? {} : { json: { value: value.json, bytes: jsonBytes } }),
    },
  };
}

function validatePacketIdentity(
  value: unknown,
  submission: SubmissionIdentity,
): OperationFailure | undefined {
  if (!isRecord(value) || !isRecord(value.submission) || !isRecord(value.node)) {
    return invalidCandidateFailure([
      diagnostic('/packet', 'The originating Work Packet is required.'),
    ]);
  }
  const identityFields = [
    'run_id',
    'node_id',
    'intent',
    'prepared_at',
    'expected_attempt',
    'context_sha256',
    ...(submission.intent === 'refresh' ? (['refresh_base'] as const) : []),
  ] as const;
  const packetSubmission = value.submission;
  const exactSubmissionFields =
    Object.keys(packetSubmission).length === identityFields.length &&
    identityFields.every(
      (field) =>
        Object.hasOwn(packetSubmission, field) &&
        canonicalValuesEqual(packetSubmission[field], submission[field]),
    );
  const refreshBaseIsConsistent =
    submission.intent === 'refresh'
      ? Object.hasOwn(value, 'refresh_base') &&
        canonicalValuesEqual(value.refresh_base, submission.refresh_base)
      : !Object.hasOwn(value, 'refresh_base');
  const consistentPacket =
    value.schema_version === 'breakdown.work-packet.v1' &&
    value.run_id === submission.run_id &&
    value.intent === submission.intent &&
    value.prepared_at === submission.prepared_at &&
    value.expected_attempt === submission.expected_attempt &&
    value.context_sha256 === submission.context_sha256 &&
    value.node.id === submission.node_id &&
    refreshBaseIsConsistent;
  if (exactSubmissionFields && consistentPacket) return undefined;
  return invalidCandidateFailure([
    diagnostic(
      '/submission',
      'The Candidate Outcome must echo the originating Work Packet submission identity.',
    ),
  ]);
}

function stepInputs(inspected: InspectRunValue, workflow: WorkflowDefinition, nodeId: string) {
  const nodeDefinition = workflow.nodes.find((node) => node.id === nodeId);
  if (nodeDefinition === undefined) return undefined;
  const inputs: Record<string, unknown> = {};
  for (const [bindingId, binding] of Object.entries(nodeDefinition.inputs ?? {}).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    if ('workflow_input' in binding) {
      inputs[bindingId] = { workflow_input: binding.workflow_input };
      continue;
    }
    const result = inspected.nodes.find(
      (inspectedNode) => inspectedNode.node_id === binding.node,
    )?.selected_result;
    if (result === undefined) return undefined;
    inputs[bindingId] = {
      result: {
        node_id: result.node_id,
        attempt: result.attempt,
        markdown: result.markdown,
        ...(result.json === undefined ? {} : { json: result.json }),
      },
    };
  }
  return inputs;
}

function earliestExecutionStart(
  inspected: InspectRunValue,
  workflow: WorkflowDefinition,
  nodeId: string,
) {
  const compactRunTimestamp = inspected.run_id.split('--', 1)[0];
  const match =
    compactRunTimestamp === undefined
      ? null
      : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}\.\d{3}Z)$/.exec(compactRunTimestamp);
  if (match === null) return undefined;
  const timestamps = [`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`];
  const nodeDefinition = workflow.nodes.find((node) => node.id === nodeId);
  if (nodeDefinition === undefined) return undefined;
  for (const binding of Object.values(nodeDefinition.inputs ?? {})) {
    if (!('node' in binding)) continue;
    const selectedResult = inspected.nodes.find(
      (node) => node.node_id === binding.node,
    )?.selected_result;
    if (selectedResult === undefined) return undefined;
    const predecessorAttempt = inspected.attempts.find(
      (attempt) =>
        attempt.node_id === selectedResult.node_id && attempt.attempt === selectedResult.attempt,
    );
    if (predecessorAttempt === undefined) return undefined;
    timestamps.push(predecessorAttempt.settled_at);
  }
  return timestamps.sort().at(-1);
}

function artifactBytes(
  candidate: ValidatedCandidate,
  attempt: number,
  settledAt: string,
  inputs: Record<string, unknown>,
) {
  const frontmatter = {
    schema_version: 'breakdown.step-artifact.v1',
    run_id: candidate.submission.run_id,
    node_id: candidate.submission.node_id,
    attempt,
    status: candidate.status,
    started_at: candidate.submission.prepared_at,
    settled_at: settledAt,
    context_sha256: candidate.submission.context_sha256,
    inputs,
    executor: {
      kind: candidate.executor.kind,
      name: candidate.executor.name,
      ...(candidate.executor.version === undefined ? {} : { version: candidate.executor.version }),
      ...(candidate.executor.model === undefined ? {} : { model: candidate.executor.model }),
    },
    ...(candidate.problem === undefined ? {} : { problem: candidate.problem }),
  };
  return Buffer.from(
    `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${candidate.markdown}`,
    'utf8',
  );
}

export async function submitCandidate(
  request: SubmitCandidateRequest,
  projectRoot: string,
  dependencies: SubmitCandidateDependencies,
): Promise<OperationResult<SubmitCandidateValue>> {
  if (isCancelled(dependencies.signal)) return cancelledFailure();
  const validated = validateCandidate((request as { candidate?: unknown }).candidate);
  if (!validated.ok) return validated;
  const candidate = validated.value;
  const packetFailure = validatePacketIdentity(
    (request as { packet?: unknown }).packet,
    candidate.submission,
  );
  if (packetFailure !== undefined) return packetFailure;
  if (request.lock_recovery !== undefined) {
    if (isCancelled(dependencies.signal)) return cancelledFailure();
    try {
      await recoverRunWriterLock(
        projectRoot,
        candidate.submission.run_id,
        request.lock_recovery,
        dependencies,
      );
    } catch (error) {
      return error instanceof LockRecoveryMismatchError
        ? lockRecoveryMismatchFailure()
        : ioFailure('Could not recover the Run writer lock.');
    }
    if (isCancelled(dependencies.signal)) return cancelledFailure();
  }
  let lock: RunWriterLock;
  try {
    lock = await acquireRunWriterLock(projectRoot, candidate.submission.run_id, dependencies);
  } catch (error) {
    return error instanceof RunLockedError
      ? conflictFailure('run_locked', 'Another writer currently holds the Run lock.')
      : ioFailure('Could not acquire the Run writer lock.');
  }
  try {
    await dependencies.onPublicationBoundary?.('after_lock_acquired');
    if (isCancelled(dependencies.signal)) return cancelledFailure();
    const inspected = await dependencies.inspect(candidate.submission.run_id);
    if (!inspected.ok) return inspected;
    if (isCancelled(dependencies.signal)) return cancelledFailure();
    const node = inspected.value.nodes.find(
      (inspectedNode) => inspectedNode.node_id === candidate.submission.node_id,
    );
    if (node === undefined) {
      return conflictFailure('no_longer_runnable', 'The submitted node is no longer runnable.');
    }
    if (node.next_attempt !== candidate.submission.expected_attempt) {
      return conflictFailure(
        'attempt_advanced',
        'The submitted node attempt has already advanced.',
      );
    }
    if (node.context_sha256 !== candidate.submission.context_sha256) {
      return conflictFailure('stale_context', 'The submitted Node Context is stale.');
    }
    if (candidate.submission.intent === 'refresh') {
      if (
        node.state !== 'complete' ||
        node.selected_result === undefined ||
        !canonicalValuesEqual(node.selected_result, candidate.submission.refresh_base)
      ) {
        return conflictFailure(
          'refresh_target_not_complete',
          'The refresh target is no longer complete at its prepared Result.',
        );
      }
    } else if (node.state !== 'runnable') {
      return conflictFailure('no_longer_runnable', 'The submitted node is no longer runnable.');
    }

    const loadedWorkflow = await dependencies.loadWorkflow(inspected.value);
    if (!loadedWorkflow.ok) return loadedWorkflow;
    if (isCancelled(dependencies.signal)) return cancelledFailure();
    const definition = loadedWorkflow.value.nodes.find(
      (nodeDefinition) => nodeDefinition.id === candidate.submission.node_id,
    );
    if (definition === undefined) {
      return conflictFailure('no_longer_runnable', 'The submitted node is no longer runnable.');
    }
    const requiresJson = definition.data_contract !== undefined;
    if (candidate.status === 'succeeded' && requiresJson !== (candidate.json !== undefined)) {
      return invalidCandidateFailure([
        diagnostic(
          '/json',
          requiresJson
            ? 'A successful contracted Result requires JSON.'
            : 'A successful uncontracted Result must not include JSON.',
        ),
      ]);
    }
    if (candidate.status === 'succeeded' && requiresJson && candidate.json !== undefined) {
      const diagnostics: Diagnostic[] = [];
      validateDataContractInstance(
        candidate.json.value,
        definition.data_contract,
        'candidate',
        '/json',
        diagnostics,
      );
      if (diagnostics.length > 0) return invalidCandidateFailure(diagnostics);
    }
    const earliestStart = earliestExecutionStart(
      inspected.value,
      loadedWorkflow.value,
      candidate.submission.node_id,
    );
    if (earliestStart === undefined || candidate.submission.prepared_at < earliestStart) {
      return invalidCandidateFailure([
        diagnostic(
          '/submission/prepared_at',
          'prepared_at cannot precede the Run or a selected predecessor Result.',
        ),
      ]);
    }
    const inputs = stepInputs(inspected.value, loadedWorkflow.value, candidate.submission.node_id);
    if (inputs === undefined) {
      return conflictFailure('no_longer_runnable', 'The submitted node is no longer runnable.');
    }

    const settledAt = dependencies.now().toISOString();
    if (settledAt < candidate.submission.prepared_at) {
      return invalidCandidateFailure([
        diagnostic('/submission/prepared_at', 'prepared_at cannot be after settlement.'),
      ]);
    }
    const attempt = node.next_attempt;
    const compactSettledAt = settledAt.replaceAll('-', '').replaceAll(':', '');
    const filename = `${compactSettledAt}--${candidate.submission.node_id}--a${attempt}.md`;
    const stem = filename.slice(0, -'.md'.length);
    const stepsRelativePath = `${inspected.value.path}/steps`;
    const relativePath = `${stepsRelativePath}/${filename}`;
    const jsonRelativePath =
      candidate.json === undefined ? undefined : `${stepsRelativePath}/${stem}.json`;
    const stepsPath = join(projectRoot, stepsRelativePath);
    const stagingToken = Buffer.from(dependencies.randomBytes(8)).toString('hex');
    const markdownStagingPath = join(stepsPath, `.submit-${stagingToken}.md.tmp`);
    const jsonStagingPath = join(stepsPath, `.submit-${stagingToken}.json.tmp`);
    const bytes = artifactBytes(candidate, attempt, settledAt, inputs);
    if (bytes.byteLength > FIXED_LIMITS.automation_response_bytes) {
      return resourceLimitFailure();
    }

    try {
      throwIfCancelled(dependencies.signal);
      if (candidate.json !== undefined) {
        await writePrivateFile(jsonStagingPath, candidate.json.bytes);
      }
      await writePrivateFile(markdownStagingPath, bytes);
      await syncDirectory(stepsPath);
      await dependencies.onPublicationBoundary?.('after_staging_written');
      throwIfCancelled(dependencies.signal);
      if (candidate.json !== undefined && jsonRelativePath !== undefined) {
        await publishPrivateFileNoReplace(
          jsonStagingPath,
          join(projectRoot, jsonRelativePath),
          () => syncDirectory(stepsPath),
        );
        await syncDirectory(stepsPath);
      }
      await dependencies.onPublicationBoundary?.('before_commit');
      await publishPrivateFileNoReplace(
        markdownStagingPath,
        join(projectRoot, relativePath),
        async () => {
          await syncDirectory(stepsPath);
          try {
            await dependencies.onPublicationBoundary?.('after_commit_visible');
          } catch {
            // The Markdown visibility marker is committed; observation cannot roll it back.
          }
        },
      );
      await syncDirectory(stepsPath);
    } catch (error) {
      await Promise.all([
        rm(markdownStagingPath, { force: true }),
        rm(jsonStagingPath, { force: true }),
      ]);
      if (error instanceof InvocationCancelledError) return cancelledFailure();
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return conflictFailure(
          'attempt_advanced',
          'The submitted node attempt has already advanced.',
        );
      }
      return ioFailure();
    }
    try {
      await dependencies.onPublicationBoundary?.('after_commit');
    } catch {
      // The StepArtifact is committed; a post-commit observation fault cannot roll it back.
    }
    if (isCancelled(dependencies.signal)) return cancelledFailure();
    const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
    const jsonDescriptor =
      candidate.json === undefined || jsonRelativePath === undefined
        ? null
        : {
            path: jsonRelativePath,
            sha256: createHash('sha256').update(candidate.json.bytes).digest('hex'),
          };
    const committedInspection = await dependencies.inspect(candidate.submission.run_id);
    if (!committedInspection.ok) return committedInspection;
    if (candidate.status === 'succeeded') {
      const selectedResult = committedInspection.value.nodes.find(
        (inspectedNode) => inspectedNode.node_id === candidate.submission.node_id,
      )?.selected_result;
      if (
        selectedResult?.attempt !== attempt ||
        selectedResult.markdown.path !== relativePath ||
        selectedResult.markdown.sha256 !== artifactSha256 ||
        (jsonDescriptor === null
          ? selectedResult.json !== undefined
          : selectedResult.json?.path !== jsonDescriptor.path ||
            selectedResult.json.sha256 !== jsonDescriptor.sha256)
      ) {
        return internalFailure('Committed inspection did not select the published Result.');
      }
    } else {
      const committedAttempt = committedInspection.value.attempts.find(
        (inspectedAttempt) =>
          inspectedAttempt.node_id === candidate.submission.node_id &&
          inspectedAttempt.attempt === attempt,
      );
      if (
        committedAttempt?.file !== relativePath ||
        committedAttempt.status !== candidate.status ||
        committedAttempt.selected
      ) {
        return internalFailure('Committed inspection did not retain the non-success attempt.');
      }
    }

    const commonValue = {
      run_id: candidate.submission.run_id,
      node_id: candidate.submission.node_id,
      attempt,
      started_at: candidate.submission.prepared_at,
      settled_at: settledAt,
      context_sha256: candidate.submission.context_sha256,
    };
    return candidate.status === 'succeeded'
      ? {
          ok: true,
          value: {
            ...commonValue,
            status: candidate.status,
            result: {
              markdown: {
                path: relativePath,
                sha256: artifactSha256,
              },
              json: jsonDescriptor,
            },
          },
        }
      : {
          ok: true,
          value: {
            ...commonValue,
            status: candidate.status,
            problem: candidate.problem!,
            result: null,
          },
        };
  } catch {
    return ioFailure();
  } finally {
    try {
      await releaseRunWriterLock(lock);
    } catch {
      // Inspection exposes an unexpected leftover lock for explicit recovery.
    }
  }
}
