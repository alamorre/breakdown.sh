#!/usr/bin/env node

import { isAbsolute } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  OPERATION_REQUEST_SCHEMA_VERSION,
  operate,
  type CandidateOutcome,
  type LockRecoveryIntent,
  type OperationFailure,
  type OperationResult,
  type PrepareWorkRequest,
  type SubmitCandidateRequest,
  type WorkPacket,
  unsupportedOperationRequestFailure,
} from '@breakdown-sh/core';

import {
  MCP_PREFERRED_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_RELEASE_VERSION,
  MCP_SERVER_INFO,
  OPERATION_NAMES,
  TOOL_CATALOG,
} from './protocol-assets.js';
import {
  validateCreateRunArguments,
  validateInspectRunArguments,
  validatePrepareWorkArguments,
  validateReadWorkInputArguments,
  validateSubmitCandidateArguments,
  validateValidateWorkflowArguments,
  type ProtocolValidator,
} from './protocol-validators.js';
import { BreakdownStdioTransport } from './stdio-transport.js';

type Operation = (typeof OPERATION_NAMES)[number];

const ARGUMENT_VALIDATORS: Record<Operation, ProtocolValidator> = {
  validate_workflow: validateValidateWorkflowArguments,
  create_run: validateCreateRunArguments,
  inspect_run: validateInspectRunArguments,
  prepare_work: validatePrepareWorkArguments,
  read_work_input: validateReadWorkInputArguments,
  submit_candidate: validateSubmitCandidateArguments,
};
const exactJson = JSON as typeof JSON & {
  isRawJSON(value: unknown): boolean;
  rawJSON(text: string): object;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === 'bigint') return exactJson.rawJSON(value.toString());
  if (value === null || typeof value !== 'object' || exactJson.isRawJSON(value)) return value;
  if (Array.isArray(value)) return value.map(normalizeForJson);

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) normalized[key] = normalizeForJson(item);
  }
  return normalized;
}

function operationEnvelope(
  operation: Operation,
  result: OperationResult<unknown>,
): Record<string, unknown> {
  return normalizeForJson({
    schema_version: 'breakdown.mcp-output.v1',
    release_version: MCP_RELEASE_VERSION,
    supported_operation_schemas: [OPERATION_REQUEST_SCHEMA_VERSION],
    operation,
    ok: result.ok,
    data: result.ok ? result.value : null,
    error: result.ok ? null : result.failure,
  }) as Record<string, unknown>;
}

function toolResult(operation: Operation, result: OperationResult<unknown>) {
  const envelope = operationEnvelope(operation, result);
  const text = JSON.stringify(envelope);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: envelope,
    ...(result.ok ? {} : { isError: true }),
  };
}

function invalidProjectRootFailure(): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'invalid',
      code: 'invalid_path',
      message: 'The project root must be an absolute OS-native path.',
      diagnostics: [
        {
          code: 'invalid_path',
          path: '/project_root',
          message: 'project_root must be an absolute OS-native path.',
        },
      ],
    },
  };
}

function isOperation(value: string): value is Operation {
  return OPERATION_NAMES.some((operation) => operation === value);
}

class AdapterProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdapterProtocolError';
  }
}

function protocolError(code: number, message: string) {
  return new AdapterProtocolError(code, message);
}

let initializeSeen = false;
let initialized = false;
const activeInvocations = new Set<Promise<void>>();
const server = new Server(
  {
    ...MCP_SERVER_INFO,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(InitializeRequestSchema, async (request) => {
  if (initializeSeen) {
    throw protocolError(ErrorCode.InvalidRequest, 'Server is already initialized.');
  }
  initializeSeen = true;
  return {
    protocolVersion: MCP_PROTOCOL_VERSIONS.includes(request.params.protocolVersion)
      ? request.params.protocolVersion
      : MCP_PREFERRED_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: MCP_SERVER_INFO,
  };
});

server.oninitialized = () => {
  if (initializeSeen) initialized = true;
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!initialized) {
    throw protocolError(ErrorCode.InvalidRequest, 'Server initialization is not complete.');
  }
  return { tools: TOOL_CATALOG };
});

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  let finishInvocation!: () => void;
  const activeInvocation = new Promise<void>((resolve) => {
    finishInvocation = resolve;
  });
  activeInvocations.add(activeInvocation);
  try {
    if (!initialized) {
      throw protocolError(ErrorCode.InvalidRequest, 'Server initialization is not complete.');
    }
    const operation = request.params.name;
    if (!isOperation(operation)) {
      throw protocolError(ErrorCode.MethodNotFound, 'Unknown Breakdown tool.');
    }
    const argumentsValue = request.params.arguments;
    if (!isRecord(argumentsValue) || typeof argumentsValue.schema_version !== 'string') {
      throw protocolError(ErrorCode.InvalidParams, `Invalid arguments for ${operation}.`);
    }
    const argumentsForValidation =
      argumentsValue.schema_version === OPERATION_REQUEST_SCHEMA_VERSION
        ? argumentsValue
        : {
            ...argumentsValue,
            schema_version: OPERATION_REQUEST_SCHEMA_VERSION,
          };
    if (!ARGUMENT_VALIDATORS[operation](argumentsForValidation)) {
      throw protocolError(ErrorCode.InvalidParams, `Invalid arguments for ${operation}.`);
    }
    if (argumentsValue.schema_version !== OPERATION_REQUEST_SCHEMA_VERSION) {
      return toolResult(operation, unsupportedOperationRequestFailure('unsupported_version'));
    }
    const projectRoot = argumentsValue.project_root as string;
    if (!isAbsolute(projectRoot) || projectRoot.includes('\0')) {
      return toolResult(operation, invalidProjectRootFailure());
    }

    const trustedContext = {
      projectRoot,
      signal: extra.signal,
    };
    let result: OperationResult<unknown>;
    switch (operation) {
      case 'validate_workflow':
        result = await operate({ operation }, trustedContext);
        break;
      case 'create_run':
        result = await operate(
          {
            operation,
            ...(argumentsValue.inputs === undefined
              ? {}
              : { inputs: argumentsValue.inputs as Record<string, string> }),
          },
          trustedContext,
        );
        break;
      case 'inspect_run':
        result = await operate(
          {
            operation,
            run_id: argumentsValue.run_id as string,
          },
          trustedContext,
        );
        break;
      case 'prepare_work':
        {
          const mode = argumentsValue.mode as
            | { kind: 'resume' }
            | { kind: 'refresh'; node_id: string };
          const prepareRequest: PrepareWorkRequest = {
            operation,
            run_id: argumentsValue.run_id as string,
            intent: mode.kind,
            ...(argumentsValue.limit === undefined
              ? {}
              : { limit: argumentsValue.limit as number }),
            ...(mode.kind === 'refresh' ? { node_id: mode.node_id } : {}),
          };
          result = await operate(prepareRequest, trustedContext);
        }
        break;
      case 'read_work_input':
        result = await operate(
          {
            operation,
            packet: argumentsValue.packet as WorkPacket,
            binding: argumentsValue.binding as string,
          },
          trustedContext,
        );
        break;
      case 'submit_candidate':
        result = await operate(
          {
            operation,
            packet: argumentsValue.packet as WorkPacket,
            candidate: argumentsValue.candidate as CandidateOutcome,
            ...(argumentsValue.lock_recovery === undefined
              ? {}
              : { lock_recovery: argumentsValue.lock_recovery as LockRecoveryIntent }),
          } as SubmitCandidateRequest,
          trustedContext,
        );
        break;
    }
    return toolResult(operation, result);
  } catch (error) {
    if (error instanceof AdapterProtocolError) throw error;
    throw protocolError(ErrorCode.InternalError, 'Internal error');
  } finally {
    activeInvocations.delete(activeInvocation);
    finishInvocation();
  }
});

const transport = new BreakdownStdioTransport();
let stderrDiagnosticWritten = false;
server.onerror = () => {
  if (stderrDiagnosticWritten) return;
  stderrDiagnosticWritten = true;
  process.stderr.write('breakdown-mcp: protocol error.\n');
};

await server.connect(transport);

let shutdownPromise: Promise<void> | undefined;
function shutdown(exitCode: number) {
  if (shutdownPromise !== undefined) return shutdownPromise;
  process.exitCode = exitCode;
  const keepAlive = setInterval(() => undefined, 1_000);
  shutdownPromise = (async () => {
    await transport.close();
    await Promise.allSettled([...activeInvocations]);
    clearInterval(keepAlive);
  })();
  return shutdownPromise;
}

process.once('SIGINT', () => {
  void shutdown(130);
});
process.once('SIGTERM', () => {
  void shutdown(143);
});
