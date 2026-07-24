import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isMap, isScalar, parseDocument, visit } from 'yaml';

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
}

export interface WorkflowDefinition {
  schema_version: 'breakdown.workflow.v1';
  id: string;
  name: string;
  nodes: NodeDefinition[];
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

function validateRequiredString(
  value: Record<string, unknown>,
  field: string,
  path: string,
  diagnostics: Diagnostic[],
) {
  if (typeof value[field] !== 'string' || value[field].length === 0) {
    diagnostics.push(schemaDiagnostic(path, `${field} must be a non-empty string.`));
  }
}

function validateWorkflowShape(value: unknown): Diagnostic[] {
  if (!isRecord(value)) {
    return [schemaDiagnostic('', 'The Workflow Definition root must be a mapping.')];
  }

  const diagnostics: Diagnostic[] = [];
  const rootFields = new Set(['schema_version', 'id', 'name', 'nodes']);

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

  validateRequiredString(value, 'id', '/id', diagnostics);
  validateRequiredString(value, 'name', '/name', diagnostics);

  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    diagnostics.push(schemaDiagnostic('/nodes', 'nodes must be a non-empty array.'));
  } else {
    value.nodes.forEach((node, index) => {
      const nodePath = `/nodes/${index}`;
      if (!isRecord(node)) {
        diagnostics.push(schemaDiagnostic(nodePath, 'Each node must be a mapping.'));
        return;
      }

      const nodeFields = new Set(['id', 'name', 'prompt']);
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

      validateRequiredString(node, 'id', `${nodePath}/id`, diagnostics);
      validateRequiredString(node, 'name', `${nodePath}/name`, diagnostics);
      validateRequiredString(node, 'prompt', `${nodePath}/prompt`, diagnostics);
    });
  }

  return diagnostics.sort(compareDiagnostics);
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

  const workflow: unknown = document.toJS({ maxAliasCount: 0 });
  const diagnostics = validateWorkflowShape(workflow);
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
      workflow: workflow as WorkflowDefinition,
    },
  };
}
