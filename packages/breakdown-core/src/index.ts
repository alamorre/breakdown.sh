import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';

import { canonicalJsonDomainIssues } from './canonical-json.js';
import { DATA_CONTRACT_KEYWORD_KINDS, DATA_CONTRACT_TYPES } from './data-contract-dialect.js';
import {
  isNonNegativeRawJsonInteger,
  isRawJsonNumber,
  preserveYamlJsonNumber,
} from './exact-json-number.js';
import { FIXED_LIMITS } from './fixed-limits.js';
import {
  cancelledFailure,
  InvocationCancelledError,
  isCancelled,
  preferCancellation,
  throwIfCancelled,
} from './invocation-cancellation.js';
import { inspectRun, type InspectRunRequest, type InspectRunValue } from './run-inspection.js';
import {
  prepareWork,
  type PrepareWorkRequest,
  type PrepareWorkValue,
  type WorkPacket,
} from './prepare-work.js';
import {
  acquireRunWriterLock,
  assertRunWriterLock,
  type LockRecoveryBoundary,
  releaseRunWriterLock,
  RunLockedError,
  type RunWriterLock,
} from './run-writer-lock.js';
import {
  submitCandidate,
  type NonSuccessfulSubmitCandidateRequest,
  type NonSuccessfulSubmitCandidateValue,
  type StepPublicationBoundary,
  type SubmitCandidateRequest,
  type SubmitCandidateValue,
  type SuccessfulSubmitCandidateRequest,
  type SuccessfulSubmitCandidateValue,
} from './submit-candidate.js';
import {
  assertSecureDirectoryIdentity,
  assertSupportedFilesystem,
  ensurePrivateDirectoryPath,
  readSecureDirectory,
  readSecureRegularFile,
  readSecureResultFile,
  ResourceLimitError,
  sameSecureFileIdentity,
  secureFileIdentity,
  type SecureFileIdentity,
  type SelectedProjectRoot,
  syncDirectory,
  UnsupportedFilesystemError,
  writePrivateFile,
} from './secure-store.js';
import { isUnicodeScalarString } from './unicode.js';

export { FIXED_LIMITS } from './fixed-limits.js';
export type {
  InspectRunRequest,
  InspectRunValue,
  InspectedAttempt,
  InspectedNode,
  ObservedRunLock,
  ResultFileDescriptor,
  SelectedResultDescriptor,
} from './run-inspection.js';
export type {
  PrepareWorkRequest,
  PrepareWorkValue,
  SubmissionIdentity,
  WorkPacket,
} from './prepare-work.js';
export type { LockRecoveryIntent } from './run-writer-lock.js';
export type {
  CandidateOutcome,
  CandidateExecutor,
  CandidateProblem,
  CandidateSubmission,
  NonSuccessfulCandidateOutcome,
  NonSuccessfulSubmitCandidateRequest,
  NonSuccessfulSubmitCandidateValue,
  SuccessfulCandidateOutcome,
  SuccessfulSubmitCandidateRequest,
  SuccessfulSubmitCandidateValue,
  SubmitCandidateRequest,
  SubmitCandidateValue,
} from './submit-candidate.js';

export interface ValidateWorkflowRequest {
  operation: 'validate_workflow';
}

export interface CreateRunRequest {
  operation: 'create_run';
  inputs?: Record<string, string>;
}

export interface ReadInputRequest {
  operation: 'read_work_input';
  packet: WorkPacket;
  binding: string;
}

export interface ReadWorkflowInputValue {
  kind: 'workflow_input';
  bytes_base64: string;
}

export interface ReadResultInputValue {
  kind: 'result';
  markdown_bytes_base64: string;
  json_bytes_base64: string | null;
}

export type ReadInputValue = ReadWorkflowInputValue | ReadResultInputValue;

export interface ProducerIdentity {
  name: string;
  version: string;
}

export type RunPublicationBoundary =
  | 'after_inputs_read'
  | 'after_lock_acquired'
  | 'after_staging_created'
  | 'after_snapshot_written'
  | 'after_manifest_written'
  | 'before_publish'
  | 'after_destination_validated'
  | 'after_publish';

export interface TrustedContext {
  projectRoot?: string;
  producer?: ProducerIdentity;
  signal?: AbortSignal;
  testControls?: {
    now?: () => Date;
    randomBytes?: (size: number) => Uint8Array;
    onRunPublicationBoundary?: (boundary: RunPublicationBoundary) => void | Promise<void>;
    onStepPublicationBoundary?: (boundary: StepPublicationBoundary) => void | Promise<void>;
    onLockRecoveryBoundary?: (boundary: LockRecoveryBoundary) => void | Promise<void>;
    onProjectRootSelected?: () => void | Promise<void>;
    onStepDirectoryListed?: () => void | Promise<void>;
  };
}

const INTERNAL_DEFINITION_BYTES: unique symbol = Symbol('internal-definition-bytes');
const INTERNAL_SELECTED_PROJECT_ROOT: unique symbol = Symbol('internal-selected-project-root');

interface InternalTrustedContext extends TrustedContext {
  [INTERNAL_DEFINITION_BYTES]?: true;
  [INTERNAL_SELECTED_PROJECT_ROOT]?: SelectedProjectRoot;
  definitionBytes?: Uint8Array;
}

function selectedProjectRootFromContext(context: TrustedContext) {
  const selectedProjectRoot = (context as Partial<InternalTrustedContext>)[
    INTERNAL_SELECTED_PROJECT_ROOT
  ];
  if (selectedProjectRoot === undefined) {
    throw new Error('The internal selected project-root identity is missing.');
  }
  return selectedProjectRoot;
}

async function assertSelectedProjectRoot(selectedProjectRoot: SelectedProjectRoot) {
  const facts = await lstat(selectedProjectRoot.path, { bigint: true });
  if (
    !facts.isDirectory() ||
    !sameSecureFileIdentity(secureFileIdentity(facts), selectedProjectRoot.identity)
  ) {
    throw new Error('The selected project-root identity changed.');
  }
}

function continueAtSelectedProjectRoot(
  trustedContext: TrustedContext,
  options: {
    definitionBytes?: Uint8Array;
  } = {},
): InternalTrustedContext {
  const selectedProjectRoot = selectedProjectRootFromContext(trustedContext);
  return {
    projectRoot: selectedProjectRoot.path,
    [INTERNAL_SELECTED_PROJECT_ROOT]: selectedProjectRoot,
    ...(options.definitionBytes === undefined
      ? {}
      : {
          [INTERNAL_DEFINITION_BYTES]: true as const,
          definitionBytes: options.definitionBytes,
        }),
    signal: trustedContext.signal,
  };
}

async function withSelectedProjectRoot<T>(
  trustedContext: TrustedContext,
  action: (projectRoot: SelectedProjectRoot) => Promise<T>,
): Promise<T> {
  const selectedProjectRoot = selectedProjectRootFromContext(trustedContext);
  await assertSelectedProjectRoot(selectedProjectRoot);
  const value = await action(selectedProjectRoot);
  await assertSelectedProjectRoot(selectedProjectRoot);
  return value;
}

export interface NodeDefinition {
  id: string;
  name: string;
  prompt: string;
  inputs?: Record<string, InputBindingSource>;
  data_contract?: Record<string, unknown>;
  extensions?: Record<string, Record<string, unknown>>;
}

export interface WorkflowInputDefinition {
  description?: string;
  default?: string;
}

export type InputBindingSource = { workflow_input: string } | { node: string };

export interface WorkflowDefinition {
  schema_version: 'breakdown.workflow.v1';
  id: string;
  name: string;
  description?: string;
  inputs?: Record<string, WorkflowInputDefinition>;
  nodes: NodeDefinition[];
  extensions?: Record<string, Record<string, unknown>>;
}

export interface ValidateWorkflowValue {
  definitionPath: 'breakdown.yaml';
  workflow: WorkflowDefinition;
}

export interface ResolvedWorkflowInput {
  path: string;
  sha256: string;
}

interface ResolvedWorkflowInputs {
  records: Record<string, ResolvedWorkflowInput>;
  identities: Record<string, SecureFileIdentity>;
}

export interface CreateRunValue {
  run_id: string;
  path: string;
  created_at: string;
  workflow: {
    id: string;
    snapshot: 'breakdown.yaml';
    sha256: string;
  };
  inputs: Record<string, ResolvedWorkflowInput>;
  producer: ProducerIdentity;
}

export type { WorkPacketInput } from './prepare-work.js';

export interface OperationSuccess<T> {
  ok: true;
  value: T;
}

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  file?: string;
}

export interface OperationFailure {
  ok: false;
  failure: {
    kind:
      | 'invalid'
      | 'conflict'
      | 'unsupported'
      | 'cancelled'
      | 'resource_limit'
      | 'io'
      | 'internal';
    code: string;
    message: string;
    diagnostics: Diagnostic[];
  };
}

export type OperationResult<T> = OperationSuccess<T> | OperationFailure;

function validationFailure(
  diagnostics: Diagnostic[],
  kind: OperationFailure['failure']['kind'] = 'invalid',
  code = 'invalid_workflow',
): OperationFailure {
  return {
    ok: false,
    failure: {
      kind,
      code,
      message:
        code === 'unsupported_version'
          ? 'The Workflow Definition uses an unsupported version.'
          : 'The Workflow Definition is invalid.',
      diagnostics,
    },
  };
}

function resourceLimitFailure(diagnostics: Diagnostic[] = []): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'resource_limit',
      code: 'limit_exceeded',
      message: 'A fixed resource limit was exceeded.',
      diagnostics,
    },
  };
}

function ioFailure(message = 'A filesystem operation failed.'): OperationFailure {
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

function readWorkInputFailure(
  diagnostics: Diagnostic[] = [],
  kind: OperationFailure['failure']['kind'] = 'invalid',
  code = 'invalid_work_input',
): OperationFailure {
  return {
    ok: false,
    failure: {
      kind,
      code,
      message:
        code === 'invalid_work_input' ? 'The Input is invalid.' : 'The Work Packet is invalid.',
      diagnostics,
    },
  };
}

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64');
}

function runIdCollisionFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'conflict',
      code: 'run_id_collision',
      message: 'Could not allocate a unique Run ID.',
      diagnostics: [],
    },
  };
}

function runLockedFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'conflict',
      code: 'run_locked',
      message: 'Another writer currently holds the Run lock.',
      diagnostics: [],
    },
  };
}

function unsupportedFilesystemFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'unsupported',
      code: 'unsupported_filesystem',
      message: 'The selected project root is on an unsupported filesystem.',
      diagnostics: [],
    },
  };
}

function invalidProducerFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'internal',
      code: 'internal_error',
      message: 'The trusted producer identity is invalid.',
      diagnostics: [],
    },
  };
}

function projectRootRequiredFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'invalid',
      code: 'project_root_required',
      message: 'An explicit project root is required.',
      diagnostics: [],
    },
  };
}

function unsupportedYamlVersionFailure(): OperationFailure {
  return validationFailure(
    [
      {
        code: 'unsupported_version',
        path: '',
        message: 'Only the YAML 1.2 directive is supported.',
        file: 'breakdown.yaml',
      },
    ],
    'unsupported',
    'unsupported_version',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isRawJsonNumber(value)
  );
}

function schemaDiagnostic(path: string, message: string): Diagnostic {
  return {
    code: 'schema',
    path,
    message,
    file: 'breakdown.yaml',
  };
}

function invalidPathDiagnostic(path: string): Diagnostic {
  return {
    code: 'invalid_path',
    path,
    message: 'Workflow Input paths must be portable project-relative paths.',
    file: 'breakdown.yaml',
  };
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic) {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  if (left.code < right.code) return -1;
  if (left.code > right.code) return 1;
  return 0;
}

function escapePointerSegment(segment: string) {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function nonStringKeyPathSegment(key: unknown) {
  if (isScalar(key)) return escapePointerSegment(String(key.value));
  return '<non-string-key>';
}

function collectNonStringMappingKeyDiagnostics(
  value: unknown,
  path = '',
  diagnostics: Diagnostic[] = [],
): Diagnostic[] {
  if (isSeq(value)) {
    value.items.forEach((item, index) => {
      collectNonStringMappingKeyDiagnostics(item, `${path}/${index}`, diagnostics);
    });
    return diagnostics;
  }
  if (!isMap(value)) return diagnostics;

  for (const pair of value.items) {
    const stringKey =
      isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : undefined;
    const pathSegment =
      stringKey === undefined ? nonStringKeyPathSegment(pair.key) : escapePointerSegment(stringKey);
    const pairPath = `${path}/${pathSegment}`;
    if (stringKey === undefined) {
      diagnostics.push(schemaDiagnostic(pairPath, 'JSON-compatible mapping keys must be strings.'));
    }
    collectNonStringMappingKeyDiagnostics(pair.value, pairPath, diagnostics);
  }
  return diagnostics;
}

const identifierPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function unicodeLength(value: string) {
  return [...value].length;
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && unicodeLength(value) <= 64 && identifierPattern.test(value);
}

function validateIdentifier(value: unknown, path: string, diagnostics: Diagnostic[]) {
  if (!isValidIdentifier(value)) {
    diagnostics.push(
      schemaDiagnostic(
        path,
        'Identifiers must be 1-64 lowercase ASCII kebab-case characters and start with a letter.',
      ),
    );
    return false;
  }
  return true;
}

function validateName(value: unknown, path: string, diagnostics: Diagnostic[]) {
  if (
    typeof value !== 'string' ||
    !isUnicodeScalarString(value) ||
    value.length === 0 ||
    value !== value.trim() ||
    unicodeLength(value) > 200
  ) {
    diagnostics.push(
      schemaDiagnostic(path, 'Names must be trimmed, non-empty strings of at most 200 characters.'),
    );
  }
}

function validatePrompt(value: unknown, path: string, diagnostics: Diagnostic[]) {
  if (typeof value !== 'string' || !isUnicodeScalarString(value) || value.length === 0) {
    diagnostics.push(schemaDiagnostic(path, 'prompt must be a non-empty string.'));
  }
}

function validateOptionalDescription(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  maximumLength?: number,
) {
  if (
    typeof value !== 'string' ||
    !isUnicodeScalarString(value) ||
    (maximumLength !== undefined && unicodeLength(value) > maximumLength)
  ) {
    diagnostics.push(
      schemaDiagnostic(
        path,
        maximumLength === undefined
          ? 'description must be a string.'
          : `description must be a string of at most ${maximumLength} characters.`,
      ),
    );
  }
}

function isPortableProjectRelativePath(value: string) {
  if (
    !isUnicodeScalarString(value) ||
    value.length === 0 ||
    value.startsWith('/') ||
    value.startsWith('~') ||
    /^[A-Za-z]:/.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes('$') ||
    value.includes('`') ||
    value.includes('%') ||
    ['*', '?', '[', ']', '{', '}'].some((character) => value.includes(character))
  ) {
    return false;
  }

  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function validateWorkflowInputs(value: unknown, diagnostics: Diagnostic[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push(schemaDiagnostic('/inputs', 'inputs must be a mapping.'));
    return;
  }

  for (const [inputId, input] of Object.entries(value)) {
    const inputPath = `/inputs/${escapePointerSegment(inputId)}`;
    validateIdentifier(inputId, inputPath, diagnostics);
    if (!isRecord(input)) {
      diagnostics.push(schemaDiagnostic(inputPath, 'Each Workflow Input must be a mapping.'));
      continue;
    }

    const inputFields = new Set(['description', 'default']);
    for (const field of Object.keys(input)) {
      if (!inputFields.has(field)) {
        diagnostics.push(
          schemaDiagnostic(
            `${inputPath}/${escapePointerSegment(field)}`,
            `Unknown Workflow Input field: ${field}.`,
          ),
        );
      }
    }

    if (input.description !== undefined) {
      validateOptionalDescription(input.description, `${inputPath}/description`, diagnostics);
    }
    if (input.default !== undefined) {
      const defaultPath = `${inputPath}/default`;
      if (typeof input.default !== 'string') {
        diagnostics.push(schemaDiagnostic(defaultPath, 'default must be a string.'));
      } else if (!isPortableProjectRelativePath(input.default)) {
        diagnostics.push(invalidPathDiagnostic(defaultPath));
      }
    }
  }
}

function validateInputBindings(value: unknown, nodePath: string, diagnostics: Diagnostic[]) {
  if (value === undefined) return;
  const inputsPath = `${nodePath}/inputs`;
  if (!isRecord(value)) {
    diagnostics.push(schemaDiagnostic(inputsPath, 'inputs must be a mapping.'));
    return;
  }

  for (const [bindingId, source] of Object.entries(value)) {
    const bindingPath = `${inputsPath}/${escapePointerSegment(bindingId)}`;
    validateIdentifier(bindingId, bindingPath, diagnostics);
    if (!isRecord(source)) {
      diagnostics.push(
        schemaDiagnostic(bindingPath, 'Each Input Binding source must be a mapping.'),
      );
      continue;
    }

    const sourceFields = Object.keys(source);
    const recognizedFields = sourceFields.filter(
      (field) => field === 'workflow_input' || field === 'node',
    );
    if (sourceFields.length !== 1 || recognizedFields.length !== 1) {
      diagnostics.push(
        schemaDiagnostic(
          bindingPath,
          'Each Input Binding must name exactly one Workflow Input or Node Definition.',
        ),
      );
    }

    for (const field of sourceFields) {
      const sourcePath = `${bindingPath}/${escapePointerSegment(field)}`;
      if (field !== 'workflow_input' && field !== 'node') {
        diagnostics.push(schemaDiagnostic(sourcePath, `Unknown Input Binding field: ${field}.`));
      } else {
        validateIdentifier(source[field], sourcePath, diagnostics);
      }
    }
  }
}

const dataContractTypes = new Set<string>(DATA_CONTRACT_TYPES);

function isValidDataContractType(value: unknown) {
  if (typeof value === 'string') return dataContractTypes.has(value);
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && dataContractTypes.has(item)) &&
    new Set(value).size === value.length
  );
}

function isNonNegativeInteger(value: unknown) {
  return (
    (typeof value === 'number' && Number.isInteger(value) && value >= 0) ||
    (typeof value === 'bigint' && value >= 0n) ||
    isNonNegativeRawJsonInteger(value)
  );
}

function isFiniteJsonNumber(value: unknown) {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'bigint' ||
    isRawJsonNumber(value)
  );
}

function validateCanonicalJsonDomain(value: unknown, path: string, diagnostics: Diagnostic[]) {
  for (const issue of canonicalJsonDomainIssues(value)) {
    const issuePath = issue.path.reduce<string>(
      (current, segment) => `${current}/${escapePointerSegment(String(segment))}`,
      path,
    );
    diagnostics.push(
      schemaDiagnostic(
        issuePath,
        issue.code === 'invalid_unicode'
          ? 'Canonical JSON strings and property names must be valid Unicode.'
          : 'Canonical JSON numbers must fit IEEE-754 binary64.',
      ),
    );
  }
}

function validateDataContractSchema(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  allowBoolean: boolean,
) {
  if (allowBoolean && typeof value === 'boolean') return;
  if (!isRecord(value)) {
    diagnostics.push(schemaDiagnostic(path, 'Data Contract schemas must be mappings.'));
    return;
  }

  for (const keyword of Object.keys(value)) {
    const keywordPath = `${path}/${escapePointerSegment(keyword)}`;
    const keywordKind = Object.hasOwn(DATA_CONTRACT_KEYWORD_KINDS, keyword)
      ? DATA_CONTRACT_KEYWORD_KINDS[keyword as keyof typeof DATA_CONTRACT_KEYWORD_KINDS]
      : undefined;
    if (keywordKind === undefined) {
      diagnostics.push(
        schemaDiagnostic(keywordPath, `Unsupported Data Contract keyword: ${keyword}.`),
      );
      continue;
    }

    const keywordValue = value[keyword];
    switch (keywordKind) {
      case 'type':
        if (!isValidDataContractType(keywordValue)) {
          diagnostics.push(
            schemaDiagnostic(keywordPath, 'type must name one or more unique JSON value types.'),
          );
        }
        break;
      case 'enum':
        if (!Array.isArray(keywordValue)) {
          diagnostics.push(schemaDiagnostic(keywordPath, 'enum must be an array of JSON values.'));
        }
        break;
      case 'any':
        break;
      case 'string':
        if (typeof keywordValue !== 'string') {
          diagnostics.push(schemaDiagnostic(keywordPath, `${keyword} must be a string.`));
        }
        break;
      case 'schemas':
        if (!isRecord(keywordValue)) {
          diagnostics.push(schemaDiagnostic(keywordPath, 'properties must be a mapping.'));
          break;
        }
        for (const [property, propertySchema] of Object.entries(keywordValue)) {
          validateDataContractSchema(
            propertySchema,
            `${keywordPath}/${escapePointerSegment(property)}`,
            diagnostics,
            true,
          );
        }
        break;
      case 'string-array':
        if (
          !Array.isArray(keywordValue) ||
          !keywordValue.every((item) => typeof item === 'string') ||
          new Set(keywordValue).size !== keywordValue.length
        ) {
          diagnostics.push(
            schemaDiagnostic(keywordPath, 'required must be an array of unique strings.'),
          );
        }
        break;
      case 'schema':
        validateDataContractSchema(keywordValue, keywordPath, diagnostics, true);
        break;
      case 'non-negative-integer':
        if (!isNonNegativeInteger(keywordValue)) {
          diagnostics.push(
            schemaDiagnostic(keywordPath, `${keyword} must be a non-negative integer.`),
          );
        }
        break;
      case 'number':
        if (!isFiniteJsonNumber(keywordValue)) {
          diagnostics.push(schemaDiagnostic(keywordPath, `${keyword} must be a finite number.`));
        }
        break;
    }
  }
}

function validateDataContract(value: unknown, nodePath: string, diagnostics: Diagnostic[]) {
  if (value === undefined) return;
  const path = `${nodePath}/data_contract`;
  validateCanonicalJsonDomain(value, path, diagnostics);
  validateDataContractSchema(value, path, diagnostics, false);
}

const reverseDnsNamespacePattern =
  /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function validateExtensions(value: unknown, path: string, diagnostics: Diagnostic[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push(schemaDiagnostic(path, 'extensions must be a mapping.'));
    return;
  }

  for (const [namespace, extension] of Object.entries(value)) {
    const extensionPath = `${path}/${escapePointerSegment(namespace)}`;
    if (!reverseDnsNamespacePattern.test(namespace)) {
      diagnostics.push(
        schemaDiagnostic(extensionPath, 'Extension keys must be reverse-DNS namespaces.'),
      );
    }
    if (!isRecord(extension)) {
      diagnostics.push(schemaDiagnostic(extensionPath, 'Extension values must be JSON objects.'));
    }
  }
}

function yamlCollectionDepth(value: unknown, parentDepth = 0): number {
  if (isSeq(value)) {
    const depth = parentDepth + 1;
    let maximum = depth;
    for (const item of value.items) {
      maximum = Math.max(maximum, yamlCollectionDepth(item, depth));
    }
    return maximum;
  }
  if (isMap(value)) {
    const depth = parentDepth + 1;
    let maximum = depth;
    for (const item of value.items) {
      maximum = Math.max(
        maximum,
        yamlCollectionDepth(item.key, depth),
        yamlCollectionDepth(item.value, depth),
      );
    }
    return maximum;
  }
  return parentDepth;
}

function normalizeJsonIntegers(value: unknown): unknown {
  if (isRawJsonNumber(value)) return value;
  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJsonIntegers);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJsonIntegers(item)]),
    );
  }
  return value;
}

function dataContractSchemaNodeCount(value: unknown): number {
  if (!isRecord(value)) return 1;

  let count = 1;
  if (isRecord(value.properties)) {
    for (const schema of Object.values(value.properties)) {
      count += dataContractSchemaNodeCount(schema);
      if (count > FIXED_LIMITS.data_contract_schema_nodes) return count;
    }
  }
  if (value.items !== undefined) {
    count += dataContractSchemaNodeCount(value.items);
  }
  if (value.additionalProperties !== undefined) {
    count += dataContractSchemaNodeCount(value.additionalProperties);
  }
  return count;
}

function exceedsDefinitionStructuralLimits(value: unknown) {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.nodes) && value.nodes.length > FIXED_LIMITS.nodes_per_workflow) {
    return true;
  }
  if (
    isRecord(value.inputs) &&
    Object.keys(value.inputs).length > FIXED_LIMITS.workflow_inputs_per_workflow
  ) {
    return true;
  }
  if (isRecord(value.inputs)) {
    for (const input of Object.values(value.inputs)) {
      if (
        isRecord(input) &&
        typeof input.default === 'string' &&
        Buffer.byteLength(input.default) > FIXED_LIMITS.project_relative_path_bytes
      ) {
        return true;
      }
    }
  }
  if (!Array.isArray(value.nodes)) return false;

  for (const node of value.nodes) {
    if (!isRecord(node)) continue;
    if (
      isRecord(node.inputs) &&
      Object.keys(node.inputs).length > FIXED_LIMITS.input_bindings_per_node
    ) {
      return true;
    }
    if (
      typeof node.prompt === 'string' &&
      Buffer.byteLength(node.prompt) > FIXED_LIMITS.node_prompt_bytes
    ) {
      return true;
    }
    if (
      node.data_contract !== undefined &&
      dataContractSchemaNodeCount(node.data_contract) > FIXED_LIMITS.data_contract_schema_nodes
    ) {
      return true;
    }
  }
  return false;
}

type BindingSourceKind = 'workflow_input' | 'node';

interface ValidInputBinding {
  bindingId: string;
  nodeId?: string;
  nodeIndex: number;
  sourceId: string;
  sourceKind: BindingSourceKind;
  sourcePath: string;
}

function semanticDiagnostic(code: string, path: string, message: string): Diagnostic {
  return {
    code,
    path,
    message,
    file: 'breakdown.yaml',
  };
}

function compareIdentifiers(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function collectValidInputBindings(nodes: unknown[]): ValidInputBinding[] {
  const bindings: ValidInputBinding[] = [];

  nodes.forEach((node, nodeIndex) => {
    if (!isRecord(node) || !isRecord(node.inputs)) return;
    const nodeId = isValidIdentifier(node.id) ? node.id : undefined;
    const entries = Object.entries(node.inputs).sort(([left], [right]) =>
      compareIdentifiers(left, right),
    );
    for (const [bindingId, source] of entries) {
      if (!isRecord(source)) continue;
      const sourceFields = Object.keys(source);
      if (sourceFields.length !== 1) continue;
      const sourceKind = sourceFields[0];
      if (sourceKind !== 'workflow_input' && sourceKind !== 'node') continue;
      const sourceId = source[sourceKind];
      if (!isValidIdentifier(sourceId)) continue;
      bindings.push({
        bindingId,
        nodeId,
        nodeIndex,
        sourceId,
        sourceKind,
        sourcePath: `/nodes/${nodeIndex}/inputs/${escapePointerSegment(bindingId)}/${sourceKind}`,
      });
    }
  });

  return bindings;
}

function findStronglyConnectedComponents(
  nodeIds: string[],
  nodeBindings: ValidInputBinding[],
): Map<string, number> {
  const bindingsByReceiver = new Map<string, ValidInputBinding[]>();
  for (const binding of nodeBindings) {
    if (binding.nodeId === undefined) continue;
    const bindings = bindingsByReceiver.get(binding.nodeId) ?? [];
    bindings.push(binding);
    bindingsByReceiver.set(binding.nodeId, bindings);
  }

  let nextIndex = 0;
  let componentIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const componentByNode = new Map<string, number>();

  function visitNode(nodeId: string) {
    const index = nextIndex;
    nextIndex += 1;
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const binding of bindingsByReceiver.get(nodeId) ?? []) {
      const sourceId = binding.sourceId;
      if (!indices.has(sourceId)) {
        visitNode(sourceId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(sourceId)!));
      } else if (onStack.has(sourceId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(sourceId)!));
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    while (stack.length > 0) {
      const componentNode = stack.pop()!;
      onStack.delete(componentNode);
      componentByNode.set(componentNode, componentIndex);
      if (componentNode === nodeId) break;
    }
    componentIndex += 1;
  }

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) visitNode(nodeId);
  }

  return componentByNode;
}

function validateWorkflowSemantics(value: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (!Array.isArray(value.nodes)) return;

  const declaredWorkflowInputIds = new Set<string>();
  if (isRecord(value.inputs)) {
    for (const inputId of Object.keys(value.inputs)) {
      if (isValidIdentifier(inputId)) declaredWorkflowInputIds.add(inputId);
    }
  }

  const nodeIdCounts = new Map<string, number>();
  for (const node of value.nodes) {
    if (!isRecord(node) || !isValidIdentifier(node.id)) continue;
    nodeIdCounts.set(node.id, (nodeIdCounts.get(node.id) ?? 0) + 1);
  }
  const declaredNodeIds = new Set(nodeIdCounts.keys());
  const uniqueNodeIds = value.nodes.flatMap((node) =>
    isRecord(node) && isValidIdentifier(node.id) && nodeIdCounts.get(node.id) === 1
      ? [node.id]
      : [],
  );
  const uniqueNodeIdSet = new Set(uniqueNodeIds);
  const bindings = collectValidInputBindings(value.nodes);
  const consumedWorkflowInputIds = new Set<string>();
  const nodeBindingsForCycles: ValidInputBinding[] = [];
  const sourcesByNodeIndex = new Map<number, Set<string>>();

  for (const binding of bindings) {
    const sourceIdentity = `${binding.sourceKind}\0${binding.sourceId}`;
    const seenSources = sourcesByNodeIndex.get(binding.nodeIndex) ?? new Set<string>();
    if (seenSources.has(sourceIdentity)) {
      diagnostics.push(
        semanticDiagnostic(
          'duplicate_source',
          binding.sourcePath,
          'Each source may appear at most once for one receiving node.',
        ),
      );
    } else {
      seenSources.add(sourceIdentity);
      sourcesByNodeIndex.set(binding.nodeIndex, seenSources);
    }

    if (binding.sourceKind === 'workflow_input') {
      if (declaredWorkflowInputIds.has(binding.sourceId)) {
        consumedWorkflowInputIds.add(binding.sourceId);
      } else {
        diagnostics.push(
          semanticDiagnostic(
            'missing_reference',
            binding.sourcePath,
            `Workflow Input ${binding.sourceId} does not exist.`,
          ),
        );
      }
    } else if (!declaredNodeIds.has(binding.sourceId)) {
      diagnostics.push(
        semanticDiagnostic(
          'missing_reference',
          binding.sourcePath,
          `Node Definition ${binding.sourceId} does not exist.`,
        ),
      );
    } else if (
      binding.nodeId !== undefined &&
      uniqueNodeIdSet.has(binding.nodeId) &&
      uniqueNodeIdSet.has(binding.sourceId)
    ) {
      nodeBindingsForCycles.push(binding);
    }
  }

  for (const inputId of declaredWorkflowInputIds) {
    if (!consumedWorkflowInputIds.has(inputId)) {
      diagnostics.push(
        semanticDiagnostic(
          'unused_input',
          `/inputs/${escapePointerSegment(inputId)}`,
          `Workflow Input ${inputId} is not consumed by any node.`,
        ),
      );
    }
  }

  const componentByNode = findStronglyConnectedComponents(uniqueNodeIds, nodeBindingsForCycles);
  const componentSizes = new Map<number, number>();
  for (const component of componentByNode.values()) {
    componentSizes.set(component, (componentSizes.get(component) ?? 0) + 1);
  }
  for (const binding of nodeBindingsForCycles) {
    const receiverComponent = componentByNode.get(binding.nodeId!);
    const sourceComponent = componentByNode.get(binding.sourceId);
    if (
      receiverComponent !== undefined &&
      receiverComponent === sourceComponent &&
      ((componentSizes.get(receiverComponent) ?? 0) > 1 || binding.nodeId === binding.sourceId)
    ) {
      diagnostics.push(
        semanticDiagnostic(
          'cycle',
          binding.sourcePath,
          'Node Definition references must form a directed acyclic graph.',
        ),
      );
    }
  }
}

function validateWorkflowShape(
  value: unknown,
  yamlIdentifierKeyDiagnostics: Diagnostic[] = [],
): Diagnostic[] {
  if (!isRecord(value)) {
    return [
      ...yamlIdentifierKeyDiagnostics,
      schemaDiagnostic('', 'The Workflow Definition root must be a mapping.'),
    ].sort(compareDiagnostics);
  }

  const diagnostics = [...yamlIdentifierKeyDiagnostics];
  const rootFields = new Set([
    'schema_version',
    'id',
    'name',
    'description',
    'inputs',
    'nodes',
    'extensions',
  ]);

  for (const field of Object.keys(value)) {
    if (!rootFields.has(field)) {
      diagnostics.push(
        schemaDiagnostic(
          `/${escapePointerSegment(field)}`,
          `Unknown Workflow Definition field: ${field}.`,
        ),
      );
    }
  }

  if (value.schema_version === undefined) {
    diagnostics.push(schemaDiagnostic('/schema_version', 'schema_version is required.'));
  } else if (typeof value.schema_version !== 'string') {
    diagnostics.push(schemaDiagnostic('/schema_version', 'schema_version must be a string.'));
  } else if (value.schema_version !== 'breakdown.workflow.v1') {
    diagnostics.push({
      code: 'unsupported_version',
      path: '/schema_version',
      message: 'schema_version must be breakdown.workflow.v1.',
      file: 'breakdown.yaml',
    });
  }

  validateIdentifier(value.id, '/id', diagnostics);
  validateName(value.name, '/name', diagnostics);
  if (value.description !== undefined) {
    validateOptionalDescription(value.description, '/description', diagnostics, 2_000);
  }
  validateWorkflowInputs(value.inputs, diagnostics);
  validateExtensions(value.extensions, '/extensions', diagnostics);

  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    diagnostics.push(schemaDiagnostic('/nodes', 'nodes must be a non-empty array.'));
  } else {
    const seenNodeIds = new Set<string>();
    value.nodes.forEach((node, index) => {
      const nodePath = `/nodes/${index}`;
      if (!isRecord(node)) {
        diagnostics.push(schemaDiagnostic(nodePath, 'Each node must be a mapping.'));
        return;
      }

      const nodeFields = new Set(['id', 'name', 'prompt', 'inputs', 'data_contract', 'extensions']);
      for (const field of Object.keys(node)) {
        if (!nodeFields.has(field)) {
          diagnostics.push(
            schemaDiagnostic(
              `${nodePath}/${escapePointerSegment(field)}`,
              `Unknown Node Definition field: ${field}.`,
            ),
          );
        }
      }

      const validNodeId = validateIdentifier(node.id, `${nodePath}/id`, diagnostics);
      if (validNodeId && typeof node.id === 'string') {
        if (seenNodeIds.has(node.id)) {
          diagnostics.push(
            schemaDiagnostic(`${nodePath}/id`, 'Node Definition identifiers must be unique.'),
          );
        } else {
          seenNodeIds.add(node.id);
        }
      }
      validateName(node.name, `${nodePath}/name`, diagnostics);
      validatePrompt(node.prompt, `${nodePath}/prompt`, diagnostics);
      validateInputBindings(node.inputs, nodePath, diagnostics);
      validateDataContract(node.data_contract, nodePath, diagnostics);
      validateExtensions(node.extensions, `${nodePath}/extensions`, diagnostics);
    });
  }

  validateWorkflowSemantics(value, diagnostics);
  return diagnostics.sort(compareDiagnostics);
}

function sortIdentifierMap<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => compareIdentifiers(left, right)),
  );
}

function normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    ...(workflow.inputs === undefined ? {} : { inputs: sortIdentifierMap(workflow.inputs) }),
    nodes: workflow.nodes.map((node) => ({
      ...node,
      ...(node.inputs === undefined ? {} : { inputs: sortIdentifierMap(node.inputs) }),
    })),
  };
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function base32Suffix(bytes: Uint8Array) {
  let bits = 0;
  let bitCount = 0;
  let encoded = '';
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && encoded.length < 12) {
      bitCount -= 5;
      encoded += BASE32_ALPHABET[(bits >>> bitCount) & 31];
    }
    if (encoded.length === 12) return encoded;
    bits &= (1 << bitCount) - 1;
  }
  throw new Error('Cryptographic entropy did not provide enough bytes for a Run ID.');
}

function runManifestBytes(value: CreateRunValue) {
  const inputLines = Object.entries(value.inputs).flatMap(([inputId, input]) => [
    `  ${inputId}:`,
    `    path: ${JSON.stringify(input.path)}`,
    `    sha256: ${input.sha256}`,
  ]);
  return Buffer.from(
    [
      '---',
      'schema_version: breakdown.run.v1',
      `run_id: ${value.run_id}`,
      `created_at: ${JSON.stringify(value.created_at)}`,
      'workflow:',
      `  id: ${value.workflow.id}`,
      '  snapshot: breakdown.yaml',
      `  sha256: ${value.workflow.sha256}`,
      ...(inputLines.length === 0 ? ['inputs: {}'] : ['inputs:', ...inputLines]),
      'producer:',
      `  name: ${JSON.stringify(value.producer.name)}`,
      `  version: ${JSON.stringify(value.producer.version)}`,
      '---',
      '',
    ].join('\n'),
    'utf8',
  );
}

function workflowInputFailure(diagnostics: Diagnostic[]): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'invalid',
      code: 'invalid_workflow_input',
      message: 'The Workflow Inputs are invalid.',
      diagnostics: diagnostics.sort(compareDiagnostics),
    },
  };
}

async function resolveWorkflowInputs(
  selectedProjectRoot: SelectedProjectRoot,
  workflow: WorkflowDefinition,
  overrideValue: unknown,
): Promise<OperationResult<ResolvedWorkflowInputs>> {
  if (!isRecord(overrideValue)) {
    return workflowInputFailure([
      schemaDiagnostic('/inputs', 'Workflow Input overrides must be a mapping of paths.'),
    ]);
  }
  const overrides = overrideValue;
  const definitions = workflow.inputs ?? {};
  const diagnostics = Object.keys(overrides)
    .filter((inputId) => !Object.hasOwn(definitions, inputId))
    .map((inputId) =>
      schemaDiagnostic(
        `/inputs/${escapePointerSegment(inputId)}`,
        'Unknown Workflow Input override.',
      ),
    );
  const paths: Record<string, string> = {};
  for (const [inputId, definition] of Object.entries(definitions)) {
    const hasOverride = Object.hasOwn(overrides, inputId);
    const override = hasOverride ? overrides[inputId] : undefined;
    if (hasOverride && typeof override !== 'string') {
      diagnostics.push(
        schemaDiagnostic(
          `/inputs/${escapePointerSegment(inputId)}`,
          'Workflow Input overrides must be path strings.',
        ),
      );
      continue;
    }
    const path = typeof override === 'string' ? override : definition.default;
    if (path === undefined) {
      diagnostics.push(
        schemaDiagnostic(
          `/inputs/${escapePointerSegment(inputId)}`,
          'A path is required for this Workflow Input.',
        ),
      );
    } else if (Buffer.byteLength(path, 'utf8') > FIXED_LIMITS.project_relative_path_bytes) {
      return resourceLimitFailure();
    } else if (!isPortableProjectRelativePath(path)) {
      diagnostics.push(invalidPathDiagnostic(`/inputs/${escapePointerSegment(inputId)}`));
    } else {
      paths[inputId] = path;
    }
  }
  if (diagnostics.length > 0) return workflowInputFailure(diagnostics);

  const resolved: Record<string, ResolvedWorkflowInput> = {};
  const identities: Record<string, SecureFileIdentity> = {};
  let aggregateBytes = 0;
  for (const [inputId, path] of Object.entries(paths)) {
    let secureRead: Awaited<ReturnType<typeof readSecureRegularFile>>;
    try {
      secureRead = await readSecureRegularFile(
        selectedProjectRoot.path,
        path,
        FIXED_LIMITS.workflow_input_file_bytes,
        { expectedProjectIdentity: selectedProjectRoot.identity },
      );
    } catch (error) {
      if (error instanceof ResourceLimitError) return resourceLimitFailure();
      return workflowInputFailure([
        {
          code: 'invalid_path',
          path: `/inputs/${escapePointerSegment(inputId)}`,
          message: 'The Workflow Input must identify an existing readable regular file.',
          file: 'breakdown.yaml',
        },
      ]);
    }
    const { bytes, identity } = secureRead;
    if (bytes.byteLength > FIXED_LIMITS.workflow_input_file_bytes) {
      return resourceLimitFailure();
    }
    aggregateBytes += bytes.byteLength;
    if (aggregateBytes > FIXED_LIMITS.aggregate_workflow_input_bytes_per_run) {
      return resourceLimitFailure();
    }
    resolved[inputId] = { path, sha256: sha256(bytes) };
    identities[inputId] = identity;
  }
  return { ok: true, value: { records: resolved, identities } };
}

async function recheckWorkflowInputs(
  selectedProjectRoot: SelectedProjectRoot,
  resolvedInputs: ResolvedWorkflowInputs,
): Promise<OperationFailure | undefined> {
  const integrityFailure = (inputId: string) =>
    workflowInputFailure([
      {
        code: 'integrity',
        path: `/inputs/${escapePointerSegment(inputId)}`,
        message: 'The Workflow Input changed after it was resolved.',
        file: 'breakdown.yaml',
      },
    ]);

  for (const [inputId, input] of Object.entries(resolvedInputs.records)) {
    let secureRead: Awaited<ReturnType<typeof readSecureRegularFile>>;
    try {
      secureRead = await readSecureRegularFile(
        selectedProjectRoot.path,
        input.path,
        FIXED_LIMITS.workflow_input_file_bytes,
        { expectedProjectIdentity: selectedProjectRoot.identity },
      );
    } catch {
      return integrityFailure(inputId);
    }
    const expectedIdentity = resolvedInputs.identities[inputId];
    if (
      sha256(secureRead.bytes) !== input.sha256 ||
      expectedIdentity === undefined ||
      secureRead.identity.device !== expectedIdentity.device ||
      secureRead.identity.inode !== expectedIdentity.inode ||
      secureRead.identity.birthtime !== expectedIdentity.birthtime
    ) {
      return integrityFailure(inputId);
    }
  }
  return undefined;
}

async function createRun(
  request: CreateRunRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<CreateRunValue>> {
  if (isCancelled(trustedContext.signal)) return cancelledFailure();
  const selectedProjectRoot = selectedProjectRootFromContext(trustedContext);
  const projectRoot = selectedProjectRoot.path;
  let workflowBytes: Buffer;
  try {
    workflowBytes = (
      await withSelectedProjectRoot(trustedContext, (selectedProjectRoot) =>
        readSecureRegularFile(
          selectedProjectRoot.path,
          'breakdown.yaml',
          FIXED_LIMITS.workflow_definition_bytes,
          { expectedProjectIdentity: selectedProjectRoot.identity },
        ),
      )
    ).bytes;
  } catch (error) {
    if (error instanceof UnsupportedFilesystemError) return unsupportedFilesystemFailure();
    if (error instanceof ResourceLimitError) return resourceLimitFailure();
    return ioFailure('Could not securely read breakdown.yaml.');
  }

  const validation = await operate(
    { operation: 'validate_workflow' },
    continueAtSelectedProjectRoot(trustedContext, { definitionBytes: workflowBytes }),
  );
  if (!validation.ok) return validation;
  if (isCancelled(trustedContext.signal)) return cancelledFailure();

  const producerValue: unknown = trustedContext.producer ?? {
    name: '@breakdown-sh/core',
    version: '1.0.0-beta.1',
  };
  if (
    !isRecord(producerValue) ||
    typeof producerValue.name !== 'string' ||
    producerValue.name.trim().length === 0 ||
    typeof producerValue.version !== 'string' ||
    producerValue.version.trim().length === 0
  ) {
    return invalidProducerFailure();
  }
  const producer: ProducerIdentity = {
    name: producerValue.name,
    version: producerValue.version,
  };

  const now = trustedContext.testControls?.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const compactTimestamp = createdAt.replaceAll('-', '').replaceAll(':', '');
  const entropySource = trustedContext.testControls?.randomBytes ?? randomBytes;
  let runId: string | undefined;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = `${compactTimestamp}--${validation.value.workflow.id}--${base32Suffix(
      entropySource(8),
    )}`;
    try {
      await lstat(join(projectRoot, 'outputs', candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        runId = candidate;
        break;
      }
      return ioFailure();
    }
  }
  if (runId === undefined) return runIdCollisionFailure();
  const runPath = `outputs/${runId}`;
  const resolvedInputs = await resolveWorkflowInputs(
    selectedProjectRootFromContext(trustedContext),
    validation.value.workflow,
    request.inputs ?? {},
  );
  if (!resolvedInputs.ok) return resolvedInputs;
  if (isCancelled(trustedContext.signal)) return cancelledFailure();
  try {
    await trustedContext.testControls?.onRunPublicationBoundary?.('after_inputs_read');
    await assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext));
  } catch {
    return ioFailure();
  }
  if (isCancelled(trustedContext.signal)) return cancelledFailure();
  const changedInputFailure = await recheckWorkflowInputs(
    selectedProjectRootFromContext(trustedContext),
    resolvedInputs.value,
  );
  if (changedInputFailure !== undefined) return changedInputFailure;
  if (isCancelled(trustedContext.signal)) return cancelledFailure();
  const value: CreateRunValue = {
    run_id: runId,
    path: runPath,
    created_at: createdAt,
    workflow: {
      id: validation.value.workflow.id,
      snapshot: 'breakdown.yaml',
      sha256: sha256(workflowBytes),
    },
    inputs: resolvedInputs.value.records,
    producer,
  };
  const manifestBytes = runManifestBytes(value);
  if (manifestBytes.byteLength > FIXED_LIMITS.automation_response_bytes) {
    return resourceLimitFailure();
  }

  let lock: RunWriterLock;
  try {
    lock = await acquireRunWriterLock(selectedProjectRootFromContext(trustedContext), runId, {
      now,
      randomBytes: entropySource,
    });
  } catch (error) {
    return error instanceof RunLockedError
      ? runLockedFailure()
      : ioFailure('Could not acquire the Run writer lock.');
  }
  try {
    try {
      await trustedContext.testControls?.onRunPublicationBoundary?.('after_lock_acquired');
      await assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext));
      await assertRunWriterLock(lock);
    } catch {
      return ioFailure();
    }
    if (isCancelled(trustedContext.signal)) return cancelledFailure();

    const outputsPath = join(projectRoot, 'outputs');
    const stagingRoot = join(projectRoot, '.breakdown', 'tmp', 'runs');
    try {
      await ensurePrivateDirectoryPath(projectRoot, ['outputs'], {
        expectedProjectIdentity: selectedProjectRoot.identity,
      });
      await ensurePrivateDirectoryPath(projectRoot, ['.breakdown', 'tmp', 'runs'], {
        expectedProjectIdentity: selectedProjectRoot.identity,
      });
    } catch {
      return ioFailure();
    }

    let stagingPath: string;
    try {
      stagingPath = await mkdtemp(join(stagingRoot, `${runId}.`));
    } catch {
      return ioFailure();
    }
    try {
      throwIfCancelled(trustedContext.signal);
      await trustedContext.testControls?.onRunPublicationBoundary?.('after_staging_created');
      throwIfCancelled(trustedContext.signal);
      await assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext));
      await ensurePrivateDirectoryPath(projectRoot, ['.breakdown', 'tmp', 'runs'], {
        expectedProjectIdentity: selectedProjectRoot.identity,
      });
      const stepsPath = join(stagingPath, 'steps');
      await mkdir(stepsPath, { mode: 0o700 });
      await syncDirectory(stepsPath);
      await writePrivateFile(join(stagingPath, 'breakdown.yaml'), workflowBytes);
      await trustedContext.testControls?.onRunPublicationBoundary?.('after_snapshot_written');
      throwIfCancelled(trustedContext.signal);
      await assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext));
      await writePrivateFile(join(stagingPath, 'run.md'), manifestBytes);
      await syncDirectory(stagingPath);
      await trustedContext.testControls?.onRunPublicationBoundary?.('after_manifest_written');
      throwIfCancelled(trustedContext.signal);
      await assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext));
      await trustedContext.testControls?.onRunPublicationBoundary?.('before_publish');
      throwIfCancelled(trustedContext.signal);
      await assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext));
      const inputFailureBeforePublish = await recheckWorkflowInputs(
        selectedProjectRootFromContext(trustedContext),
        resolvedInputs.value,
      );
      if (inputFailureBeforePublish !== undefined) {
        await rm(stagingPath, { recursive: true, force: true });
        return inputFailureBeforePublish;
      }
      throwIfCancelled(trustedContext.signal);
      await ensurePrivateDirectoryPath(projectRoot, ['outputs'], {
        expectedProjectIdentity: selectedProjectRoot.identity,
      });
      const outputsIdentity = (
        await readSecureDirectory(projectRoot, 'outputs', Number.MAX_SAFE_INTEGER, {
          expectedProjectIdentity: selectedProjectRoot.identity,
        })
      ).identity;
      const destinationPath = join(projectRoot, runPath);
      try {
        await lstat(destinationPath);
        await rm(stagingPath, { recursive: true, force: true });
        return runIdCollisionFailure();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await trustedContext.testControls?.onRunPublicationBoundary?.('after_destination_validated');
      await rename(stagingPath, destinationPath);
      try {
        await assertSecureDirectoryIdentity(outputsPath, outputsIdentity);
      } catch (error) {
        await rename(destinationPath, stagingPath);
        throw error;
      }
      await syncDirectory(outputsPath);
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true });
      if (error instanceof InvocationCancelledError) return cancelledFailure();
      if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return runIdCollisionFailure();
      }
      return ioFailure();
    }
    try {
      await trustedContext.testControls?.onRunPublicationBoundary?.('after_publish');
    } catch {
      // The Run is already committed. A post-commit observation fault cannot roll it back.
    }
    if (isCancelled(trustedContext.signal)) return cancelledFailure();
    return { ok: true, value };
  } finally {
    try {
      await releaseRunWriterLock(lock, () =>
        assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext)),
      );
    } catch {
      // A later inspection exposes an unexpected leftover lock for explicit recovery.
    }
  }
}

function isValidSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function identityFromPacketDescriptor(value: unknown): SecureFileIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const identity = value.identity;
  if (!isRecord(identity)) return undefined;
  if (
    typeof identity.device !== 'string' ||
    typeof identity.inode !== 'string' ||
    typeof identity.birthtime !== 'string'
  ) {
    return undefined;
  }
  return { device: identity.device, inode: identity.inode, birthtime: identity.birthtime };
}

function fileDescriptorFromRecord(value: unknown): { path: string; sha256: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.path !== 'string' || !isPortableProjectRelativePath(value.path)) return null;
  if (!isValidSha256(value.sha256)) return null;
  return { path: value.path, sha256: value.sha256 };
}

function resultDescriptorFromRecord(
  value: unknown,
): { path: string; sha256: string; identity?: SecureFileIdentity } | null {
  const result = fileDescriptorFromRecord(value);
  if (result === null) return null;
  const identity = identityFromPacketDescriptor(value);
  return identity === undefined ? result : { ...result, identity };
}

function normalizePathDiagnostic(path: string, code: string, message: string) {
  return { code, path, message, file: 'work-packet' };
}

async function readInputFromPacket(
  request: ReadInputRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<ReadInputValue>> {
  const packet = request.packet;
  const binding = request.binding;
  if (!isRecord(packet)) {
    return readWorkInputFailure([
      normalizePathDiagnostic('/packet', 'schema', 'A Work Packet is required.'),
    ]);
  }
  if (!isValidIdentifier(binding)) {
    return readWorkInputFailure([
      normalizePathDiagnostic('/binding', 'schema', 'The input binding is invalid.'),
    ]);
  }
  if (!isRecord(packet.submission) || typeof packet.submission.run_id !== 'string') {
    return readWorkInputFailure([
      normalizePathDiagnostic('/submission', 'schema', 'The Work Packet submission is invalid.'),
    ]);
  }
  if (typeof packet.run_id !== 'string' || packet.run_id !== packet.submission.run_id) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        '/submission/run_id',
        'reference_mismatch',
        'submission.run_id must match packet run_id.',
      ),
    ]);
  }
  if (packet.submission.node_id !== packet.node?.id) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        '/submission/node_id',
        'reference_mismatch',
        'submission.node_id must identify the submitted node.',
      ),
    ]);
  }
  if (
    typeof packet.submission.expected_attempt !== 'number' ||
    !Number.isInteger(packet.submission.expected_attempt) ||
    packet.submission.expected_attempt !== packet.expected_attempt ||
    packet.submission.intent !== packet.intent ||
    packet.submission.prepared_at !== packet.prepared_at ||
    typeof packet.submission.context_sha256 !== 'string' ||
    packet.submission.expected_attempt < 1 ||
    packet.submission.context_sha256 !== packet.context_sha256
  ) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        '/submission/expected_attempt',
        'reference_mismatch',
        'The Work Packet submission must be consistent.',
      ),
    ]);
  }

  if (packet.inputs === undefined || !isRecord(packet.inputs)) {
    return readWorkInputFailure([
      normalizePathDiagnostic('/inputs', 'schema', 'The Work Packet inputs map is invalid.'),
    ]);
  }
  if (!Object.hasOwn(packet.inputs, binding)) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}`,
        'reference_mismatch',
        'The binding is not present in the Work Packet.',
      ),
    ]);
  }
  const bindingValue = packet.inputs[binding];
  if (!isRecord(bindingValue)) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}`,
        'schema',
        'A Work Packet input binding must be a mapping.',
      ),
    ]);
  }

  const selectedProjectRoot = selectedProjectRootFromContext(trustedContext);
  const projectRoot = selectedProjectRoot.path;
  const inspected = await operate(
    { operation: 'inspect_run', run_id: packet.run_id },
    continueAtSelectedProjectRoot(trustedContext),
  );
  if (!inspected.ok) return inspected;

  const inspectedNode = inspected.value.nodes.find(
    (inspectedNode) => inspectedNode.node_id === packet.submission.node_id,
  );
  if (
    inspectedNode === undefined ||
    inspectedNode.context_sha256 !== packet.submission.context_sha256 ||
    inspectedNode.next_attempt !== packet.submission.expected_attempt
  ) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        '/submission/node_id',
        'integrity',
        'The Work Packet submission does not match current Run state.',
      ),
    ]);
  }

  const workflowRef = bindingValue.workflow_input;
  const resultRef = bindingValue.result;
  if (
    (workflowRef === undefined && resultRef === undefined) ||
    (workflowRef !== undefined && resultRef !== undefined)
  ) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}`,
        'schema',
        'An input binding must identify exactly one source.',
      ),
    ]);
  }

  if (workflowRef !== undefined) {
    if (!isRecord(workflowRef)) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/workflow_input`,
          'schema',
          'workflow_input must be a mapping.',
        ),
      ]);
    }
    if (
      typeof workflowRef.id !== 'string' ||
      typeof workflowRef.path !== 'string' ||
      !isValidSha256(workflowRef.sha256) ||
      !isPortableProjectRelativePath(workflowRef.path)
    ) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/workflow_input`,
          'schema',
          'workflow_input must include a valid id, path, and sha256.',
        ),
      ]);
    }
    const runInput = inspected.value.inputs[workflowRef.id];
    if (runInput === undefined) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/workflow_input/id`,
          'reference_mismatch',
          'The referenced Workflow Input is absent in the inspected Run.',
        ),
      ]);
    }
    if (runInput.path !== workflowRef.path || runInput.sha256 !== workflowRef.sha256) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/workflow_input`,
          'reference_mismatch',
          'The Work Packet input descriptor does not match the inspected Run.',
        ),
      ]);
    }
    let verified: Awaited<ReturnType<typeof readSecureRegularFile>>;
    try {
      verified = await readSecureRegularFile(
        projectRoot,
        workflowRef.path,
        FIXED_LIMITS.workflow_input_file_bytes,
        { expectedProjectIdentity: selectedProjectRoot.identity },
      );
    } catch {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/workflow_input/path`,
          'integrity',
          'Could not securely read the referenced Workflow Input.',
        ),
      ]);
    }
    if (
      createHash('sha256').update(verified.bytes).digest('hex') !== workflowRef.sha256 ||
      (isRecord(workflowRef.identity) &&
        (verified.identity.device !== workflowRef.identity.device ||
          verified.identity.inode !== workflowRef.identity.inode ||
          verified.identity.birthtime !== workflowRef.identity.birthtime))
    ) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/workflow_input`,
          'integrity',
          'The referenced Workflow Input changed after packet preparation.',
        ),
      ]);
    }
    return {
      ok: true,
      value: {
        kind: 'workflow_input',
        bytes_base64: toBase64(verified.bytes),
      },
    };
  }

  if (!isRecord(resultRef)) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result`,
        'schema',
        'result must be a mapping.',
      ),
    ]);
  }
  if (
    typeof resultRef.node_id !== 'string' ||
    typeof resultRef.attempt !== 'number' ||
    !Number.isInteger(resultRef.attempt) ||
    resultRef.attempt < 1 ||
    resultRef.attempt > FIXED_LIMITS.attempts_per_node
  ) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result`,
        'schema',
        'result.node_id and result.attempt must identify a predecessor result.',
      ),
    ]);
  }
  const predecessorResult = resultRef.markdown
    ? resultDescriptorFromRecord(resultRef.markdown)
    : null;
  if (predecessorResult === null) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result/markdown`,
        'schema',
        'result.markdown must be a file descriptor.',
      ),
    ]);
  }
  const predecessorNode = inspected.value.nodes.find(
    (inspectedNode) => inspectedNode.node_id === resultRef.node_id,
  );
  if (predecessorNode === undefined || predecessorNode.selected_result === undefined) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result/node_id`,
        'missing_reference',
        'The referenced predecessor has no selected result.',
      ),
    ]);
  }
  if (
    predecessorNode.selected_result.attempt !== resultRef.attempt ||
    predecessorNode.selected_result.markdown.path !== predecessorResult.path ||
    predecessorNode.selected_result.markdown.sha256 !== predecessorResult.sha256
  ) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result`,
        'reference_mismatch',
        'The result descriptor does not match the inspected predecessor result.',
      ),
    ]);
  }
  const resultJson =
    resultRef.json === undefined ? null : resultDescriptorFromRecord(resultRef.json);
  const selectedJson = predecessorNode.selected_result.json;
  if (selectedJson === undefined) {
    if (resultJson !== null) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/result/json`,
          'reference_mismatch',
          'result.json must be absent because the inspected predecessor has no JSON result.',
        ),
      ]);
    }
  } else {
    if (resultJson === null) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/result/json`,
          'reference_mismatch',
          'result.json is required because the inspected predecessor has a JSON result.',
        ),
      ]);
    }
    if (selectedJson.path !== resultJson.path || selectedJson.sha256 !== resultJson.sha256) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/result/json`,
          'reference_mismatch',
          'The result.json descriptor does not match the inspected predecessor result.',
        ),
      ]);
    }
  }

  let markdownRead: Awaited<ReturnType<typeof readSecureRegularFile>>;
  try {
    markdownRead = await readSecureResultFile(
      projectRoot,
      predecessorResult.path,
      FIXED_LIMITS.automation_response_bytes,
      { expectedProjectIdentity: selectedProjectRoot.identity },
    );
  } catch {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result/markdown/path`,
        'integrity',
        'Could not securely read the predecessor markdown.',
      ),
    ]);
  }
  if (createHash('sha256').update(markdownRead.bytes).digest('hex') !== predecessorResult.sha256) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result/markdown`,
        'integrity',
        'The predecessor markdown changed after packet preparation.',
      ),
    ]);
  }
  if (
    isRecord(predecessorResult.identity) &&
    (markdownRead.identity.device !== predecessorResult.identity.device ||
      markdownRead.identity.inode !== predecessorResult.identity.inode ||
      markdownRead.identity.birthtime !== predecessorResult.identity.birthtime)
  ) {
    return readWorkInputFailure([
      normalizePathDiagnostic(
        `/inputs/${escapePointerSegment(binding)}/result/markdown`,
        'integrity',
        'The predecessor markdown identity changed after packet preparation.',
      ),
    ]);
  }

  let jsonBytes: string | null = null;
  if (resultJson !== null) {
    let jsonRead: Awaited<ReturnType<typeof readSecureRegularFile>>;
    try {
      jsonRead = await readSecureResultFile(
        projectRoot,
        resultJson.path,
        FIXED_LIMITS.candidate_json_bytes,
        { expectedProjectIdentity: selectedProjectRoot.identity },
      );
    } catch {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/result/json/path`,
          'integrity',
          'Could not securely read the predecessor json.',
        ),
      ]);
    }
    if (createHash('sha256').update(jsonRead.bytes).digest('hex') !== resultJson.sha256) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/result/json`,
          'integrity',
          'The predecessor json changed after packet preparation.',
        ),
      ]);
    }
    if (
      isRecord(resultJson.identity) &&
      (jsonRead.identity.device !== resultJson.identity.device ||
        jsonRead.identity.inode !== resultJson.identity.inode ||
        jsonRead.identity.birthtime !== resultJson.identity.birthtime)
    ) {
      return readWorkInputFailure([
        normalizePathDiagnostic(
          `/inputs/${escapePointerSegment(binding)}/result/json`,
          'integrity',
          'The predecessor json identity changed after packet preparation.',
        ),
      ]);
    }
    jsonBytes = toBase64(jsonRead.bytes);
  }

  return {
    ok: true,
    value: {
      kind: 'result',
      markdown_bytes_base64: toBase64(markdownRead.bytes),
      json_bytes_base64: jsonBytes,
    },
  };
}

export function operate(
  request: ValidateWorkflowRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<ValidateWorkflowValue>>;
export function operate(
  request: CreateRunRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<CreateRunValue>>;
export function operate(
  request: PrepareWorkRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<PrepareWorkValue>>;
export function operate(
  request: ReadInputRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<ReadInputValue>>;
export function operate(
  request: SuccessfulSubmitCandidateRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<SuccessfulSubmitCandidateValue>>;
export function operate(
  request: NonSuccessfulSubmitCandidateRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<NonSuccessfulSubmitCandidateValue>>;
export function operate(
  request: SubmitCandidateRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<SubmitCandidateValue>>;
export function operate(
  request: InspectRunRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<InspectRunValue>>;
export async function operate(
  request:
    | ValidateWorkflowRequest
    | CreateRunRequest
    | InspectRunRequest
    | PrepareWorkRequest
    | ReadInputRequest
    | SubmitCandidateRequest,
  trustedContext: TrustedContext,
): Promise<
  OperationResult<
    | ValidateWorkflowValue
    | CreateRunValue
    | InspectRunValue
    | PrepareWorkValue
    | ReadInputValue
    | SubmitCandidateValue
  >
> {
  if (isCancelled(trustedContext.signal)) return cancelledFailure();
  const requestedOperation = (request as { operation?: unknown }).operation;
  if (
    requestedOperation !== 'create_run' &&
    requestedOperation !== 'inspect_run' &&
    requestedOperation !== 'prepare_work' &&
    requestedOperation !== 'read_work_input' &&
    requestedOperation !== 'submit_candidate' &&
    requestedOperation !== 'validate_workflow'
  ) {
    return {
      ok: false,
      failure: {
        kind: 'unsupported',
        code: 'unsupported_operation',
        message: 'The requested operation is not supported.',
        diagnostics: [],
      },
    };
  }

  if (!trustedContext.projectRoot) return projectRootRequiredFailure();
  let selectedProjectRoot: SelectedProjectRoot;
  const inheritedSelection = (trustedContext as Partial<InternalTrustedContext>)[
    INTERNAL_SELECTED_PROJECT_ROOT
  ];
  if (inheritedSelection !== undefined) {
    selectedProjectRoot = inheritedSelection;
    try {
      await assertSelectedProjectRoot(selectedProjectRoot);
    } catch {
      return ioFailure('The selected project root changed during the operation.');
    }
  } else {
    try {
      const projectRootPath = await realpath(trustedContext.projectRoot);
      const rootFacts = await lstat(projectRootPath, { bigint: true });
      if (!rootFacts.isDirectory()) {
        return ioFailure('The selected project root is not a directory.');
      }
      await assertSupportedFilesystem(projectRootPath);
      selectedProjectRoot = {
        path: projectRootPath,
        identity: secureFileIdentity(rootFacts),
      };
    } catch (error) {
      if (error instanceof UnsupportedFilesystemError) return unsupportedFilesystemFailure();
      return ioFailure('Could not select the project root.');
    }
  }
  trustedContext = {
    ...trustedContext,
    projectRoot: selectedProjectRoot.path,
    [INTERNAL_SELECTED_PROJECT_ROOT]: selectedProjectRoot,
  } as InternalTrustedContext;
  if (inheritedSelection === undefined) {
    try {
      await trustedContext.testControls?.onProjectRootSelected?.();
      await assertSelectedProjectRoot(selectedProjectRoot);
    } catch {
      return ioFailure('The selected project root changed during the operation.');
    }
  }
  if (requestedOperation === 'create_run') {
    return createRun(request as CreateRunRequest, trustedContext);
  }
  if (requestedOperation === 'inspect_run') {
    try {
      const inspected = await withSelectedProjectRoot(trustedContext, () =>
        inspectRun(request as InspectRunRequest, selectedProjectRoot, {
          onStepDirectoryListed: trustedContext.testControls?.onStepDirectoryListed,
          validateSnapshot: (definitionBytes) =>
            operate(
              { operation: 'validate_workflow' },
              continueAtSelectedProjectRoot(trustedContext, { definitionBytes }),
            ),
        }),
      );
      return preferCancellation(trustedContext.signal, inspected);
    } catch {
      return ioFailure('The selected project root changed during inspection.');
    }
  }

  if (requestedOperation === 'prepare_work') {
    const prepareRequest = request as PrepareWorkRequest;
    if (typeof prepareRequest.run_id !== 'string') {
      return {
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'invalid_prepare_work',
          message: 'An exact Run ID is required.',
          diagnostics: [],
        },
      };
    }
    let snapshotBytes: Buffer;
    try {
      const inspected = await operate(
        { operation: 'inspect_run', run_id: prepareRequest.run_id },
        continueAtSelectedProjectRoot(trustedContext),
      );
      if (!inspected.ok) return inspected;
      snapshotBytes = Buffer.from(
        (
          await withSelectedProjectRoot(trustedContext, (selectedProjectRoot) =>
            readSecureRegularFile(
              selectedProjectRoot.path,
              `${inspected.value.path}/breakdown.yaml`,
              FIXED_LIMITS.workflow_definition_bytes,
              { expectedProjectIdentity: selectedProjectRoot.identity },
            ),
          )
        ).bytes,
      );
      if (
        createHash('sha256').update(snapshotBytes).digest('hex') !== inspected.value.workflow.sha256
      ) {
        return {
          ok: false,
          failure: {
            kind: 'invalid',
            code: 'invalid_run',
            message: 'The Run changed while Work Packet preparation was in progress.',
            diagnostics: [],
          },
        };
      }
      const snapshot = await operate(
        { operation: 'validate_workflow' },
        continueAtSelectedProjectRoot(trustedContext, { definitionBytes: snapshotBytes }),
      );
      if (!snapshot.ok) return snapshot;
      return preferCancellation(
        trustedContext.signal,
        await prepareWork(
          prepareRequest,
          (trustedContext.testControls?.now ?? (() => new Date()))().toISOString(),
          {
            inspected: inspected.value,
            workflow: snapshot.value.workflow,
            projectRoot: selectedProjectRoot,
          },
        ),
      );
    } catch {
      return ioFailure('Could not read the Workflow Snapshot.');
    }
  }

  if (requestedOperation === 'read_work_input') {
    return preferCancellation(
      trustedContext.signal,
      await readInputFromPacket(request as ReadInputRequest, trustedContext),
    );
  }

  if (requestedOperation === 'submit_candidate') {
    const submitted = await submitCandidate(
      request as SubmitCandidateRequest,
      selectedProjectRoot,
      {
        assertProjectRoot: () =>
          assertSelectedProjectRoot(selectedProjectRootFromContext(trustedContext)),
        inspect: (runId) =>
          operate(
            { operation: 'inspect_run', run_id: runId },
            continueAtSelectedProjectRoot(trustedContext),
          ),
        loadWorkflow: async (inspected) => {
          let snapshotBytes: Buffer;
          try {
            snapshotBytes = Buffer.from(
              (
                await withSelectedProjectRoot(trustedContext, (selectedProjectRoot) =>
                  readSecureRegularFile(
                    selectedProjectRoot.path,
                    `${inspected.path}/breakdown.yaml`,
                    FIXED_LIMITS.workflow_definition_bytes,
                    { expectedProjectIdentity: selectedProjectRoot.identity },
                  ),
                )
              ).bytes,
            );
          } catch (error) {
            if (error instanceof ResourceLimitError) return resourceLimitFailure();
            return ioFailure('Could not securely read the Workflow Snapshot.');
          }
          if (sha256(snapshotBytes) !== inspected.workflow.sha256) {
            return {
              ok: false,
              failure: {
                kind: 'invalid',
                code: 'invalid_run',
                message: 'The Run changed while submission was in progress.',
                diagnostics: [],
              },
            };
          }
          const snapshot = await operate(
            { operation: 'validate_workflow' },
            continueAtSelectedProjectRoot(trustedContext, { definitionBytes: snapshotBytes }),
          );
          return snapshot.ok ? { ok: true, value: snapshot.value.workflow } : snapshot;
        },
        now: trustedContext.testControls?.now ?? (() => new Date()),
        randomBytes: trustedContext.testControls?.randomBytes ?? randomBytes,
        onPublicationBoundary: trustedContext.testControls?.onStepPublicationBoundary,
        onLockRecoveryBoundary: trustedContext.testControls?.onLockRecoveryBoundary,
        signal: trustedContext.signal,
      },
    );
    return preferCancellation(trustedContext.signal, submitted);
  }

  let bytes: Buffer;
  const internalContext = trustedContext as Partial<InternalTrustedContext>;
  const definitionBytes =
    internalContext[INTERNAL_DEFINITION_BYTES] === true
      ? internalContext.definitionBytes
      : undefined;
  if (definitionBytes !== undefined) {
    bytes = Buffer.from(definitionBytes);
  } else {
    try {
      bytes = (
        await withSelectedProjectRoot(trustedContext, (projectRoot) =>
          readSecureRegularFile(
            projectRoot.path,
            'breakdown.yaml',
            FIXED_LIMITS.workflow_definition_bytes,
            { expectedProjectIdentity: projectRoot.identity },
          ),
        )
      ).bytes;
    } catch (error) {
      if (error instanceof UnsupportedFilesystemError) return unsupportedFilesystemFailure();
      if (error instanceof ResourceLimitError) return resourceLimitFailure();
      return {
        ok: false,
        failure: {
          kind: 'io',
          code: 'io_error',
          message: 'Could not read breakdown.yaml.',
          diagnostics: [],
        },
      };
    }
  }
  if (isCancelled(trustedContext.signal)) return cancelledFailure();
  if (bytes.byteLength > FIXED_LIMITS.workflow_definition_bytes) {
    return resourceLimitFailure();
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return validationFailure([
      {
        code: 'parse',
        path: '',
        message: 'The Workflow Definition must contain valid UTF-8.',
        file: 'breakdown.yaml',
      },
    ]);
  }

  const explicitVersion = source.match(/^%YAML[ \t]+([0-9]+\.[0-9]+)[ \t]*$/m);
  if (explicitVersion?.[1] !== undefined && explicitVersion[1] !== '1.2') {
    return unsupportedYamlVersionFailure();
  }

  const document = parseDocument(source, {
    intAsBigInt: true,
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });

  if (document.directives?.yaml.explicit && document.directives.yaml.version !== '1.2') {
    return unsupportedYamlVersionFailure();
  }

  if (document.errors.some((error) => error.code === 'RESOURCE_EXHAUSTION')) {
    return resourceLimitFailure();
  }
  if (document.errors.length > 0) {
    return validationFailure([
      {
        code: 'parse',
        path: '',
        message: 'The Workflow Definition is not valid YAML.',
        file: 'breakdown.yaml',
      },
    ]);
  }

  const allowedTags = new Set([
    'tag:yaml.org,2002:null',
    'tag:yaml.org,2002:bool',
    'tag:yaml.org,2002:int',
    'tag:yaml.org,2002:float',
    'tag:yaml.org,2002:str',
    'tag:yaml.org,2002:seq',
    'tag:yaml.org,2002:map',
  ]);
  const forbiddenFeatures = new Set<string>();
  if (/^%TAG[ \t]/m.test(source)) {
    forbiddenFeatures.add('custom tag directives');
  }

  visit(document, {
    Alias() {
      forbiddenFeatures.add('aliases');
    },
    Node(_key, node) {
      if ('anchor' in node && node.anchor) {
        forbiddenFeatures.add('anchors');
      }
      if (node.tag && !allowedTags.has(node.tag)) {
        forbiddenFeatures.add('custom tags');
      }
      if (isScalar(node) && (typeof node.value === 'number' || typeof node.value === 'bigint')) {
        const exactNumber =
          typeof node.source === 'string'
            ? preserveYamlJsonNumber(node.source, node.value)
            : undefined;
        if (exactNumber === undefined) {
          forbiddenFeatures.add('non-finite numbers');
        } else {
          node.value = exactNumber;
        }
      }
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') {
        forbiddenFeatures.add('merge keys');
      }
    },
  });

  if (forbiddenFeatures.size > 0) {
    return validationFailure([
      {
        code: 'schema',
        path: '',
        message: `The YAML profile forbids ${[...forbiddenFeatures].sort().join(', ')}.`,
        file: 'breakdown.yaml',
      },
    ]);
  }

  if (document.warnings.length > 0) {
    return validationFailure([
      {
        code: 'parse',
        path: '',
        message: 'The Workflow Definition contains an invalid YAML directive.',
        file: 'breakdown.yaml',
      },
    ]);
  }

  if (yamlCollectionDepth(document.contents) > FIXED_LIMITS.yaml_json_nesting_depth) {
    return resourceLimitFailure();
  }

  if (!isMap(document.contents)) {
    return validationFailure([
      {
        code: 'schema',
        path: '',
        message: 'The Workflow Definition root must be a mapping.',
        file: 'breakdown.yaml',
      },
    ]);
  }

  const yamlMappingKeyDiagnostics = collectNonStringMappingKeyDiagnostics(document.contents);
  const workflow: unknown = normalizeJsonIntegers(document.toJS({ maxAliasCount: 0 }));
  if (exceedsDefinitionStructuralLimits(workflow)) {
    return resourceLimitFailure();
  }
  const diagnostics = validateWorkflowShape(workflow, yamlMappingKeyDiagnostics);
  if (diagnostics.length > FIXED_LIMITS.diagnostics_returned) {
    return resourceLimitFailure(diagnostics.slice(0, FIXED_LIMITS.diagnostics_returned));
  }
  if (diagnostics.length > 0) {
    const usesUnsupportedVersion = diagnostics.some(
      (diagnostic) => diagnostic.code === 'unsupported_version',
    );
    return validationFailure(
      diagnostics,
      usesUnsupportedVersion ? 'unsupported' : 'invalid',
      usesUnsupportedVersion ? 'unsupported_version' : 'invalid_workflow',
    );
  }

  return preferCancellation(trustedContext.signal, {
    ok: true,
    value: {
      definitionPath: 'breakdown.yaml',
      workflow: normalizeWorkflow(workflow as WorkflowDefinition),
    },
  });
}
