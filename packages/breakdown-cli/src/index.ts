#!/usr/bin/env node

import { resolve } from 'node:path';

import {
  FIXED_LIMITS,
  OPERATION_REQUEST_SCHEMA_VERSION,
  operate,
  type OperationFailure,
  type OperationResult,
  type SubmitCandidateRequest,
  unsupportedOperationRequestFailure,
} from '@breakdown-sh/core';

import {
  isOperation,
  isRecord,
  operationRequestDiagnostics,
  type OperationRequest,
} from './protocol-validation.js';
import {
  validateCreateRunRequest,
  validateInspectRunRequest,
  validateOperationRequest,
  validatePrepareWorkRequest,
  validateReadWorkInputRequest,
  validateSubmitCandidateRequest,
  validateValidateWorkflowRequest,
  type ProtocolValidator,
} from './protocol-validator.js';

import {
  CLI_EXIT_CODES,
  CLI_USAGE,
  CLI_VERSION,
  HUMAN_STDERR_LIMIT_BYTES,
} from './cli-reference.js';

const OPERATION_VALIDATORS: Record<OperationRequest['operation'], ProtocolValidator> = {
  validate_workflow: validateValidateWorkflowRequest,
  create_run: validateCreateRunRequest,
  inspect_run: validateInspectRunRequest,
  prepare_work: validatePrepareWorkRequest,
  read_work_input: validateReadWorkInputRequest,
  submit_candidate: validateSubmitCandidateRequest,
};

interface ValidateArguments {
  operation: 'validate_workflow';
  project: string;
  json: boolean;
}

interface CreateArguments {
  operation: 'create_run';
  project: string;
  inputs: Record<string, string>;
  json: boolean;
}

interface InspectArguments {
  operation: 'inspect_run';
  project: string;
  runId: string;
  json: boolean;
}

interface OperateArguments {
  operation: 'operate';
  project: string;
}

type ParsedArguments = ValidateArguments | CreateArguments | InspectArguments | OperateArguments;

function invalidOperationRequest(
  diagnostics: Array<{ code: string; path: string; message: string }>,
): OperationFailure {
  return {
    ok: false,
    failure: {
      kind: 'invalid',
      code: 'invalid_operation_request',
      message: 'The automation operation request is invalid.',
      diagnostics,
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

function stringifyMachineValue(value: unknown) {
  const json = JSON as typeof JSON & {
    rawJSON(text: string): unknown;
  };
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? json.rawJSON(item.toString()) : item,
  );
}

function parseArguments(args: string[]): ParsedArguments | undefined {
  const operation =
    args[0] === 'operate'
      ? 'operate'
      : args[0] === 'workflow' && args[1] === 'validate'
        ? 'validate_workflow'
        : args[0] === 'run' && args[1] === 'create'
          ? 'create_run'
          : args[0] === 'run' && args[1] === 'inspect'
            ? 'inspect_run'
            : undefined;
  if (operation === undefined) return undefined;

  let project: string | undefined;
  let runId: string | undefined;
  let json = false;
  const inputs: Record<string, string> = Object.create(null) as Record<string, string>;

  for (let index = operation === 'operate' ? 1 : 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--project') {
      const value = args[index + 1];
      if (
        project !== undefined ||
        value === undefined ||
        value.length === 0 ||
        value.startsWith('--')
      ) {
        return undefined;
      }
      project = value;
      index += 1;
    } else if (argument === '--json' && operation !== 'operate') {
      if (json) return undefined;
      json = true;
    } else if (argument === '--run' && operation === 'inspect_run') {
      const value = args[index + 1];
      if (
        runId !== undefined ||
        value === undefined ||
        value.length === 0 ||
        value.startsWith('--')
      ) {
        return undefined;
      }
      runId = value;
      index += 1;
    } else if (argument === '--input' && operation === 'create_run') {
      const value = args[index + 1];
      const separatorIndex = value?.indexOf('=') ?? -1;
      const inputId = value?.slice(0, separatorIndex);
      const inputPath = value?.slice(separatorIndex + 1);
      if (
        value === undefined ||
        separatorIndex <= 0 ||
        inputPath === undefined ||
        inputPath.length === 0 ||
        inputId === undefined ||
        Object.hasOwn(inputs, inputId)
      ) {
        return undefined;
      }
      inputs[inputId] = inputPath;
      index += 1;
    } else {
      return undefined;
    }
  }

  if (project === undefined) return undefined;
  if (operation === 'operate') return { operation, project };
  if (operation === 'validate_workflow') return { operation, project, json };
  if (operation === 'create_run') return { operation, project, inputs, json };
  return runId === undefined ? undefined : { operation, project, runId, json };
}

async function readStandardInput(limit: number) {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let exceeded = false;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += bytes.byteLength;
    if (byteLength > limit) {
      exceeded = true;
    } else if (!exceeded) {
      chunks.push(bytes);
    }
  }
  return exceeded ? undefined : Buffer.concat(chunks);
}

function writeMachineResult(operation: string, result: OperationResult<unknown>) {
  let effectiveResult = result;
  let envelope = effectiveResult.ok
    ? {
        schema_version: 'breakdown.cli-output.v1',
        operation,
        ok: true,
        data: effectiveResult.value,
      }
    : {
        schema_version: 'breakdown.cli-output.v1',
        operation,
        ok: false,
        error: effectiveResult.failure,
      };
  let output = `${stringifyMachineValue(envelope)}\n`;
  if (Buffer.byteLength(output, 'utf8') > FIXED_LIMITS.automation_response_bytes) {
    effectiveResult = resourceLimitFailure();
    envelope = {
      schema_version: 'breakdown.cli-output.v1',
      operation,
      ok: false,
      error: effectiveResult.failure,
    };
    output = `${stringifyMachineValue(envelope)}\n`;
  }
  process.stdout.write(output);
  return effectiveResult;
}

function escapeTerminalControls(value: string) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
        ? `\\u${codePoint.toString(16).padStart(4, '0')}`
        : character;
    })
    .join('');
}

function styleHuman(value: string, color: 31 | 32 | 33, stream: NodeJS.WriteStream) {
  return stream.isTTY && process.env.NO_COLOR === undefined
    ? `\u001b[${color}m${value}\u001b[0m`
    : value;
}

function writeHumanFailure(failure: OperationFailure['failure']) {
  const lines = [
    styleHuman(`${escapeTerminalControls(failure.message)}\n`, 31, process.stderr),
    ...failure.diagnostics.map((diagnostic) =>
      styleHuman(
        `${escapeTerminalControls(diagnostic.file ?? 'breakdown.yaml')}${escapeTerminalControls(diagnostic.path)}: ${escapeTerminalControls(diagnostic.code)}: ${escapeTerminalControls(diagnostic.message)}\n`,
        33,
        process.stderr,
      ),
    ),
  ];
  const truncationNotice = '[diagnostics truncated]\n';
  const noticeBytes = Buffer.byteLength(truncationNotice, 'utf8');
  let byteLength = 0;
  let output = '';
  let truncated = false;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (byteLength + lineBytes > HUMAN_STDERR_LIMIT_BYTES - noticeBytes) {
      truncated = true;
      break;
    }
    output += line;
    byteLength += lineBytes;
  }
  process.stderr.write(truncated ? `${output}${truncationNotice}` : output);
}

async function main(signal: AbortSignal) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(CLI_USAGE);
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(`${CLI_VERSION}\n`);
    return;
  }
  const parsed = parseArguments(args);
  if (parsed === undefined) {
    process.stderr.write(CLI_USAGE);
    process.exitCode = CLI_EXIT_CODES.usage;
    return;
  }

  const projectRoot = resolve(process.cwd(), parsed.project);

  if (parsed.operation === 'operate') {
    let request: unknown;
    const input = await readStandardInput(FIXED_LIMITS.automation_request_bytes);
    if (input === undefined) {
      const result = resourceLimitFailure();
      writeMachineResult('unknown', result);
      process.exitCode = CLI_EXIT_CODES[result.failure.kind];
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
      request = JSON.parse(text) as unknown;
    } catch {
      const result = invalidOperationRequest([
        {
          code: 'parse',
          path: '',
          message: 'The automation request is not strict JSON.',
        },
      ]);
      writeMachineResult('unknown', result);
      process.exitCode = CLI_EXIT_CODES[result.failure.kind];
      return;
    }
    if (!isRecord(request)) {
      const result = invalidOperationRequest([
        {
          code: 'schema',
          path: '',
          message: 'The automation request must be a JSON object.',
        },
      ]);
      writeMachineResult('unknown', result);
      process.exitCode = CLI_EXIT_CODES[result.failure.kind];
      return;
    }
    const operation = isOperation(request.operation) ? request.operation : 'unknown';
    if (
      typeof request.schema_version === 'string' &&
      request.schema_version !== OPERATION_REQUEST_SCHEMA_VERSION
    ) {
      const result = unsupportedOperationRequestFailure('unsupported_version');
      writeMachineResult(operation, result);
      process.exitCode = CLI_EXIT_CODES[result.failure.kind];
      return;
    }
    if (typeof request.operation === 'string' && !isOperation(request.operation)) {
      const result = unsupportedOperationRequestFailure('unsupported_operation');
      writeMachineResult('unknown', result);
      process.exitCode = CLI_EXIT_CODES[result.failure.kind];
      return;
    }
    const requestValidator =
      operation === 'unknown' ? validateOperationRequest : OPERATION_VALIDATORS[operation];
    if (!requestValidator(request)) {
      const result = invalidOperationRequest(operationRequestDiagnostics(requestValidator.errors));
      writeMachineResult(operation, result);
      process.exitCode = CLI_EXIT_CODES[result.failure.kind];
      return;
    }
    const operationRequest = request as unknown as OperationRequest;
    let result: OperationResult<unknown>;
    if (operationRequest.operation === 'validate_workflow') {
      result = await operate({ operation: 'validate_workflow' }, { projectRoot, signal });
    } else if (operationRequest.operation === 'create_run') {
      result = await operate(
        {
          operation: 'create_run',
          ...(operationRequest.inputs === undefined ? {} : { inputs: operationRequest.inputs }),
        },
        { projectRoot, signal },
      );
    } else if (operationRequest.operation === 'inspect_run') {
      result = await operate(
        { operation: 'inspect_run', run_id: operationRequest.run_id },
        { projectRoot, signal },
      );
    } else if (operationRequest.operation === 'prepare_work') {
      result = await operate(
        {
          operation: 'prepare_work',
          run_id: operationRequest.run_id,
          intent: operationRequest.mode.kind,
          ...(operationRequest.limit === undefined ? {} : { limit: operationRequest.limit }),
          ...(operationRequest.mode.kind === 'refresh'
            ? { node_id: operationRequest.mode.node_id }
            : {}),
        },
        { projectRoot, signal },
      );
    } else if (operationRequest.operation === 'read_work_input') {
      result = await operate(
        {
          operation: 'read_work_input',
          packet: operationRequest.packet,
          binding: operationRequest.binding,
        },
        { projectRoot, signal },
      );
    } else {
      result = await operate(
        {
          operation: 'submit_candidate',
          packet: operationRequest.packet,
          candidate: operationRequest.candidate,
          ...(operationRequest.lock_recovery === undefined
            ? {}
            : { lock_recovery: operationRequest.lock_recovery }),
        } as SubmitCandidateRequest,
        { projectRoot, signal },
      );
    }
    const emittedResult = writeMachineResult(operationRequest.operation, result);
    if (!emittedResult.ok) {
      process.exitCode = CLI_EXIT_CODES[emittedResult.failure.kind];
    }
    return;
  }

  const result = await (parsed.operation === 'validate_workflow'
    ? operate({ operation: 'validate_workflow' }, { projectRoot, signal })
    : parsed.operation === 'create_run'
      ? operate({ operation: 'create_run', inputs: parsed.inputs }, { projectRoot, signal })
      : operate({ operation: 'inspect_run', run_id: parsed.runId }, { projectRoot, signal }));
  if (parsed.json) {
    const emittedResult = writeMachineResult(parsed.operation, result);
    if (result.ok && !emittedResult.ok) {
      process.exitCode = CLI_EXIT_CODES[emittedResult.failure.kind];
      return;
    }
  } else if (result.ok) {
    if (parsed.operation === 'validate_workflow' && 'definitionPath' in result.value) {
      const nodeCount = result.value.workflow.nodes.length;
      const nodeLabel = nodeCount === 1 ? 'Node Definition' : 'Node Definitions';
      process.stdout.write(
        styleHuman(
          `Validated ${escapeTerminalControls(result.value.definitionPath)} (${nodeCount} ${nodeLabel}).\n`,
          32,
          process.stdout,
        ),
      );
    } else if ('run_id' in result.value) {
      if ('status' in result.value && 'nodes' in result.value) {
        const counts = {
          runnable: result.value.nodes.filter((node) => node.state === 'runnable').length,
          complete: result.value.nodes.filter((node) => node.state === 'complete').length,
          blocked: result.value.nodes.filter((node) => node.state === 'blocked').length,
        };
        process.stdout.write(
          styleHuman(
            `Inspected Run ${escapeTerminalControls(result.value.run_id)}: ${result.value.status} (${counts.runnable} runnable, ${counts.complete} complete, ${counts.blocked} blocked).\n`,
            32,
            process.stdout,
          ),
        );
      } else {
        process.stdout.write(
          styleHuman(
            `Created Run ${escapeTerminalControls(result.value.run_id)}.\n`,
            32,
            process.stdout,
          ),
        );
      }
    }
  } else {
    writeHumanFailure(result.failure);
  }

  if (!result.ok) {
    process.exitCode = CLI_EXIT_CODES[result.failure.kind];
  }
}

const invocation = new AbortController();
const cancelInvocation = () => invocation.abort();
process.once('SIGINT', cancelInvocation);
process.once('SIGTERM', cancelInvocation);
try {
  await main(invocation.signal);
} catch {
  process.stderr.write('Internal CLI failure.\n');
  process.exitCode = CLI_EXIT_CODES.internal;
} finally {
  process.off('SIGINT', cancelInvocation);
  process.off('SIGTERM', cancelInvocation);
}
