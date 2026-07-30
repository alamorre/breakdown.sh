import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

import { isMap, isScalar, parseDocument, visit } from 'yaml';

import { canonicalizeJson } from './canonical-json.js';
import { isRawJsonNumber } from './exact-json-number.js';
import { FIXED_LIMITS } from './fixed-limits.js';
import { isRunLockRecoveryAlias } from './run-lock-paths.js';
import {
  assertSupportedFilesystem,
  readSecureDirectory,
  readSecureRegularFile,
  readSecureResultFile,
  ResourceLimitError,
  SecureDirectoryChangedError,
  type SecureDirectorySnapshot,
  type SelectedProjectRoot,
  UnsupportedFilesystemError,
} from './secure-store.js';
import { isUnicodeScalarString } from './unicode.js';
import type {
  Diagnostic,
  OperationFailure,
  OperationResult,
  ResolvedWorkflowInput,
  ValidateWorkflowValue,
  WorkflowDefinition,
} from './index.js';

const RUN_ID_PATTERN = /^(\d{8}T\d{6}\.\d{3}Z)--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-z2-7]{12}$/;
const RFC3339_MILLISECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REVERSE_DNS_PATTERN =
  /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const STEP_FILENAME_PATTERN =
  /^(\d{8}T\d{6}\.\d{3}Z)--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--a([1-9]\d*)\.md$/;
const PROBLEM_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_STABLE_INSPECTION_PASSES = 4;
const MAX_CONCURRENT_STEP_ARTIFACT_READS = 16;

export interface InspectRunRequest {
  operation: 'inspect_run';
  run_id: string;
}

export interface ResultFileDescriptor {
  path: string;
  sha256: string;
}

export interface SelectedResultDescriptor {
  node_id: string;
  attempt: number;
  markdown: ResultFileDescriptor;
  json?: ResultFileDescriptor;
}

export interface InspectedNode {
  node_id: string;
  state: 'complete' | 'runnable' | 'blocked';
  stale: boolean;
  next_attempt: number;
  context_sha256?: string;
  selected_result?: SelectedResultDescriptor;
}

export interface InspectedAttempt {
  file: string;
  node_id: string;
  attempt: number;
  status: 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  started_at: string;
  settled_at: string;
  context_sha256: string;
  selected: boolean;
}

export interface ObservedRunLock {
  lock_id: string | null;
  recovery: 'Confirm the prior writer stopped, then recover with this exact observed lock ID.';
}

export interface InspectRunValue {
  run_id: string;
  path: string;
  status: 'incomplete' | 'complete';
  resumable: true;
  workflow: {
    id: string;
    snapshot: 'breakdown.yaml';
    sha256: string;
  };
  inputs: Record<string, ResolvedWorkflowInput>;
  nodes: InspectedNode[];
  attempts: InspectedAttempt[];
  terminal_results: SelectedResultDescriptor[];
  lock: ObservedRunLock | null;
}

interface ParsedMarkdownRecord {
  value?: Record<string, unknown>;
  body: string;
}

interface RunManifest {
  schema_version: 'breakdown.run.v1';
  run_id: string;
  created_at: string;
  workflow: {
    id: string;
    snapshot: 'breakdown.yaml';
    sha256: string;
  };
  inputs: Record<string, ResolvedWorkflowInput>;
  producer: {
    name: string;
    version: string;
  };
}

type SettledStatus = 'succeeded' | 'failed' | 'blocked' | 'cancelled';

interface ResultReference {
  node_id: string;
  attempt: number;
  markdown: ResultFileDescriptor;
  json?: ResultFileDescriptor;
}

type StepInputReference =
  | { workflow_input: string }
  | {
      result: ResultReference;
    };

interface ParsedStepArtifact {
  file: string;
  filename: string;
  stem: string;
  markdownBytes: Uint8Array;
  node_id: string;
  attempt: number;
  status: SettledStatus;
  started_at: string;
  settled_at: string;
  context_sha256: string;
  inputs: Record<string, StepInputReference>;
  json?: ResultFileDescriptor;
}

interface InspectionDependencies {
  onStepDirectoryListed?: () => void | Promise<void>;
  validateSnapshot(
    bytes: Uint8Array,
    projectRoot: string,
  ): Promise<OperationResult<ValidateWorkflowValue>>;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isRawJsonNumber(value)
  );
}

function escapePointerSegment(segment: string) {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function diagnostic(code: string, file: string, path: string, message: string): Diagnostic {
  return { code, file, path, message };
}

function compareRunDiagnostics(left: Diagnostic, right: Diagnostic) {
  const leftFile = left.file ?? '';
  const rightFile = right.file ?? '';
  if (leftFile < rightFile) return -1;
  if (leftFile > rightFile) return 1;
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  if (left.code < right.code) return -1;
  if (left.code > right.code) return 1;
  return 0;
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function invalidRunFailure(diagnostics: Diagnostic[]): OperationFailure {
  const ordered = diagnostics.sort(compareRunDiagnostics);
  const unsupported = ordered.some((item) => item.code === 'unsupported_version');
  return {
    ok: false,
    failure: {
      kind: unsupported ? 'unsupported' : 'invalid',
      code: unsupported ? 'unsupported_version' : 'invalid_run',
      message: unsupported
        ? 'The Run uses an unsupported contract version.'
        : 'The Run is invalid.',
      diagnostics: ordered,
    },
  };
}

function runNotFoundFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'invalid',
      code: 'run_not_found',
      message: 'The exact Run was not found.',
      diagnostics: [],
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

function resourceLimitFailure(diagnostics: Diagnostic[] = []): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'resource_limit',
      code: 'limit_exceeded',
      message: 'A fixed resource limit was exceeded.',
      diagnostics: diagnostics.sort(compareRunDiagnostics),
    },
  };
}

function normalizeSafeIntegers(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value;
  }
  if (Array.isArray(value)) return value.map(normalizeSafeIntegers);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeSafeIntegers(item)]),
    );
  }
  return value;
}

function collectionDepth(value: unknown, depth = 0): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (maximum, item) => Math.max(maximum, collectionDepth(item, depth + 1)),
      depth + 1,
    );
  }
  if (isRecord(value)) {
    return Object.values(value).reduce<number>(
      (maximum, item) => Math.max(maximum, collectionDepth(item, depth + 1)),
      depth + 1,
    );
  }
  return depth;
}

function parseMarkdownRecord(
  bytes: Uint8Array,
  file: string,
  diagnostics: Diagnostic[],
): ParsedMarkdownRecord {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    diagnostics.push(diagnostic('parse', file, '', 'Markdown records must contain valid UTF-8.'));
    return { body: '' };
  }
  if (source.startsWith('\uFEFF') || source.includes('\r') || !source.startsWith('---\n')) {
    diagnostics.push(
      diagnostic(
        'parse',
        file,
        '',
        'Markdown records must start with YAML frontmatter and use UTF-8 without BOM and LF.',
      ),
    );
    return { body: '' };
  }
  const closingDelimiter = source.indexOf('\n---\n', 4);
  if (closingDelimiter < 0) {
    diagnostics.push(
      diagnostic('parse', file, '', 'Markdown frontmatter must have a closing delimiter.'),
    );
    return { body: '' };
  }
  const frontmatter = source.slice(4, closingDelimiter);
  const body = source.slice(closingDelimiter + 5);
  const document = parseDocument(frontmatter, {
    intAsBigInt: true,
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });
  const forbidden = new Set<string>();
  const allowedTags = new Set([
    'tag:yaml.org,2002:null',
    'tag:yaml.org,2002:bool',
    'tag:yaml.org,2002:int',
    'tag:yaml.org,2002:float',
    'tag:yaml.org,2002:str',
    'tag:yaml.org,2002:seq',
    'tag:yaml.org,2002:map',
  ]);
  visit(document, {
    Alias() {
      forbidden.add('aliases');
    },
    Node(_key, node) {
      if ('anchor' in node && node.anchor) forbidden.add('anchors');
      if (node.tag && !allowedTags.has(node.tag)) {
        forbidden.add('custom tags');
      }
      if (isScalar(node) && typeof node.value === 'number' && !Number.isFinite(node.value)) {
        forbidden.add('non-finite numbers');
      }
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') forbidden.add('merge keys');
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        forbidden.add('non-string mapping keys');
      }
    },
  });
  if (
    document.errors.length > 0 ||
    document.warnings.length > 0 ||
    forbidden.size > 0 ||
    !isMap(document.contents)
  ) {
    diagnostics.push(
      diagnostic('parse', file, '', 'The record frontmatter is not valid restricted YAML.'),
    );
    return { body };
  }
  const value = normalizeSafeIntegers(document.toJS({ maxAliasCount: 0 }));
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic('schema', file, '', 'The record frontmatter root must be a mapping.'),
    );
    return { body };
  }
  if (collectionDepth(value) > FIXED_LIMITS.yaml_json_nesting_depth) {
    throw new ResourceLimitError('Record frontmatter exceeds the nesting limit.');
  }
  return { value, body };
}

function parseStrictJson(bytes: Uint8Array, file: string, diagnostics: Diagnostic[]) {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    diagnostics.push(diagnostic('parse', file, '', 'JSON Results must contain valid UTF-8.'));
    return undefined;
  }
  if (source.startsWith('\uFEFF')) {
    diagnostics.push(diagnostic('parse', file, '', 'JSON Results must not contain a BOM.'));
    return undefined;
  }
  const document = parseDocument(source, {
    schema: 'json',
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    diagnostics.push(diagnostic('parse', file, '', 'The Result sidecar is not strict JSON.'));
    return undefined;
  }
  if (document.errors.length > 0) {
    diagnostics.push(diagnostic('parse', file, '', 'The Result sidecar has duplicate names.'));
    return undefined;
  }
  if (collectionDepth(value) > FIXED_LIMITS.yaml_json_nesting_depth) {
    throw new ResourceLimitError('Result JSON exceeds the nesting limit.');
  }
  return value;
}

function jsonValueType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function contractNumber(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      const parsed: unknown = JSON.parse(serialized);
      if (typeof parsed === 'number') return parsed;
    }
  } catch {
    // Invalid contract numbers are rejected while validating the Workflow Snapshot.
  }
  return undefined;
}

function jsonValuesEqual(left: unknown, right: unknown) {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

function dataContractDiagnostic(
  diagnostics: Diagnostic[],
  file: string,
  path: string,
  message: string,
) {
  diagnostics.push(diagnostic('data_contract', file, path, message));
}

export function validateDataContractInstance(
  instance: unknown,
  schema: unknown,
  file: string,
  path: string,
  diagnostics: Diagnostic[],
) {
  if (schema === true) return;
  if (schema === false) {
    dataContractDiagnostic(
      diagnostics,
      file,
      path,
      'The Result is forbidden by its Data Contract.',
    );
    return;
  }
  if (!isRecord(schema)) return;

  const declaredTypes =
    typeof schema.type === 'string'
      ? [schema.type]
      : Array.isArray(schema.type)
        ? schema.type
        : undefined;
  if (declaredTypes !== undefined) {
    const actualType = jsonValueType(instance);
    const matches = declaredTypes.some(
      (type) => type === actualType || (type === 'number' && actualType === 'integer'),
    );
    if (!matches) {
      dataContractDiagnostic(diagnostics, file, path, `Expected ${declaredTypes.join(' or ')}.`);
      return;
    }
  }

  if (schema.const !== undefined && !jsonValuesEqual(instance, schema.const)) {
    dataContractDiagnostic(diagnostics, file, path, 'The Result does not equal const.');
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonValuesEqual(instance, candidate))
  ) {
    dataContractDiagnostic(diagnostics, file, path, 'The Result is not in enum.');
  }

  if (typeof instance === 'string') {
    const length = [...instance].length;
    const minimum = contractNumber(schema.minLength);
    const maximum = contractNumber(schema.maxLength);
    if (minimum !== undefined && length < minimum) {
      dataContractDiagnostic(diagnostics, file, path, 'The string is shorter than minLength.');
    }
    if (maximum !== undefined && length > maximum) {
      dataContractDiagnostic(diagnostics, file, path, 'The string is longer than maxLength.');
    }
  }

  if (typeof instance === 'number') {
    for (const [keyword, predicate] of [
      ['minimum', (value: number, bound: number) => value >= bound],
      ['maximum', (value: number, bound: number) => value <= bound],
      ['exclusiveMinimum', (value: number, bound: number) => value > bound],
      ['exclusiveMaximum', (value: number, bound: number) => value < bound],
    ] as const) {
      const bound = contractNumber(schema[keyword]);
      if (bound !== undefined && !predicate(instance, bound)) {
        dataContractDiagnostic(diagnostics, file, path, `The number violates ${keyword}.`);
      }
    }
  }

  if (Array.isArray(instance)) {
    const minimum = contractNumber(schema.minItems);
    const maximum = contractNumber(schema.maxItems);
    if (minimum !== undefined && instance.length < minimum) {
      dataContractDiagnostic(diagnostics, file, path, 'The array has fewer than minItems.');
    }
    if (maximum !== undefined && instance.length > maximum) {
      dataContractDiagnostic(diagnostics, file, path, 'The array has more than maxItems.');
    }
    if (schema.items !== undefined) {
      instance.forEach((item, index) =>
        validateDataContractInstance(item, schema.items, file, `${path}/${index}`, diagnostics),
      );
    }
  }

  if (isRecord(instance)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const required of schema.required) {
        if (typeof required === 'string' && !Object.hasOwn(instance, required)) {
          dataContractDiagnostic(
            diagnostics,
            file,
            `${path}/${escapePointerSegment(required)}`,
            'A required property is missing.',
          );
        }
      }
    }
    for (const [property, propertyValue] of Object.entries(instance)) {
      const propertyPath = `${path}/${escapePointerSegment(property)}`;
      if (Object.hasOwn(properties, property)) {
        validateDataContractInstance(
          propertyValue,
          properties[property],
          file,
          propertyPath,
          diagnostics,
        );
      } else if (schema.additionalProperties === false) {
        dataContractDiagnostic(
          diagnostics,
          file,
          propertyPath,
          'An additional property is not allowed.',
        );
      } else if (isRecord(schema.additionalProperties)) {
        validateDataContractInstance(
          propertyValue,
          schema.additionalProperties,
          file,
          propertyPath,
          diagnostics,
        );
      }
    }
  }
}

function checkFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  file: string,
  path: string,
  diagnostics: Diagnostic[],
) {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      diagnostics.push(
        diagnostic(
          'schema',
          file,
          `${path}/${escapePointerSegment(field)}`,
          `Unknown field: ${field}.`,
        ),
      );
    }
  }
  for (const field of required) {
    if (value[field] === undefined) {
      diagnostics.push(diagnostic('schema', file, `${path}/${field}`, `${field} is required.`));
    }
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && IDENTIFIER_PATTERN.test(value);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !RFC3339_MILLISECONDS_PATTERN.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isPortableProjectRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !isUnicodeScalarString(value) ||
    value.length === 0 ||
    Buffer.byteLength(value) > FIXED_LIMITS.project_relative_path_bytes ||
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

function validateExtensions(value: unknown, file: string, path: string, diagnostics: Diagnostic[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('schema', file, path, 'extensions must be a mapping.'));
    return;
  }
  for (const [namespace, extension] of Object.entries(value)) {
    const extensionPath = `${path}/${escapePointerSegment(namespace)}`;
    if (!REVERSE_DNS_PATTERN.test(namespace) || !isRecord(extension)) {
      diagnostics.push(
        diagnostic(
          'schema',
          file,
          extensionPath,
          'Extensions require reverse-DNS keys and object values.',
        ),
      );
    }
  }
}

function validateRunManifest(
  value: Record<string, unknown>,
  file: string,
  requestedRunId: string,
  diagnostics: Diagnostic[],
): RunManifest | undefined {
  checkFields(
    value,
    ['schema_version', 'run_id', 'created_at', 'workflow', 'inputs', 'producer', 'extensions'],
    ['schema_version', 'run_id', 'created_at', 'workflow', 'inputs', 'producer'],
    file,
    '',
    diagnostics,
  );
  if (value.schema_version !== 'breakdown.run.v1') {
    diagnostics.push(
      diagnostic(
        typeof value.schema_version === 'string' ? 'unsupported_version' : 'schema',
        file,
        '/schema_version',
        'schema_version must be breakdown.run.v1.',
      ),
    );
  }
  if (value.run_id !== requestedRunId) {
    diagnostics.push(
      diagnostic('layout', file, '/run_id', 'Run Manifest identity must match its directory.'),
    );
  }
  const runIdMatch = typeof value.run_id === 'string' ? RUN_ID_PATTERN.exec(value.run_id) : null;
  if (runIdMatch === null) {
    diagnostics.push(diagnostic('schema', file, '/run_id', 'run_id has an invalid shape.'));
  }
  if (!validTimestamp(value.created_at)) {
    diagnostics.push(
      diagnostic('schema', file, '/created_at', 'created_at must be exact UTC milliseconds.'),
    );
  } else if (runIdMatch !== null) {
    const compactCreatedAt = value.created_at.replaceAll('-', '').replaceAll(':', '');
    if (compactCreatedAt !== runIdMatch[1]) {
      diagnostics.push(
        diagnostic(
          'layout',
          file,
          '/created_at',
          'created_at must equal the timestamp encoded in run_id.',
        ),
      );
    }
  }

  const workflow = value.workflow;
  if (!isRecord(workflow)) {
    diagnostics.push(diagnostic('schema', file, '/workflow', 'workflow must be a mapping.'));
  } else {
    checkFields(
      workflow,
      ['id', 'snapshot', 'sha256'],
      ['id', 'snapshot', 'sha256'],
      file,
      '/workflow',
      diagnostics,
    );
    if (!validIdentifier(workflow.id)) {
      diagnostics.push(diagnostic('schema', file, '/workflow/id', 'workflow.id is invalid.'));
    }
    if (workflow.snapshot !== 'breakdown.yaml') {
      diagnostics.push(
        diagnostic(
          'invalid_path',
          file,
          '/workflow/snapshot',
          'The Workflow Snapshot must be breakdown.yaml.',
        ),
      );
    }
    if (!validSha256(workflow.sha256)) {
      diagnostics.push(diagnostic('schema', file, '/workflow/sha256', 'sha256 is invalid.'));
    }
    if (runIdMatch !== null && workflow.id !== runIdMatch[2]) {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          file,
          '/workflow/id',
          'Workflow identity must match run_id.',
        ),
      );
    }
  }

  const inputs = value.inputs;
  if (!isRecord(inputs)) {
    diagnostics.push(diagnostic('schema', file, '/inputs', 'inputs must be a mapping.'));
  } else {
    for (const [inputId, input] of Object.entries(inputs)) {
      const inputPath = `/inputs/${escapePointerSegment(inputId)}`;
      if (!validIdentifier(inputId)) {
        diagnostics.push(diagnostic('schema', file, inputPath, 'Workflow Input ID is invalid.'));
      }
      if (!isRecord(input)) {
        diagnostics.push(
          diagnostic('schema', file, inputPath, 'Workflow Input record must be a mapping.'),
        );
        continue;
      }
      checkFields(input, ['path', 'sha256'], ['path', 'sha256'], file, inputPath, diagnostics);
      if (!isPortableProjectRelativePath(input.path)) {
        diagnostics.push(
          diagnostic(
            'invalid_path',
            file,
            `${inputPath}/path`,
            'Workflow Input path is not portable.',
          ),
        );
      }
      if (!validSha256(input.sha256)) {
        diagnostics.push(diagnostic('schema', file, `${inputPath}/sha256`, 'sha256 is invalid.'));
      }
    }
  }

  const producer = value.producer;
  if (!isRecord(producer)) {
    diagnostics.push(diagnostic('schema', file, '/producer', 'producer must be a mapping.'));
  } else {
    checkFields(producer, ['name', 'version'], ['name', 'version'], file, '/producer', diagnostics);
    for (const field of ['name', 'version'] as const) {
      if (typeof producer[field] !== 'string' || producer[field].length === 0) {
        diagnostics.push(
          diagnostic('schema', file, `/producer/${field}`, `${field} must be nonempty.`),
        );
      }
    }
  }
  validateExtensions(value.extensions, file, '/extensions', diagnostics);

  if (
    value.schema_version !== 'breakdown.run.v1' ||
    typeof value.run_id !== 'string' ||
    !validTimestamp(value.created_at) ||
    !isRecord(workflow) ||
    !validIdentifier(workflow.id) ||
    workflow.snapshot !== 'breakdown.yaml' ||
    !validSha256(workflow.sha256) ||
    !isRecord(inputs) ||
    !isRecord(producer) ||
    typeof producer.name !== 'string' ||
    typeof producer.version !== 'string'
  ) {
    return undefined;
  }

  const typedInputs: Record<string, ResolvedWorkflowInput> = {};
  for (const [inputId, input] of Object.entries(inputs)) {
    if (
      validIdentifier(inputId) &&
      isRecord(input) &&
      isPortableProjectRelativePath(input.path) &&
      validSha256(input.sha256)
    ) {
      typedInputs[inputId] = { path: input.path, sha256: input.sha256 };
    }
  }
  return {
    schema_version: value.schema_version,
    run_id: value.run_id,
    created_at: value.created_at,
    workflow: {
      id: workflow.id,
      snapshot: workflow.snapshot,
      sha256: workflow.sha256,
    },
    inputs: typedInputs,
    producer: {
      name: producer.name,
      version: producer.version,
    },
  };
}

function validateResultFileDescriptor(
  value: unknown,
  file: string,
  path: string,
  diagnostics: Diagnostic[],
): ResultFileDescriptor | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('schema', file, path, 'Result file descriptor must be a mapping.'));
    return undefined;
  }
  checkFields(value, ['path', 'sha256'], ['path', 'sha256'], file, path, diagnostics);
  if (!isPortableProjectRelativePath(value.path)) {
    diagnostics.push(
      diagnostic('invalid_path', file, `${path}/path`, 'Result path is not portable.'),
    );
  }
  if (!validSha256(value.sha256)) {
    diagnostics.push(diagnostic('schema', file, `${path}/sha256`, 'sha256 is invalid.'));
  }
  return isPortableProjectRelativePath(value.path) && validSha256(value.sha256)
    ? { path: value.path, sha256: value.sha256 }
    : undefined;
}

function validateStepInput(
  value: unknown,
  file: string,
  path: string,
  diagnostics: Diagnostic[],
): StepInputReference | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('schema', file, path, 'StepArtifact Input must be a mapping.'));
    return undefined;
  }
  const fields = Object.keys(value);
  if (fields.length !== 1 || (fields[0] !== 'workflow_input' && fields[0] !== 'result')) {
    diagnostics.push(
      diagnostic('schema', file, path, 'An Input must contain exactly workflow_input or result.'),
    );
    return undefined;
  }
  if (fields[0] === 'workflow_input') {
    if (!validIdentifier(value.workflow_input)) {
      diagnostics.push(
        diagnostic('schema', file, `${path}/workflow_input`, 'Workflow Input identity is invalid.'),
      );
      return undefined;
    }
    return { workflow_input: value.workflow_input };
  }

  const result = value.result;
  if (!isRecord(result)) {
    diagnostics.push(diagnostic('schema', file, `${path}/result`, 'result must be a mapping.'));
    return undefined;
  }
  checkFields(
    result,
    ['node_id', 'attempt', 'markdown', 'json'],
    ['node_id', 'attempt', 'markdown'],
    file,
    `${path}/result`,
    diagnostics,
  );
  if (!validIdentifier(result.node_id)) {
    diagnostics.push(diagnostic('schema', file, `${path}/result/node_id`, 'node_id is invalid.'));
  }
  if (
    typeof result.attempt !== 'number' ||
    !Number.isInteger(result.attempt) ||
    result.attempt < 1 ||
    result.attempt > FIXED_LIMITS.attempts_per_node
  ) {
    diagnostics.push(diagnostic('schema', file, `${path}/result/attempt`, 'attempt is invalid.'));
  }
  const markdown = validateResultFileDescriptor(
    result.markdown,
    file,
    `${path}/result/markdown`,
    diagnostics,
  );
  const json =
    result.json === undefined
      ? undefined
      : validateResultFileDescriptor(result.json, file, `${path}/result/json`, diagnostics);
  if (
    !validIdentifier(result.node_id) ||
    typeof result.attempt !== 'number' ||
    !Number.isInteger(result.attempt) ||
    result.attempt < 1 ||
    result.attempt > FIXED_LIMITS.attempts_per_node ||
    markdown === undefined ||
    (result.json !== undefined && json === undefined)
  ) {
    return undefined;
  }
  return {
    result: {
      node_id: result.node_id,
      attempt: result.attempt,
      markdown,
      ...(json === undefined ? {} : { json }),
    },
  };
}

function validateStepArtifact(
  record: Record<string, unknown>,
  markdownBytes: Uint8Array,
  file: string,
  filename: string,
  runId: string,
  workflow: WorkflowDefinition | undefined,
  diagnostics: Diagnostic[],
): ParsedStepArtifact | undefined {
  checkFields(
    record,
    [
      'schema_version',
      'run_id',
      'node_id',
      'attempt',
      'status',
      'started_at',
      'settled_at',
      'context_sha256',
      'inputs',
      'executor',
      'problem',
      'extensions',
    ],
    [
      'schema_version',
      'run_id',
      'node_id',
      'attempt',
      'status',
      'started_at',
      'settled_at',
      'context_sha256',
      'inputs',
      'executor',
    ],
    file,
    '',
    diagnostics,
  );
  if (record.schema_version !== 'breakdown.step-artifact.v1') {
    diagnostics.push(
      diagnostic(
        typeof record.schema_version === 'string' ? 'unsupported_version' : 'schema',
        file,
        '/schema_version',
        'schema_version must be breakdown.step-artifact.v1.',
      ),
    );
  }
  if (record.run_id !== runId) {
    diagnostics.push(
      diagnostic('reference_mismatch', file, '/run_id', 'StepArtifact belongs to another Run.'),
    );
  }
  if (!validIdentifier(record.node_id)) {
    diagnostics.push(diagnostic('schema', file, '/node_id', 'node_id is invalid.'));
  } else if (workflow !== undefined && !workflow.nodes.some((node) => node.id === record.node_id)) {
    diagnostics.push(
      diagnostic(
        'missing_reference',
        file,
        '/node_id',
        'StepArtifact node_id does not exist in the Workflow Snapshot.',
      ),
    );
  }
  if (
    typeof record.attempt !== 'number' ||
    !Number.isInteger(record.attempt) ||
    record.attempt < 1 ||
    record.attempt > FIXED_LIMITS.attempts_per_node
  ) {
    diagnostics.push(diagnostic('schema', file, '/attempt', 'attempt is invalid.'));
  }
  const statuses = new Set<unknown>(['succeeded', 'failed', 'blocked', 'cancelled']);
  if (!statuses.has(record.status)) {
    diagnostics.push(diagnostic('schema', file, '/status', 'status is not a settled status.'));
  }
  if (!validTimestamp(record.started_at)) {
    diagnostics.push(diagnostic('schema', file, '/started_at', 'started_at is invalid.'));
  }
  if (!validTimestamp(record.settled_at)) {
    diagnostics.push(diagnostic('schema', file, '/settled_at', 'settled_at is invalid.'));
  } else if (validTimestamp(record.started_at) && record.settled_at < record.started_at) {
    diagnostics.push(
      diagnostic(
        'status_invariant',
        file,
        '/settled_at',
        'settled_at must not precede started_at.',
      ),
    );
  }
  if (!validSha256(record.context_sha256)) {
    diagnostics.push(diagnostic('schema', file, '/context_sha256', 'context_sha256 is invalid.'));
  }

  const inputs: Record<string, StepInputReference> = {};
  if (!isRecord(record.inputs)) {
    diagnostics.push(diagnostic('schema', file, '/inputs', 'inputs must be a mapping.'));
  } else {
    for (const [bindingId, input] of Object.entries(record.inputs)) {
      const inputPath = `/inputs/${escapePointerSegment(bindingId)}`;
      if (!validIdentifier(bindingId)) {
        diagnostics.push(diagnostic('schema', file, inputPath, 'Input Binding ID is invalid.'));
      }
      const validated = validateStepInput(input, file, inputPath, diagnostics);
      if (validIdentifier(bindingId) && validated !== undefined) inputs[bindingId] = validated;
    }
  }

  if (!isRecord(record.executor)) {
    diagnostics.push(diagnostic('schema', file, '/executor', 'executor must be a mapping.'));
  } else {
    checkFields(
      record.executor,
      ['kind', 'name', 'version'],
      ['kind', 'name'],
      file,
      '/executor',
      diagnostics,
    );
    if (!['agent', 'human', 'program'].includes(String(record.executor.kind))) {
      diagnostics.push(diagnostic('schema', file, '/executor/kind', 'executor kind is invalid.'));
    }
    for (const field of ['name', 'version'] as const) {
      if (
        (field === 'name' || record.executor[field] !== undefined) &&
        (typeof record.executor[field] !== 'string' || record.executor[field].length === 0)
      ) {
        diagnostics.push(
          diagnostic('schema', file, `/executor/${field}`, `${field} must be nonempty.`),
        );
      }
    }
  }

  if (record.status === 'succeeded') {
    if (record.problem !== undefined) {
      diagnostics.push(
        diagnostic(
          'status_invariant',
          file,
          '/problem',
          'A succeeded StepArtifact must not have a problem.',
        ),
      );
    }
  } else if (statuses.has(record.status)) {
    if (!isRecord(record.problem)) {
      diagnostics.push(
        diagnostic(
          'status_invariant',
          file,
          '/problem',
          'A non-success StepArtifact requires a problem.',
        ),
      );
    } else {
      checkFields(
        record.problem,
        ['code', 'message'],
        ['code', 'message'],
        file,
        '/problem',
        diagnostics,
      );
      if (
        typeof record.problem.code !== 'string' ||
        !PROBLEM_CODE_PATTERN.test(record.problem.code)
      ) {
        diagnostics.push(diagnostic('schema', file, '/problem/code', 'problem code is invalid.'));
      }
      if (typeof record.problem.message !== 'string' || record.problem.message.length === 0) {
        diagnostics.push(
          diagnostic('schema', file, '/problem/message', 'problem message must be nonempty.'),
        );
      }
    }
  }
  validateExtensions(record.extensions, file, '/extensions', diagnostics);

  const filenameMatch = STEP_FILENAME_PATTERN.exec(filename);
  if (filenameMatch === null) {
    diagnostics.push(diagnostic('layout', file, '', 'StepArtifact filename is invalid.'));
  } else {
    const filenameSettledAt = `${filenameMatch[1]!.slice(0, 4)}-${filenameMatch[1]!.slice(
      4,
      6,
    )}-${filenameMatch[1]!.slice(6, 11)}:${filenameMatch[1]!.slice(
      11,
      13,
    )}:${filenameMatch[1]!.slice(13)}`;
    if (filenameMatch[2] !== record.node_id) {
      diagnostics.push(
        diagnostic('layout', file, '/node_id', 'node_id must agree with the filename.'),
      );
    }
    if (Number(filenameMatch[3]) !== record.attempt) {
      diagnostics.push(
        diagnostic('layout', file, '/attempt', 'attempt must agree with the filename.'),
      );
    }
    if (filenameSettledAt !== record.settled_at) {
      diagnostics.push(
        diagnostic('layout', file, '/settled_at', 'settled_at must agree with the filename.'),
      );
    }
  }

  const node = validIdentifier(record.node_id)
    ? workflow?.nodes.find((candidate) => candidate.id === record.node_id)
    : undefined;
  if (node !== undefined && isRecord(record.inputs)) {
    const expectedBindings = Object.keys(node.inputs ?? {}).sort();
    const recordedBindings = Object.keys(record.inputs).sort();
    if (JSON.stringify(expectedBindings) !== JSON.stringify(recordedBindings)) {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          file,
          '/inputs',
          'StepArtifact Inputs must match the Node Definition exactly.',
        ),
      );
    }
  }

  if (
    record.schema_version !== 'breakdown.step-artifact.v1' ||
    record.run_id !== runId ||
    !validIdentifier(record.node_id) ||
    (workflow !== undefined && node === undefined) ||
    typeof record.attempt !== 'number' ||
    !Number.isInteger(record.attempt) ||
    record.attempt < 1 ||
    record.attempt > FIXED_LIMITS.attempts_per_node ||
    !statuses.has(record.status) ||
    !validTimestamp(record.started_at) ||
    !validTimestamp(record.settled_at) ||
    !validSha256(record.context_sha256) ||
    !isRecord(record.inputs) ||
    filenameMatch === null
  ) {
    return undefined;
  }
  return {
    file,
    filename,
    stem: filename.slice(0, -3),
    markdownBytes,
    node_id: record.node_id,
    attempt: record.attempt,
    status: record.status as SettledStatus,
    started_at: record.started_at,
    settled_at: record.settled_at,
    context_sha256: record.context_sha256,
    inputs,
  };
}

function sortIdentifierMap<T>(value: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => compareText(left, right)),
  );
}

function contextHash(
  runId: string,
  workflow: WorkflowDefinition,
  node: WorkflowDefinition['nodes'][number],
  resolvedInputs: Record<string, unknown>,
) {
  const inputs = sortIdentifierMap(node.inputs ?? {});
  const preimage = {
    hash_schema: 'breakdown.node-context.v1',
    run_id: runId,
    node_definition: {
      id: node.id,
      name: node.name,
      prompt: node.prompt,
      inputs,
      data_contract: node.data_contract ?? null,
    },
    resolved_inputs: sortIdentifierMap(resolvedInputs),
  };
  return sha256(Buffer.from(canonicalizeJson(preimage), 'utf8'));
}

function topologicalNodes(workflow: WorkflowDefinition) {
  const indexById = new Map(workflow.nodes.map((node, index) => [node.id, index]));
  const remaining = new Set(workflow.nodes.map((node) => node.id));
  const selected = new Set<string>();
  const ordered: WorkflowDefinition['nodes'] = [];
  while (remaining.size > 0) {
    const ready = workflow.nodes
      .filter((node) => remaining.has(node.id))
      .filter((node) =>
        Object.values(node.inputs ?? {}).every(
          (binding) => !('node' in binding) || selected.has(binding.node),
        ),
      )
      .sort((left, right) => indexById.get(left.id)! - indexById.get(right.id)!);
    if (ready.length === 0) break;
    for (const node of ready) {
      remaining.delete(node.id);
      selected.add(node.id);
      ordered.push(node);
    }
  }
  return ordered;
}

function resultDescriptor(step: ParsedStepArtifact): SelectedResultDescriptor {
  return {
    node_id: step.node_id,
    attempt: step.attempt,
    markdown: {
      path: step.file,
      sha256: sha256(step.markdownBytes),
    },
    ...(step.json === undefined ? {} : { json: step.json }),
  };
}

function artifactIdentity(nodeId: string, attempt: number) {
  return `${nodeId}\0${attempt}`;
}

function resolveArtifactInputs(
  step: ParsedStepArtifact,
  node: WorkflowDefinition['nodes'][number],
  manifest: RunManifest,
  workflow: WorkflowDefinition,
  artifactByIdentity: Map<string, ParsedStepArtifact>,
  diagnostics: Diagnostic[],
) {
  const resolvedInputs: Record<string, unknown> = {};
  for (const [bindingId, binding] of Object.entries(node.inputs ?? {})) {
    const input = step.inputs[bindingId];
    const inputPath = `/inputs/${escapePointerSegment(bindingId)}`;
    if ('workflow_input' in binding) {
      if (input === undefined || !('workflow_input' in input)) continue;
      if (input.workflow_input !== binding.workflow_input) {
        diagnostics.push(
          diagnostic(
            'reference_mismatch',
            step.file,
            `${inputPath}/workflow_input`,
            'Workflow Input reference does not match the Node Definition.',
          ),
        );
        continue;
      }
      const resolved = manifest.inputs[binding.workflow_input];
      const definition = workflow.inputs?.[binding.workflow_input];
      if (resolved === undefined) continue;
      resolvedInputs[bindingId] = {
        workflow_input: {
          id: binding.workflow_input,
          description: definition?.description ?? null,
          path: resolved.path,
          sha256: resolved.sha256,
        },
      };
      continue;
    }

    if (input === undefined || !('result' in input)) continue;
    const reference = input.result;
    if (reference.node_id !== binding.node) {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          step.file,
          `${inputPath}/result/node_id`,
          'Result reference does not match the Node Definition.',
        ),
      );
      continue;
    }
    const predecessor = artifactByIdentity.get(
      artifactIdentity(reference.node_id, reference.attempt),
    );
    if (predecessor === undefined) {
      diagnostics.push(
        diagnostic(
          'missing_reference',
          step.file,
          `${inputPath}/result`,
          'Referenced predecessor StepArtifact does not exist.',
        ),
      );
      continue;
    }
    if (predecessor.status !== 'succeeded') {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          step.file,
          `${inputPath}/result`,
          'A Result reference must identify a succeeded StepArtifact.',
        ),
      );
      continue;
    }
    if (predecessor.settled_at > step.started_at) {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          step.file,
          `${inputPath}/result`,
          'A predecessor Result must settle before the consuming attempt starts.',
        ),
      );
    }
    const expected = resultDescriptor(predecessor);
    if (
      reference.markdown.path !== expected.markdown.path ||
      reference.markdown.sha256 !== expected.markdown.sha256
    ) {
      diagnostics.push(
        diagnostic(
          'integrity',
          step.file,
          `${inputPath}/result/markdown`,
          'Referenced Markdown path or digest does not match.',
        ),
      );
    }
    const expectedJson = expected.json;
    if (
      (reference.json === undefined) !== (expectedJson === undefined) ||
      (reference.json !== undefined &&
        expectedJson !== undefined &&
        (reference.json.path !== expectedJson.path ||
          reference.json.sha256 !== expectedJson.sha256))
    ) {
      diagnostics.push(
        diagnostic(
          'integrity',
          step.file,
          `${inputPath}/result/json`,
          'Referenced JSON pairing, path, or digest does not match.',
        ),
      );
    }
    resolvedInputs[bindingId] = {
      result: {
        node_id: reference.node_id,
        attempt: reference.attempt,
        markdown: reference.markdown,
        json: reference.json ?? null,
      },
    };
  }
  return resolvedInputs;
}

function validateArtifactHistory(
  artifacts: ParsedStepArtifact[],
  manifest: RunManifest,
  workflow: WorkflowDefinition,
  diagnostics: Diagnostic[],
) {
  const grouped = new Map<string, ParsedStepArtifact[]>();
  for (const artifact of artifacts) {
    const group = grouped.get(artifact.node_id) ?? [];
    group.push(artifact);
    grouped.set(artifact.node_id, group);
    if (artifact.started_at < manifest.created_at) {
      diagnostics.push(
        diagnostic(
          'status_invariant',
          artifact.file,
          '/started_at',
          'StepArtifact execution cannot start before its Run.',
        ),
      );
    }
  }

  const artifactByIdentity = new Map<string, ParsedStepArtifact>();
  for (const [nodeId, group] of grouped) {
    const byAttempt = new Map<number, ParsedStepArtifact[]>();
    for (const artifact of group) {
      const duplicates = byAttempt.get(artifact.attempt) ?? [];
      duplicates.push(artifact);
      byAttempt.set(artifact.attempt, duplicates);
    }
    for (const [attempt, duplicates] of byAttempt) {
      if (duplicates.length > 1) {
        for (const duplicate of duplicates) {
          diagnostics.push(
            diagnostic(
              'duplicate_attempt',
              duplicate.file,
              '/attempt',
              `Attempt ${attempt} is duplicated for Node Definition ${nodeId}.`,
            ),
          );
        }
      } else {
        artifactByIdentity.set(artifactIdentity(nodeId, attempt), duplicates[0]!);
      }
    }
    const attempts = [...byAttempt.keys()].sort((left, right) => left - right);
    for (const [index, attempt] of attempts.entries()) {
      if (attempt !== index + 1) {
        const artifact = byAttempt.get(attempt)?.[0];
        if (artifact !== undefined) {
          diagnostics.push(
            diagnostic(
              'duplicate_attempt',
              artifact.file,
              '/attempt',
              'Committed attempts must be positive and contiguous per node.',
            ),
          );
        }
      }
    }
  }

  for (const artifact of artifacts) {
    const node = workflow.nodes.find((candidate) => candidate.id === artifact.node_id);
    if (node === undefined) continue;
    const resolvedInputs = resolveArtifactInputs(
      artifact,
      node,
      manifest,
      workflow,
      artifactByIdentity,
      diagnostics,
    );
    try {
      const recomputed = contextHash(manifest.run_id, workflow, node, resolvedInputs);
      if (recomputed !== artifact.context_sha256) {
        diagnostics.push(
          diagnostic(
            'integrity',
            artifact.file,
            '/context_sha256',
            'Stored Node Context does not match the StepArtifact Inputs.',
          ),
        );
      }
    } catch {
      diagnostics.push(
        diagnostic(
          'integrity',
          artifact.file,
          '/context_sha256',
          'The Node Context cannot be canonicalized.',
        ),
      );
    }
  }
}

function deriveNodeState(
  runId: string,
  manifest: RunManifest,
  workflow: WorkflowDefinition,
  artifacts: ParsedStepArtifact[],
) {
  const selectedByNode = new Map<string, ParsedStepArtifact>();
  const nodes: InspectedNode[] = [];
  for (const node of topologicalNodes(workflow)) {
    const nodeArtifacts = artifacts
      .filter((artifact) => artifact.node_id === node.id)
      .sort((left, right) => left.attempt - right.attempt);
    const resolvedInputs: Record<string, unknown> = {};
    let blocked = false;
    for (const [bindingId, binding] of Object.entries(node.inputs ?? {})) {
      if ('workflow_input' in binding) {
        const definition = workflow.inputs?.[binding.workflow_input];
        const input = manifest.inputs[binding.workflow_input];
        if (input === undefined) {
          blocked = true;
          continue;
        }
        resolvedInputs[bindingId] = {
          workflow_input: {
            id: binding.workflow_input,
            description: definition?.description ?? null,
            path: input.path,
            sha256: input.sha256,
          },
        };
      } else {
        const selected = selectedByNode.get(binding.node);
        if (selected === undefined) {
          blocked = true;
          continue;
        }
        const result = resultDescriptor(selected);
        resolvedInputs[bindingId] = {
          result: {
            node_id: result.node_id,
            attempt: result.attempt,
            markdown: result.markdown,
            json: result.json ?? null,
          },
        };
      }
    }
    const nextAttempt = (nodeArtifacts.at(-1)?.attempt ?? 0) + 1;
    if (blocked) {
      nodes.push({
        node_id: node.id,
        state: 'blocked',
        stale: false,
        next_attempt: nextAttempt,
      });
      continue;
    }
    const expectedContext = contextHash(runId, workflow, node, resolvedInputs);
    const selected = nodeArtifacts
      .filter(
        (artifact) =>
          artifact.status === 'succeeded' && artifact.context_sha256 === expectedContext,
      )
      .at(-1);
    if (selected !== undefined) selectedByNode.set(node.id, selected);
    nodes.push({
      node_id: node.id,
      state: selected === undefined ? 'runnable' : 'complete',
      stale:
        selected === undefined && nodeArtifacts.some((artifact) => artifact.status === 'succeeded'),
      next_attempt: nextAttempt,
      context_sha256: expectedContext,
      ...(selected === undefined ? {} : { selected_result: resultDescriptor(selected) }),
    });
  }
  return { nodes, selectedByNode };
}

async function observeLock(
  selectedProjectRoot: SelectedProjectRoot,
  runId: string,
): Promise<ObservedRunLock | null> {
  const projectRoot = selectedProjectRoot.path;
  const projectRootIdentity = selectedProjectRoot.identity;
  const lockDirectory = '.breakdown/locks/runs';
  const lockFilename = `${runId}.lock`;
  const lockPath = `${lockDirectory}/${lockFilename}`;
  let relativePath = lockPath;
  try {
    await lstat(join(projectRoot, relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        lock_id: null,
        recovery:
          'Confirm the prior writer stopped, then recover with this exact observed lock ID.',
      };
    }
    try {
      const recoveryEntries = (
        await readSecureDirectory(projectRoot, lockDirectory, Number.MAX_SAFE_INTEGER, {
          expectedProjectIdentity: projectRootIdentity,
        })
      ).entries
        .filter((entry) => isRunLockRecoveryAlias(lockFilename, entry))
        .sort();
      if (recoveryEntries.length === 0) return null;
      if (recoveryEntries.length > 1) {
        return {
          lock_id: null,
          recovery:
            'Confirm the prior writer stopped, then recover with this exact observed lock ID.',
        };
      }
      relativePath = `${lockDirectory}/${recoveryEntries[0]}`;
    } catch (recoveryError) {
      if ((recoveryError as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return {
        lock_id: null,
        recovery:
          'Confirm the prior writer stopped, then recover with this exact observed lock ID.',
      };
    }
  }
  try {
    const lock = await readSecureRegularFile(projectRoot, relativePath, 65_536, {
      allowPublicationStagingAlias: true,
      expectedProjectIdentity: projectRootIdentity,
    });
    let lockId: string | null = null;
    try {
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(lock.bytes),
      );
      if (isRecord(value)) {
        const candidate = value.lock_id ?? value.id;
        if (typeof candidate === 'string' && candidate.length > 0) lockId = candidate;
      }
    } catch {
      // A read-only observation still reports that an unparseable lock exists.
    }
    return {
      lock_id: lockId,
      recovery: 'Confirm the prior writer stopped, then recover with this exact observed lock ID.',
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return {
      lock_id: null,
      recovery: 'Confirm the prior writer stopped, then recover with this exact observed lock ID.',
    };
  }
}

export function isCommittedStepArtifactFilename(filename: string) {
  return STEP_FILENAME_PATTERN.test(filename);
}

async function inspectRunOnce(
  request: InspectRunRequest,
  selectedProjectRoot: SelectedProjectRoot,
  dependencies: InspectionDependencies,
): Promise<OperationResult<InspectRunValue>> {
  const projectRoot = selectedProjectRoot.path;
  const projectRootIdentity = selectedProjectRoot.identity;
  if (typeof request.run_id !== 'string' || RUN_ID_PATTERN.exec(request.run_id) === null) {
    return runNotFoundFailure();
  }

  try {
    await assertSupportedFilesystem(projectRoot);
  } catch (error) {
    if (error instanceof UnsupportedFilesystemError) return unsupportedFilesystemFailure();
    return ioFailure();
  }

  const runPath = `outputs/${request.run_id}`;
  try {
    await lstat(join(projectRoot, runPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return runNotFoundFailure();
    return ioFailure('Could not select the exact Run.');
  }
  try {
    await readSecureDirectory(projectRoot, runPath, Number.MAX_SAFE_INTEGER, {
      expectedProjectIdentity: projectRootIdentity,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return runNotFoundFailure();
    if (error instanceof ResourceLimitError) return resourceLimitFailure();
    return ioFailure('Could not securely read the Run directory.');
  }

  const diagnostics: Diagnostic[] = [];
  const manifestFile = `${runPath}/run.md`;
  const snapshotFile = `${runPath}/breakdown.yaml`;
  const stepsPath = `${runPath}/steps`;
  let manifestBytes: Uint8Array | undefined;
  let snapshotBytes: Uint8Array | undefined;
  let stepEntries: string[] = [];
  let stepDirectorySnapshot: SecureDirectorySnapshot | undefined;
  try {
    manifestBytes = (
      await readSecureRegularFile(
        projectRoot,
        manifestFile,
        FIXED_LIMITS.automation_response_bytes,
        { expectedProjectIdentity: projectRootIdentity },
      )
    ).bytes;
  } catch {
    diagnostics.push(
      diagnostic('layout', manifestFile, '', 'The Run Manifest is missing or not a regular file.'),
    );
  }
  try {
    snapshotBytes = (
      await readSecureRegularFile(
        projectRoot,
        snapshotFile,
        FIXED_LIMITS.workflow_definition_bytes,
        { expectedProjectIdentity: projectRootIdentity },
      )
    ).bytes;
  } catch (error) {
    if (error instanceof ResourceLimitError) return resourceLimitFailure();
    diagnostics.push(
      diagnostic(
        'layout',
        snapshotFile,
        '',
        'The Workflow Snapshot is missing or not a regular file.',
      ),
    );
  }
  try {
    const stepDirectory = await readSecureDirectory(
      projectRoot,
      stepsPath,
      FIXED_LIMITS.direct_step_entries_scanned,
      {
        expectedProjectIdentity: projectRootIdentity,
      },
    );
    stepEntries = stepDirectory.entries;
    stepDirectorySnapshot = stepDirectory.snapshot;
  } catch (error) {
    if (error instanceof SecureDirectoryChangedError) throw error;
    if (error instanceof ResourceLimitError) return resourceLimitFailure();
    diagnostics.push(
      diagnostic('layout', stepsPath, '', 'The steps path is missing or not a directory.'),
    );
  }
  if (stepDirectorySnapshot !== undefined) {
    await dependencies.onStepDirectoryListed?.();
  }

  let manifest: RunManifest | undefined;
  if (manifestBytes !== undefined) {
    let record: ParsedMarkdownRecord;
    try {
      record = parseMarkdownRecord(manifestBytes, manifestFile, diagnostics);
    } catch (error) {
      if (error instanceof ResourceLimitError) return resourceLimitFailure();
      return ioFailure();
    }
    if (record.value !== undefined) {
      manifest = validateRunManifest(record.value, manifestFile, request.run_id, diagnostics);
    }
  }

  let snapshot: ValidateWorkflowValue | undefined;
  if (snapshotBytes !== undefined) {
    const validation = await dependencies.validateSnapshot(snapshotBytes, projectRoot);
    if (validation.ok) {
      snapshot = validation.value;
    } else {
      if (validation.failure.kind === 'resource_limit') {
        return resourceLimitFailure(validation.failure.diagnostics);
      }
      diagnostics.push(
        ...validation.failure.diagnostics.map((item) => ({
          ...item,
          file: snapshotFile,
        })),
      );
      if (validation.failure.diagnostics.length === 0) {
        diagnostics.push(
          diagnostic(
            validation.failure.kind === 'unsupported' ? 'unsupported_version' : 'schema',
            snapshotFile,
            '',
            validation.failure.message,
          ),
        );
      }
    }
  }

  if (manifest !== undefined && snapshotBytes !== undefined) {
    if (sha256(snapshotBytes) !== manifest.workflow.sha256) {
      diagnostics.push(
        diagnostic(
          'integrity',
          snapshotFile,
          '',
          'The Workflow Snapshot digest does not match the Run Manifest.',
        ),
      );
    }
  }
  if (manifest !== undefined && snapshot !== undefined) {
    if (manifest.workflow.id !== snapshot.workflow.id) {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          manifestFile,
          '/workflow/id',
          'The Run Manifest Workflow identity does not match the Snapshot.',
        ),
      );
    }
    const declaredInputs = Object.keys(snapshot.workflow.inputs ?? {}).sort();
    const recordedInputs = Object.keys(manifest.inputs).sort();
    if (JSON.stringify(declaredInputs) !== JSON.stringify(recordedInputs)) {
      diagnostics.push(
        diagnostic(
          'reference_mismatch',
          manifestFile,
          '/inputs',
          'The Run Manifest must contain exactly the Snapshot Workflow Inputs.',
        ),
      );
    }
    for (const [inputId, input] of Object.entries(manifest.inputs)) {
      const inputPath = `/inputs/${escapePointerSegment(inputId)}`;
      try {
        const bytes = (
          await readSecureRegularFile(
            projectRoot,
            input.path,
            FIXED_LIMITS.workflow_input_file_bytes,
            { expectedProjectIdentity: projectRootIdentity },
          )
        ).bytes;
        if (sha256(bytes) !== input.sha256) {
          diagnostics.push(
            diagnostic(
              'integrity',
              manifestFile,
              `${inputPath}/sha256`,
              'The Workflow Input digest no longer matches.',
            ),
          );
        }
      } catch (error) {
        if (error instanceof ResourceLimitError) return resourceLimitFailure();
        diagnostics.push(
          diagnostic(
            'integrity',
            manifestFile,
            `${inputPath}/path`,
            'The Workflow Input can no longer be read securely.',
          ),
        );
      }
    }
  }

  const committedMarkdown = stepEntries.filter(isCommittedStepArtifactFilename).sort();
  if (committedMarkdown.length > FIXED_LIMITS.step_artifacts_per_run) {
    return resourceLimitFailure();
  }
  const stepEntrySet = new Set(stepEntries);
  const artifacts: ParsedStepArtifact[] = [];
  // Secure reads are independent within a stable directory snapshot. Parse each settled
  // batch in filename order so concurrency cannot change diagnostics or derived history.
  for (
    let batchStart = 0;
    batchStart < committedMarkdown.length;
    batchStart += MAX_CONCURRENT_STEP_ARTIFACT_READS
  ) {
    const batch = committedMarkdown.slice(
      batchStart,
      batchStart + MAX_CONCURRENT_STEP_ARTIFACT_READS,
    );
    const reads = await Promise.allSettled(
      batch.map((filename) =>
        readSecureResultFile(
          projectRoot,
          `${stepsPath}/${filename}`,
          FIXED_LIMITS.automation_response_bytes,
          {
            expectedParentSnapshot: stepDirectorySnapshot,
            expectedProjectIdentity: projectRootIdentity,
          },
        ),
      ),
    );
    for (const [batchIndex, read] of reads.entries()) {
      const filename = batch[batchIndex];
      if (filename === undefined) return ioFailure();
      const file = `${stepsPath}/${filename}`;
      let markdownBytes: Uint8Array;
      if (read.status === 'fulfilled') {
        markdownBytes = read.value.bytes;
      } else {
        const error = read.reason;
        if (error instanceof SecureDirectoryChangedError) throw error;
        if (error instanceof ResourceLimitError) return resourceLimitFailure();
        diagnostics.push(
          diagnostic('layout', file, '', 'A committed StepArtifact must be a secure regular file.'),
        );
        continue;
      }
      let record: ParsedMarkdownRecord;
      try {
        record = parseMarkdownRecord(markdownBytes, file, diagnostics);
      } catch (error) {
        if (error instanceof ResourceLimitError) return resourceLimitFailure();
        return ioFailure();
      }
      if (Buffer.byteLength(record.body) > FIXED_LIMITS.candidate_markdown_bytes) {
        return resourceLimitFailure();
      }
      if (record.value === undefined) continue;
      const artifact = validateStepArtifact(
        record.value,
        markdownBytes,
        file,
        filename,
        request.run_id,
        snapshot?.workflow,
        diagnostics,
      );
      if (artifact === undefined) continue;

      const sidecarFilename = `${artifact.stem}.json`;
      const sidecarFile = `${stepsPath}/${sidecarFilename}`;
      const hasSidecar = stepEntrySet.has(sidecarFilename);
      const node = snapshot?.workflow.nodes.find((candidate) => candidate.id === artifact.node_id);
      const requiresSidecar =
        node !== undefined && artifact.status === 'succeeded' && node.data_contract !== undefined;
      if (node !== undefined && requiresSidecar !== hasSidecar) {
        diagnostics.push(
          diagnostic(
            'status_invariant',
            file,
            '/status',
            requiresSidecar
              ? 'A contracted successful Result requires its same-stem JSON sidecar.'
              : 'This StepArtifact must not have a JSON sidecar.',
          ),
        );
      }
      if (hasSidecar) {
        try {
          const jsonBytes = (
            await readSecureResultFile(
              projectRoot,
              sidecarFile,
              FIXED_LIMITS.candidate_json_bytes,
              {
                expectedParentSnapshot: stepDirectorySnapshot,
                expectedProjectIdentity: projectRootIdentity,
              },
            )
          ).bytes;
          const jsonValue = parseStrictJson(jsonBytes, sidecarFile, diagnostics);
          if (requiresSidecar && jsonValue !== undefined) {
            validateDataContractInstance(
              jsonValue,
              node?.data_contract,
              sidecarFile,
              '',
              diagnostics,
            );
          }
          if (requiresSidecar) {
            artifact.json = {
              path: sidecarFile,
              sha256: sha256(jsonBytes),
            };
          }
        } catch (error) {
          if (error instanceof SecureDirectoryChangedError) throw error;
          if (error instanceof ResourceLimitError) return resourceLimitFailure();
          diagnostics.push(
            diagnostic(
              'layout',
              sidecarFile,
              '',
              'A paired Result sidecar must be a secure regular file.',
            ),
          );
        }
      }
      artifacts.push(artifact);
    }
  }
  if (manifest !== undefined && snapshot !== undefined) {
    validateArtifactHistory(artifacts, manifest, snapshot.workflow, diagnostics);
  }

  if (diagnostics.length > FIXED_LIMITS.diagnostics_returned) {
    return resourceLimitFailure(
      diagnostics.sort(compareRunDiagnostics).slice(0, FIXED_LIMITS.diagnostics_returned),
    );
  }
  if (diagnostics.length > 0) return invalidRunFailure(diagnostics);
  if (manifest === undefined || snapshot === undefined) return invalidRunFailure(diagnostics);

  const { nodes, selectedByNode } = deriveNodeState(
    request.run_id,
    manifest,
    snapshot.workflow,
    artifacts,
  );
  const nodeOrder = new Map(
    topologicalNodes(snapshot.workflow).map((node, index) => [node.id, index]),
  );
  const orderedArtifacts = [...artifacts].sort(
    (left, right) =>
      nodeOrder.get(left.node_id)! - nodeOrder.get(right.node_id)! ||
      left.attempt - right.attempt ||
      compareText(left.file, right.file),
  );
  const consumedNodeIds = new Set(
    snapshot.workflow.nodes.flatMap((node) =>
      Object.values(node.inputs ?? {}).flatMap((binding) =>
        'node' in binding ? [binding.node] : [],
      ),
    ),
  );
  const terminalResults = topologicalNodes(snapshot.workflow)
    .filter((node) => !consumedNodeIds.has(node.id))
    .flatMap((node) => {
      const selected = selectedByNode.get(node.id);
      return selected === undefined ? [] : [resultDescriptor(selected)];
    });
  return {
    ok: true,
    value: {
      run_id: request.run_id,
      path: runPath,
      status: nodes.every((node) => node.state === 'complete') ? 'complete' : 'incomplete',
      resumable: true,
      workflow: manifest.workflow,
      inputs: sortIdentifierMap(manifest.inputs),
      nodes,
      attempts: orderedArtifacts.map((artifact) => ({
        file: artifact.file,
        node_id: artifact.node_id,
        attempt: artifact.attempt,
        status: artifact.status,
        started_at: artifact.started_at,
        settled_at: artifact.settled_at,
        context_sha256: artifact.context_sha256,
        selected: selectedByNode.get(artifact.node_id) === artifact,
      })),
      terminal_results: terminalResults,
      lock: await observeLock(selectedProjectRoot, request.run_id),
    },
  };
}

export async function inspectRun(
  request: InspectRunRequest,
  selectedProjectRoot: SelectedProjectRoot,
  dependencies: InspectionDependencies,
): Promise<OperationResult<InspectRunValue>> {
  for (let inspectionPass = 0; inspectionPass < MAX_STABLE_INSPECTION_PASSES; inspectionPass += 1) {
    try {
      return await inspectRunOnce(request, selectedProjectRoot, dependencies);
    } catch (error) {
      if (!(error instanceof SecureDirectoryChangedError)) throw error;
    }
  }
  return ioFailure('The Run changed repeatedly while it was being inspected.');
}
