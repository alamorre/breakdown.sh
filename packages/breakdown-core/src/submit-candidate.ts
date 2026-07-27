import { createHash } from 'node:crypto';
import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { FIXED_LIMITS } from './fixed-limits.js';
import type {
  Diagnostic,
  InspectRunValue,
  OperationFailure,
  OperationResult,
  WorkflowDefinition,
} from './index.js';
import type { SubmissionIdentity, WorkPacket } from './prepare-work.js';
import {
  ensurePrivateDirectoryPath,
  publishPrivateFileNoReplace,
  syncDirectory,
  writePrivateFile,
} from './secure-store.js';
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

export interface SuccessfulCandidateOutcome {
  schema_version: 'breakdown.candidate.v1';
  submission: SubmissionIdentity;
  status: 'succeeded';
  executor: CandidateExecutor;
  markdown: string;
}

export interface SubmitCandidateRequest {
  operation: 'submit_candidate';
  packet: WorkPacket;
  candidate: SuccessfulCandidateOutcome;
}

export interface SubmitCandidateValue {
  run_id: string;
  node_id: string;
  attempt: number;
  status: 'succeeded';
  started_at: string;
  settled_at: string;
  context_sha256: string;
  result: {
    markdown: {
      path: string;
      sha256: string;
    };
    json: null;
  };
}

export type StepPublicationBoundary =
  | 'after_lock_acquired'
  | 'after_staging_written'
  | 'before_commit'
  | 'after_commit';

interface SubmitCandidateDependencies {
  inspect(runId: string): Promise<OperationResult<InspectRunValue>>;
  loadWorkflow(inspected: InspectRunValue): Promise<OperationResult<WorkflowDefinition>>;
  now(): Date;
  randomBytes(size: number): Uint8Array;
  onPublicationBoundary?: (boundary: StepPublicationBoundary) => void | Promise<void>;
}

interface ValidatedCandidate {
  submission: SubmissionIdentity;
  executor: CandidateExecutor;
  markdown: string;
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
) {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      diagnostics.push(
        diagnostic(`${path}/${field}`, `Unknown Candidate Outcome field: ${field}.`),
      );
    }
  }
  for (const field of fields) {
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
    ['schema_version', 'submission', 'status', 'executor', 'markdown'],
    '',
    diagnostics,
  );
  if (value.schema_version !== 'breakdown.candidate.v1') {
    diagnostics.push(
      diagnostic('/schema_version', 'schema_version must be breakdown.candidate.v1.'),
    );
  }
  if (value.status !== 'succeeded') {
    diagnostics.push(diagnostic('/status', 'This operation currently accepts succeeded outcomes.'));
  }

  const submission = value.submission;
  if (!isRecord(submission)) {
    diagnostics.push(diagnostic('/submission', 'submission must be a mapping.'));
  } else {
    exactFields(
      submission,
      ['run_id', 'node_id', 'intent', 'prepared_at', 'expected_attempt', 'context_sha256'],
      '/submission',
      diagnostics,
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

  if (diagnostics.length > 0) return invalidCandidateFailure(diagnostics);
  if (Buffer.byteLength(value.markdown as string, 'utf8') > FIXED_LIMITS.candidate_markdown_bytes) {
    return resourceLimitFailure();
  }
  return {
    ok: true,
    value: {
      submission: submission as unknown as SubmissionIdentity,
      executor: executor as unknown as CandidateExecutor,
      markdown: value.markdown as string,
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
  ] as const;
  const packetSubmission = value.submission;
  const exactSubmissionFields =
    Object.keys(packetSubmission).length === identityFields.length &&
    identityFields.every(
      (field) =>
        Object.hasOwn(packetSubmission, field) && packetSubmission[field] === submission[field],
    );
  const consistentPacket =
    value.schema_version === 'breakdown.work-packet.v1' &&
    value.run_id === submission.run_id &&
    value.intent === submission.intent &&
    value.prepared_at === submission.prepared_at &&
    value.expected_attempt === submission.expected_attempt &&
    value.context_sha256 === submission.context_sha256 &&
    value.node.id === submission.node_id;
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
    status: 'succeeded',
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
  };
  return Buffer.from(
    `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${candidate.markdown}`,
    'utf8',
  );
}

async function acquireRunLock(
  projectRoot: string,
  candidate: ValidatedCandidate,
  dependencies: SubmitCandidateDependencies,
): Promise<
  { ok: true; lockPath: string; lockDirectory: string } | { ok: false; failure: OperationFailure }
> {
  let lockDirectory: string;
  try {
    lockDirectory = await ensurePrivateDirectoryPath(projectRoot, ['.breakdown', 'locks', 'runs']);
  } catch {
    return { ok: false, failure: ioFailure('Could not prepare the Run writer lock.') };
  }
  const lockId = Buffer.from(dependencies.randomBytes(8)).toString('hex');
  const lockPath = join(lockDirectory, `${candidate.submission.run_id}.lock`);
  try {
    await writePrivateFile(
      lockPath,
      Buffer.from(
        JSON.stringify({
          lock_id: lockId,
          run_id: candidate.submission.run_id,
          created_at: dependencies.now().toISOString(),
          process_id: process.pid,
        }),
        'utf8',
      ),
    );
    await syncDirectory(lockDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        ok: false,
        failure: conflictFailure('run_locked', 'Another writer currently holds the Run lock.'),
      };
    }
    return { ok: false, failure: ioFailure('Could not acquire the Run writer lock.') };
  }
  return { ok: true, lockPath, lockDirectory };
}

export async function submitCandidate(
  request: SubmitCandidateRequest,
  projectRoot: string,
  dependencies: SubmitCandidateDependencies,
): Promise<OperationResult<SubmitCandidateValue>> {
  const validated = validateCandidate((request as { candidate?: unknown }).candidate);
  if (!validated.ok) return validated;
  const candidate = validated.value;
  const packetFailure = validatePacketIdentity(
    (request as { packet?: unknown }).packet,
    candidate.submission,
  );
  if (packetFailure !== undefined) return packetFailure;
  const acquired = await acquireRunLock(projectRoot, candidate, dependencies);
  if (!acquired.ok) return acquired.failure;

  const { lockPath, lockDirectory } = acquired;
  try {
    await dependencies.onPublicationBoundary?.('after_lock_acquired');
    const inspected = await dependencies.inspect(candidate.submission.run_id);
    if (!inspected.ok) return inspected;
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
    if (node.state !== 'runnable' || candidate.submission.intent !== 'resume') {
      return conflictFailure('no_longer_runnable', 'The submitted node is no longer runnable.');
    }
    if (node.context_sha256 !== candidate.submission.context_sha256) {
      return conflictFailure('stale_context', 'The submitted Node Context is stale.');
    }

    const loadedWorkflow = await dependencies.loadWorkflow(inspected.value);
    if (!loadedWorkflow.ok) return loadedWorkflow;
    const definition = loadedWorkflow.value.nodes.find(
      (nodeDefinition) => nodeDefinition.id === candidate.submission.node_id,
    );
    if (definition === undefined) {
      return conflictFailure('no_longer_runnable', 'The submitted node is no longer runnable.');
    }
    if (definition.data_contract !== undefined) {
      return invalidCandidateFailure([
        diagnostic('/json', 'A successful contracted Result requires JSON.'),
      ]);
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
    const stepsRelativePath = `${inspected.value.path}/steps`;
    const relativePath = `${stepsRelativePath}/${filename}`;
    const stepsPath = join(projectRoot, stepsRelativePath);
    const stagingPath = join(
      stepsPath,
      `.submit-${Buffer.from(dependencies.randomBytes(8)).toString('hex')}.tmp`,
    );
    const bytes = artifactBytes(candidate, attempt, settledAt, inputs);

    try {
      await writePrivateFile(stagingPath, bytes);
      await syncDirectory(stepsPath);
      await dependencies.onPublicationBoundary?.('after_staging_written');
      await dependencies.onPublicationBoundary?.('before_commit');
      await publishPrivateFileNoReplace(stagingPath, join(projectRoot, relativePath));
      await syncDirectory(stepsPath);
    } catch (error) {
      await rm(stagingPath, { force: true });
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
    const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
    const committedInspection = await dependencies.inspect(candidate.submission.run_id);
    if (!committedInspection.ok) return committedInspection;
    const selectedResult = committedInspection.value.nodes.find(
      (inspectedNode) => inspectedNode.node_id === candidate.submission.node_id,
    )?.selected_result;
    if (
      selectedResult?.attempt !== attempt ||
      selectedResult.markdown.path !== relativePath ||
      selectedResult.markdown.sha256 !== artifactSha256
    ) {
      return internalFailure('Committed inspection did not select the published Result.');
    }

    return {
      ok: true,
      value: {
        run_id: candidate.submission.run_id,
        node_id: candidate.submission.node_id,
        attempt,
        status: 'succeeded',
        started_at: candidate.submission.prepared_at,
        settled_at: settledAt,
        context_sha256: candidate.submission.context_sha256,
        result: {
          markdown: {
            path: relativePath,
            sha256: artifactSha256,
          },
          json: null,
        },
      },
    };
  } catch {
    return ioFailure();
  } finally {
    try {
      await unlink(lockPath);
      await syncDirectory(lockDirectory);
    } catch {
      // Inspection exposes an unexpected leftover lock for explicit recovery.
    }
  }
}
