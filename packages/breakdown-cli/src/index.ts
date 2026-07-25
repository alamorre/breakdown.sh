#!/usr/bin/env node

import { resolve } from 'node:path';

import { operate } from '@breakdown-sh/core';

const EXIT_BY_FAILURE_KIND = {
  invalid: 3,
  conflict: 4,
  unsupported: 5,
  cancelled: 6,
  resource_limit: 7,
  io: 8,
  internal: 70,
} as const;

const USAGE = `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
`;

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

type ParsedArguments = ValidateArguments | CreateArguments;

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
    args[0] === 'workflow' && args[1] === 'validate'
      ? 'validate_workflow'
      : args[0] === 'run' && args[1] === 'create'
        ? 'create_run'
        : undefined;
  if (operation === undefined) return undefined;

  let project: string | undefined;
  let json = false;
  const inputs: Record<string, string> = Object.create(null) as Record<string, string>;

  for (let index = 2; index < args.length; index += 1) {
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
    } else if (argument === '--json') {
      if (json) return undefined;
      json = true;
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
  return operation === 'validate_workflow'
    ? { operation, project, json }
    : { operation, project, inputs, json };
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArguments(args);
  if (parsed === undefined) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const projectRoot = resolve(process.cwd(), parsed.project);

  const result =
    parsed.operation === 'validate_workflow'
      ? await operate({ operation: 'validate_workflow' }, { projectRoot })
      : await operate(
          { operation: 'create_run', inputs: parsed.inputs },
          {
            projectRoot,
            producer: {
              name: '@breakdown-sh/cli',
              version: '1.0.0-beta.1',
            },
          },
        );
  if (parsed.json) {
    const envelope = result.ok
      ? {
          schema_version: 'breakdown.cli-output.v1',
          operation: parsed.operation,
          ok: true,
          data: result.value,
        }
      : {
          schema_version: 'breakdown.cli-output.v1',
          operation: parsed.operation,
          ok: false,
          error: result.failure,
        };
    process.stdout.write(`${stringifyMachineValue(envelope)}\n`);
  } else if (result.ok) {
    if (parsed.operation === 'validate_workflow' && 'definitionPath' in result.value) {
      const nodeCount = result.value.workflow.nodes.length;
      const nodeLabel = nodeCount === 1 ? 'Node Definition' : 'Node Definitions';
      process.stdout.write(
        `Validated ${result.value.definitionPath} (${nodeCount} ${nodeLabel}).\n`,
      );
    } else if ('run_id' in result.value) {
      process.stdout.write(`Created Run ${result.value.run_id}.\n`);
    }
  } else {
    process.stderr.write(`${result.failure.message}\n`);
    for (const diagnostic of result.failure.diagnostics) {
      process.stderr.write(
        `${diagnostic.file ?? 'breakdown.yaml'}${diagnostic.path}: ${diagnostic.code}: ${diagnostic.message}\n`,
      );
    }
  }

  if (!result.ok) {
    process.exitCode = EXIT_BY_FAILURE_KIND[result.failure.kind];
  }
}

await main();
