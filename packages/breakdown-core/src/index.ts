import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';

export interface ValidateWorkflowRequest {
  operation: 'validate_workflow';
}

export interface TrustedContext {
  projectRoot?: string;
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    message: 'Workflow Input defaults must be portable project-relative paths.',
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

function valueForStringKey(mapping: unknown, key: string) {
  if (!isMap(mapping)) return undefined;
  const pair = mapping.items.find(
    (item) => isScalar(item.key) && typeof item.key.value === 'string' && item.key.value === key,
  );
  return pair?.value;
}

function nonStringKeyPathSegment(key: unknown) {
  if (isScalar(key)) return escapePointerSegment(String(key.value));
  return '<non-string-key>';
}

function collectNonStringIdentifierKeyDiagnostics(contents: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const workflowInputs = valueForStringKey(contents, 'inputs');
  if (isMap(workflowInputs)) {
    for (const input of workflowInputs.items) {
      if (!isScalar(input.key) || typeof input.key.value !== 'string') {
        diagnostics.push(
          schemaDiagnostic(
            `/inputs/${nonStringKeyPathSegment(input.key)}`,
            'Workflow Input identifiers must be strings.',
          ),
        );
      }
    }
  }

  const nodes = valueForStringKey(contents, 'nodes');
  if (!isSeq(nodes)) return diagnostics;
  nodes.items.forEach((node, nodeIndex) => {
    const inputBindings = valueForStringKey(node, 'inputs');
    if (!isMap(inputBindings)) return;
    for (const binding of inputBindings.items) {
      if (!isScalar(binding.key) || typeof binding.key.value !== 'string') {
        diagnostics.push(
          schemaDiagnostic(
            `/nodes/${nodeIndex}/inputs/${nonStringKeyPathSegment(binding.key)}`,
            'Input Binding identifiers must be strings.',
          ),
        );
      }
    }
  });

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
  if (typeof value !== 'string' || value.length === 0) {
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

export async function operate(
  request: ValidateWorkflowRequest,
  trustedContext: TrustedContext,
): Promise<OperationResult<ValidateWorkflowValue>> {
  const requestedOperation = (request as { operation?: unknown }).operation;
  if (requestedOperation !== 'validate_workflow') {
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

  if (!trustedContext.projectRoot) {
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

  let bytes: Buffer;
  try {
    bytes = await readFile(join(trustedContext.projectRoot, 'breakdown.yaml'));
  } catch {
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
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });

  if (document.directives?.yaml.explicit && document.directives.yaml.version !== '1.2') {
    return unsupportedYamlVersionFailure();
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
      if (isScalar(node) && typeof node.value === 'number' && !Number.isFinite(node.value)) {
        forbiddenFeatures.add('non-finite numbers');
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

  const yamlIdentifierKeyDiagnostics = collectNonStringIdentifierKeyDiagnostics(document.contents);
  const workflow: unknown = document.toJS({ maxAliasCount: 0 });
  const diagnostics = validateWorkflowShape(workflow, yamlIdentifierKeyDiagnostics);
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

  return {
    ok: true,
    value: {
      definitionPath: 'breakdown.yaml',
      workflow: normalizeWorkflow(workflow as WorkflowDefinition),
    },
  };
}
