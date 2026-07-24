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

const USAGE = 'Usage: breakdown workflow validate --project PATH [--json]\n';

interface ParsedArguments {
  project: string;
  json: boolean;
}

function parseArguments(args: string[]): ParsedArguments | undefined {
  if (args[0] !== 'workflow' || args[1] !== 'validate') {
    return undefined;
  }

  let project: string | undefined;
  let json = false;

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
    } else {
      return undefined;
    }
  }

  return project === undefined ? undefined : { project, json };
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

  const result = await operate({ operation: 'validate_workflow' }, { projectRoot });
  if (parsed.json) {
    const envelope = result.ok
      ? {
          schema_version: 'breakdown.cli-output.v1',
          operation: 'validate_workflow',
          ok: true,
          data: result.value,
        }
      : {
          schema_version: 'breakdown.cli-output.v1',
          operation: 'validate_workflow',
          ok: false,
          error: result.failure,
        };
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else if (result.ok) {
    const nodeCount = result.value.workflow.nodes.length;
    const nodeLabel = nodeCount === 1 ? 'Node Definition' : 'Node Definitions';
    process.stdout.write(`Validated ${result.value.definitionPath} (${nodeCount} ${nodeLabel}).\n`);
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
