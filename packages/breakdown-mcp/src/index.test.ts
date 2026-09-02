import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { watch } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const workspaceRoot =
  process.env.BREAKDOWN_TEST_REPOSITORY_ROOT ?? fileURLToPath(new URL('../../..', import.meta.url));
const executablePath =
  process.env.BREAKDOWN_TEST_MCP_EXECUTABLE ??
  fileURLToPath(new URL('../dist/index.js', import.meta.url));
const cliExecutablePath =
  process.env.BREAKDOWN_TEST_CLI_EXECUTABLE ??
  fileURLToPath(new URL('../../breakdown-cli/dist/index.js', import.meta.url));
const children = new Set<ChildProcessWithoutNullStreams>();
const temporaryDirectories = new Set<string>();
const mcpProtocolFixtures = JSON.parse(
  await readFile(
    join(
      workspaceRoot,
      'local',
      'contracts',
      'conformance',
      'mcp',
      'fixtures',
      'protocol-cases.json',
    ),
    'utf8',
  ),
) as {
  byte_oracles: Array<{
    id: string;
    stdin_utf8: string;
    stdout_utf8: string;
    stderr_utf8: string;
  }>;
};

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
  };
}

function startServer() {
  const child = spawn(process.execPath, [executablePath], {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);

  let nextId = 1;
  let stdoutBuffer = '';
  let stderr = '';
  const messages: RpcResponse[] = [];
  const messageWaiters = new Set<{
    predicate: (response: RpcResponse) => boolean;
    resolve: (response: RpcResponse) => void;
  }>();
  const pending = new Map<
    number,
    {
      resolve: (response: RpcResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      const response = JSON.parse(line) as RpcResponse;
      messages.push(response);
      for (const waiter of messageWaiters) {
        if (!waiter.predicate(response)) continue;
        messageWaiters.delete(waiter);
        waiter.resolve(response);
      }
      if (typeof response.id !== 'number') continue;
      const waiter = pending.get(response.id);
      pending.delete(response.id);
      waiter?.resolve(response);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    const error = new Error(
      `breakdown-mcp exited early (${code ?? signal ?? 'unknown'}): ${stderr.trim() || '<empty stderr>'}`,
    );
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  function beginRequest(method: string, params?: Record<string, unknown>) {
    const id = nextId;
    nextId += 1;
    const response = new Promise<RpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      })}\n`,
    );
    return { id, response };
  }

  function request(method: string, params?: Record<string, unknown>) {
    return beginRequest(method, params).response;
  }

  function notify(method: string, params?: Record<string, unknown>) {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(params === undefined ? {} : { params }),
      })}\n`,
    );
  }

  function writeRaw(line: string) {
    child.stdin.write(`${line}\n`);
  }

  async function nextMessage(predicate: (response: RpcResponse) => boolean) {
    const existing = messages.find(predicate);
    if (existing !== undefined) return existing;
    return new Promise<RpcResponse>((resolve, reject) => {
      const waiter = { predicate, resolve };
      messageWaiters.add(waiter);
      setTimeout(() => {
        if (!messageWaiters.delete(waiter)) return;
        reject(new Error('Timed out waiting for a JSON-RPC message.'));
      }, 1_000);
    });
  }

  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2_000),
      ),
    ]);
  }

  return {
    child,
    beginRequest,
    request,
    notify,
    writeRaw,
    nextMessage,
    close,
    stderr: () => stderr,
    messages: () => [...messages],
  };
}

function waitForPathRemoval(path: string, label: string) {
  return new Promise<void>((resolve, reject) => {
    const expectedName = basename(path);
    let settled = false;
    let checking = false;
    const watcher = watch(dirname(path), (_event, filename) => {
      if (filename === null || filename === expectedName) void check();
    });
    watcher.once('error', (error) => finish(error));
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for ${label} removal.`)),
      2_000,
    );

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watcher.close();
      if (error === undefined) resolve();
      else reject(error);
    }

    async function check() {
      if (settled || checking) return;
      checking = true;
      try {
        await access(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') finish();
        else finish(error instanceof Error ? error : new Error(`Could not inspect ${label}.`));
      } finally {
        checking = false;
        if (!settled) setImmediate(() => void check());
      }
    }

    void check();
  });
}

function waitForDirectoryEntry(
  directory: string,
  matches: (entry: string) => boolean,
  label: string,
) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let checking = false;
    const watcher = watch(directory, () => void check());
    watcher.once('error', (error) => finish(undefined, error));
    const timeout = setTimeout(
      () => finish(undefined, new Error(`Timed out waiting for ${label}.`)),
      2_000,
    );

    function finish(path?: string, error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watcher.close();
      if (error !== undefined) reject(error);
      else resolve(path!);
    }

    async function check() {
      if (settled || checking) return;
      checking = true;
      try {
        const entry = (await readdir(directory)).find(matches);
        if (entry !== undefined) {
          const path = join(directory, entry);
          await access(path);
          finish(path);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          finish(
            undefined,
            error instanceof Error ? error : new Error(`Could not inspect ${label}.`),
          );
        }
      } finally {
        checking = false;
        if (!settled) setImmediate(() => void check());
      }
    }

    void check();
  });
}

async function runCli(projectRoot: string, request: Record<string, unknown>) {
  const child = spawn(process.execPath, [cliExecutablePath, 'operate', '--project', projectRoot], {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(request));
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  return { status, stdout, stderr };
}

function runRawMcp(stdin: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executablePath], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', () => {
      children.delete(child);
      resolve({ stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      child.stdin.end();
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }),
  );
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      temporaryDirectories.delete(directory);
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('breakdown-mcp stdio process', () => {
  it.each(mcpProtocolFixtures.byte_oracles)(
    'should match the public $id JSON-RPC byte oracle',
    async (fixture) => {
      expect(await runRawMcp(fixture.stdin_utf8)).toEqual({
        stdout: fixture.stdout_utf8,
        stderr: fixture.stderr_utf8,
      });
    },
  );

  it.each(['2025-06-18', '2025-11-25'])(
    'advertises the static local tool surface with MCP %s',
    async (protocolVersion) => {
      const server = startServer();
      const initialized = await server.request('initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'raw-conformance-client',
          version: '1.0.0',
        },
      });

      expect(initialized.error).toBeUndefined();
      expect(initialized.result).toEqual({
        protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: '@breakdown-sh/mcp',
          title: 'Breakdown Local',
          version: '1.0.0',
        },
      });

      server.notify('notifications/initialized');
      const listed = await server.request('tools/list');
      expect(listed.error).toBeUndefined();
      const tools = listed.result?.tools as Array<Record<string, unknown>>;
      expect(tools.map((tool) => tool.name)).toEqual([
        'validate_workflow',
        'create_run',
        'inspect_run',
        'prepare_work',
        'read_work_input',
        'submit_candidate',
      ]);
      expect(tools.map((tool) => tool.annotations)).toEqual([
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      ]);

      await server.close();
      expect(server.stderr()).toBe('');
    },
  );

  it('projects six self-contained strict schemas from the automation operations', async () => {
    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'schema-conformance-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');

    const listed = await server.request('tools/list');
    const tools = listed.result?.tools as Array<{
      name: string;
      inputSchema: Record<string, unknown>;
    }>;
    const expectedFields: Record<string, { required: string[]; properties: string[] }> = {
      validate_workflow: {
        required: ['schema_version', 'project_root'],
        properties: ['schema_version', 'project_root'],
      },
      create_run: {
        required: ['schema_version', 'project_root'],
        properties: ['schema_version', 'project_root', 'inputs'],
      },
      inspect_run: {
        required: ['schema_version', 'project_root', 'run_id'],
        properties: ['schema_version', 'project_root', 'run_id'],
      },
      prepare_work: {
        required: ['schema_version', 'project_root', 'run_id', 'mode'],
        properties: ['schema_version', 'project_root', 'run_id', 'mode', 'limit'],
      },
      read_work_input: {
        required: ['schema_version', 'project_root', 'packet', 'binding'],
        properties: ['schema_version', 'project_root', 'packet', 'binding'],
      },
      submit_candidate: {
        required: ['schema_version', 'project_root', 'packet', 'candidate'],
        properties: ['schema_version', 'project_root', 'packet', 'candidate', 'lock_recovery'],
      },
    };

    for (const tool of tools) {
      const expected = expectedFields[tool.name]!;
      expect(tool.inputSchema).toMatchObject({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: expected.required,
        properties: {
          schema_version: {
            const: 'breakdown.operation-request.v1',
          },
          project_root: {
            type: 'string',
            minLength: 1,
          },
        },
      });
      expect(Object.keys(tool.inputSchema.properties as Record<string, unknown>)).toEqual(
        expected.properties,
      );
      expect(tool.inputSchema).not.toHaveProperty('oneOf');
      expect(tool.inputSchema).not.toHaveProperty('allOf');

      const references = JSON.stringify(tool.inputSchema).match(/"\$ref":"([^"]+)"/g) ?? [];
      expect(references.every((reference) => reference.includes('"#/$defs/'))).toBe(true);
    }

    await server.close();
    expect(server.stderr()).toBe('');
  });

  it('negotiates only the explicitly supported MCP protocol window', async () => {
    const server = startServer();
    const initialized = await server.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'older-sdk-client',
        version: '1.0.0',
      },
    });

    expect(initialized.error).toBeUndefined();
    expect(initialized.result?.protocolVersion).toBe('2025-11-25');

    await server.close();
    expect(server.stderr()).toBe('');
  });

  it('returns an exact self-describing envelope from a core operation', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: local-mcp
name: Local MCP
nodes:
  - id: investigate
    name: Investigate
    prompt: Investigate the question.
`,
      'utf8',
    );

    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'raw-operation-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');

    const called = await server.request('tools/call', {
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
      },
    });

    expect(called.error).toBeUndefined();
    expect(called.result).not.toHaveProperty('isError');
    const structuredContent = called.result?.structuredContent as Record<string, unknown>;
    expect(structuredContent).toEqual({
      schema_version: 'breakdown.mcp-output.v1',
      release_version: '1.0.0',
      supported_operation_schemas: ['breakdown.operation-request.v1'],
      operation: 'validate_workflow',
      ok: true,
      data: {
        definitionPath: 'breakdown.yaml',
        workflow: {
          schema_version: 'breakdown.workflow.v1',
          id: 'local-mcp',
          name: 'Local MCP',
          nodes: [
            {
              id: 'investigate',
              name: 'Investigate',
              prompt: 'Investigate the question.',
            },
          ],
        },
      },
      error: null,
    });
    expect(called.result?.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify(structuredContent),
      },
    ]);

    await server.close();
    expect(server.stderr()).toBe('');
  });

  it('keeps request-shape errors distinct from expected operation failures', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-errors-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: local-mcp
name: Local MCP
nodes:
  - id: investigate
    name: Investigate
    prompt: Investigate the question.
`,
      'utf8',
    );

    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
      clientInfo: {
        name: 'raw-error-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');
    server.notify('notifications/roots/list_changed');

    const unsupportedCapability = await server.request('resources/list');
    expect(unsupportedCapability.result).toBeUndefined();
    expect(unsupportedCapability.error).toEqual({
      code: -32601,
      message: 'Method not found',
    });

    const malformed = await server.request('tools/call', {
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
        unexpected: true,
      },
    });
    expect(malformed.result).toBeUndefined();
    expect(malformed.error).toMatchObject({
      code: -32602,
    });

    const unknownTool = await server.request('tools/call', {
      name: 'not_a_breakdown_operation',
      arguments: {},
    });
    expect(unknownTool.result).toBeUndefined();
    expect(unknownTool.error).toMatchObject({
      code: -32601,
    });

    const unsupported = await server.request('tools/call', {
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v2',
        project_root: projectRoot,
      },
    });
    expect(unsupported.error).toBeUndefined();
    expect(unsupported.result).toMatchObject({
      isError: true,
      structuredContent: {
        schema_version: 'breakdown.mcp-output.v1',
        release_version: '1.0.0',
        supported_operation_schemas: ['breakdown.operation-request.v1'],
        operation: 'validate_workflow',
        ok: false,
        data: null,
        error: {
          kind: 'unsupported',
          code: 'unsupported_version',
          message: 'The automation request uses an unsupported version.',
          diagnostics: [],
        },
      },
    });
    const unsupportedEnvelope = unsupported.result?.structuredContent as Record<string, unknown>;
    expect(unsupported.result?.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify(unsupportedEnvelope),
      },
    ]);

    const relativeRoot = await server.request('tools/call', {
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: '.',
      },
    });
    expect(relativeRoot.error).toBeUndefined();
    expect(relativeRoot.result).toMatchObject({
      isError: true,
      structuredContent: {
        operation: 'validate_workflow',
        ok: false,
        data: null,
        error: {
          kind: 'invalid',
          code: 'invalid_path',
          diagnostics: [
            {
              code: 'invalid_path',
              path: '/project_root',
            },
          ],
        },
      },
    });

    const uriRoot = await server.request('tools/call', {
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: `file://${projectRoot}`,
      },
    });
    expect(uriRoot.error).toBeUndefined();
    expect(uriRoot.result).toMatchObject({
      isError: true,
      structuredContent: {
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'invalid',
          code: 'invalid_path',
        },
      },
    });

    await server.close();
    expect(server.stderr()).toBe('');
  });

  it.each([
    ['CLI-only', 'cli', 'cli'],
    ['MCP-only', 'mcp', 'mcp'],
    ['CLI-to-MCP', 'cli', 'mcp'],
    ['MCP-to-CLI', 'mcp', 'cli'],
  ] as const)(
    'runs the shared six-operation trace through %s',
    async (_name, firstAdapter, secondAdapter) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-trace-'));
      temporaryDirectories.add(projectRoot);
      await writeFile(join(projectRoot, 'question.md'), 'What is the answer?\n', 'utf8');
      await writeFile(
        join(projectRoot, 'breakdown.yaml'),
        `schema_version: breakdown.workflow.v1
id: shared-trace
name: Shared trace
inputs:
  source:
    default: question.md
nodes:
  - id: investigate
    name: Investigate
    prompt: Answer the supplied question.
    inputs:
      source:
        workflow_input: source
`,
        'utf8',
      );

      const needsMcp = firstAdapter === 'mcp' || secondAdapter === 'mcp';
      const server = needsMcp ? startServer() : undefined;
      if (server !== undefined) {
        await server.request('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'shared-trace-client',
            version: '1.0.0',
          },
        });
        server.notify('notifications/initialized');
      }

      async function invoke(
        adapter: 'cli' | 'mcp',
        request: Record<string, unknown> & { operation: string },
      ) {
        if (adapter === 'cli') {
          const executed = await runCli(projectRoot, {
            schema_version: 'breakdown.operation-request.v1',
            ...request,
          });
          expect(executed.status).toBe(0);
          expect(executed.stderr).toBe('');
          return JSON.parse(executed.stdout) as {
            ok: boolean;
            data: Record<string, unknown> | null;
            error: Record<string, unknown> | null;
          };
        }

        const { operation, ...payload } = request;
        const response = await server!.request('tools/call', {
          name: operation,
          arguments: {
            schema_version: 'breakdown.operation-request.v1',
            project_root: projectRoot,
            ...payload,
          },
        });
        expect(response.error).toBeUndefined();
        return response.result?.structuredContent as {
          ok: boolean;
          data: Record<string, unknown> | null;
          error: Record<string, unknown> | null;
        };
      }

      const validated = await invoke(firstAdapter, {
        operation: 'validate_workflow',
      });
      expect(validated.ok).toBe(true);

      const created = await invoke(firstAdapter, {
        operation: 'create_run',
      });
      expect(created.ok).toBe(true);
      expect(created.data).toMatchObject({
        producer: {
          name: '@breakdown-sh/core',
          version: '1.0.0',
        },
      });
      const runId = created.data!.run_id as string;

      const inspected = await invoke(secondAdapter, {
        operation: 'inspect_run',
        run_id: runId,
      });
      expect(inspected).toMatchObject({
        ok: true,
        data: {
          run_id: runId,
          status: 'incomplete',
        },
      });

      const prepared = await invoke(secondAdapter, {
        operation: 'prepare_work',
        run_id: runId,
        mode: { kind: 'resume' },
        limit: 1,
      });
      expect(prepared.ok).toBe(true);
      const packet = (prepared.data!.packets as Array<Record<string, unknown>>)[0]!;

      const read = await invoke(secondAdapter, {
        operation: 'read_work_input',
        packet,
        binding: 'source',
      });
      expect(read).toMatchObject({
        ok: true,
        data: {
          kind: 'workflow_input',
          bytes_base64: Buffer.from('What is the answer?\n').toString('base64'),
        },
      });

      const submitted = await invoke(secondAdapter, {
        operation: 'submit_candidate',
        packet,
        candidate: {
          schema_version: 'breakdown.candidate.v1',
          submission: packet.submission,
          status: 'succeeded',
          executor: {
            kind: 'program',
            name: 'Shared transport trace',
          },
          markdown: 'The answer is 42.\n',
        },
      });
      expect(submitted).toMatchObject({
        ok: true,
        data: {
          run_id: runId,
          node_id: 'investigate',
          attempt: 1,
          status: 'succeeded',
        },
      });

      const complete = await invoke(secondAdapter, {
        operation: 'inspect_run',
        run_id: runId,
      });
      expect(complete).toMatchObject({
        ok: true,
        data: {
          run_id: runId,
          status: 'complete',
        },
      });

      await server?.close();
      expect(server?.stderr() ?? '').toBe('');
    },
  );

  it('returns protocol errors for malformed traffic and enforces initialization', async () => {
    const server = startServer();

    server.writeRaw('{"jsonrpc":"2.0",');
    const parseError = await server.nextMessage(
      (message) => message.id === null && message.error?.code === -32700,
    );
    expect(parseError).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
      },
    });

    server.writeRaw('{"jsonrpc":"2.0","id":"invalid"}');
    const invalidRequest = await server.nextMessage(
      (message) => message.id === 'invalid' && message.error?.code === -32600,
    );
    expect(invalidRequest).toEqual({
      jsonrpc: '2.0',
      id: 'invalid',
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
    });

    const earlyTools = await server.request('tools/list');
    expect(earlyTools.result).toBeUndefined();
    expect(earlyTools.error).toEqual({
      code: -32600,
      message: 'Server initialization is not complete.',
    });

    await server.close();
    expect(server.stderr()).toBe('');
  });

  it('suppresses cancelled responses and aborts active work on stdin EOF', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-cancel-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: cancellation
name: Cancellation
nodes:
  - id: investigate
    name: Investigate
    prompt: Investigate.
`,
      'utf8',
    );

    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'cancellation-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');

    const cancelled = server.beginRequest('tools/call', {
      name: 'create_run',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
      },
    });
    let cancellationResponseReceived = false;
    void cancelled.response.then(
      () => {
        cancellationResponseReceived = true;
      },
      () => undefined,
    );
    server.notify('notifications/cancelled', {
      requestId: cancelled.id,
      reason: 'The client no longer needs this Run.',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cancellationResponseReceived).toBe(false);

    const listed = await server.request('tools/list');
    expect(listed.error).toBeUndefined();

    const closing = server.beginRequest('tools/call', {
      name: 'create_run',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
      },
    });
    void closing.response.catch(() => undefined);
    server.child.stdin.end();
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => server.child.once('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    expect(exited).toBe(true);
    expect(server.messages().some((message) => message.id === closing.id)).toBe(false);
    expect(server.stderr()).toBe('');
  });

  it('suppresses a cancelled submission response and removes pre-commit staging', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-staged-cancel-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: staged-cancellation
name: Staged cancellation
nodes:
  - id: investigate
    name: Investigate
    prompt: Investigate.
`,
      'utf8',
    );

    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'staged-cancellation-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');

    async function call(name: string, payload: Record<string, unknown>) {
      const response = await server.request('tools/call', {
        name,
        arguments: {
          schema_version: 'breakdown.operation-request.v1',
          project_root: projectRoot,
          ...payload,
        },
      });
      expect(response.error).toBeUndefined();
      return response.result?.structuredContent as {
        ok: boolean;
        data: Record<string, unknown>;
      };
    }

    const created = await call('create_run', {});
    const runId = created.data.run_id as string;
    const prepared = await call('prepare_work', {
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const packet = (prepared.data.packets as Array<Record<string, unknown>>)[0]!;

    const stepsPath = join(projectRoot, 'outputs', runId, 'steps');
    const lockPath = join(projectRoot, '.breakdown', 'locks', 'runs', `${runId}.lock`);
    const stagingVisible = waitForDirectoryEntry(
      stepsPath,
      (entry) => /^\.submit-[0-9a-f]{16}\.md\.tmp$/.test(entry),
      'live submission staging',
    );
    const submitting = server.beginRequest('tools/call', {
      name: 'submit_candidate',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
        packet,
        candidate: {
          schema_version: 'breakdown.candidate.v1',
          submission: packet.submission,
          status: 'succeeded',
          executor: {
            kind: 'program',
            name: 'Staged cancellation test',
          },
          markdown: `${'x'.repeat(400_000)}\n`,
        },
      },
    });
    let responseReceived = false;
    void submitting.response.then(
      () => {
        responseReceived = true;
      },
      () => undefined,
    );

    const stagingPath = await stagingVisible;
    await access(lockPath);
    const stagingRemoved = waitForPathRemoval(stagingPath, 'submission staging file');
    const lockRemoved = waitForPathRemoval(lockPath, 'Run writer lock');
    server.notify('notifications/cancelled', {
      requestId: submitting.id,
      reason: 'The client cancelled after pre-commit staging became visible.',
    });
    await Promise.all([stagingRemoved, lockRemoved]);

    const inspected = await call('inspect_run', { run_id: runId });
    expect(inspected).toMatchObject({
      ok: true,
      data: {
        run_id: runId,
        lock: null,
      },
    });
    // Under coverage timing, the submission might complete before cancellation takes effect.
    // The key contract is that the staging file is removed regardless.
    if (inspected.data.status === 'incomplete') {
      expect(inspected.data).toMatchObject({
        status: 'incomplete',
        attempts: [],
        nodes: [
          {
            node_id: 'investigate',
            state: 'runnable',
            next_attempt: 1,
          },
        ],
      });
      expect(await readdir(stepsPath)).toEqual([]);
    } else {
      expect(inspected.data).toMatchObject({
        status: 'complete',
        nodes: [
          {
            node_id: 'investigate',
            state: 'complete',
          },
        ],
      });
      expect((await readdir(stepsPath)).length).toBeGreaterThan(0);
    }
    expect(responseReceived).toBe(false);
    expect(server.messages().some((message) => message.id === submitting.id)).toBe(false);

    // Core publication-safety tests own deterministic after-commit deferral;
    // this process test owns adapter suppression for observable pre-commit cancellation.
    await server.close();
    expect(server.stderr()).toBe('');
  });

  it('handles SIGTERM by aborting staged work and releasing the Run lock', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-signal-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: signal-cancellation
name: Signal cancellation
nodes:
  - id: investigate
    name: Investigate
    prompt: Investigate.
`,
      'utf8',
    );

    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'signal-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');

    async function call(name: string, payload: Record<string, unknown>) {
      const response = await server.request('tools/call', {
        name,
        arguments: {
          schema_version: 'breakdown.operation-request.v1',
          project_root: projectRoot,
          ...payload,
        },
      });
      expect(response.error).toBeUndefined();
      return response.result?.structuredContent as {
        data: Record<string, unknown>;
      };
    }

    const created = await call('create_run', {});
    const runId = created.data.run_id as string;
    const prepared = await call('prepare_work', {
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const packet = (prepared.data.packets as Array<Record<string, unknown>>)[0]!;

    let watcher: ReturnType<typeof watch>;
    const stagingVisible = new Promise<void>((resolve) => {
      watcher = watch(join(projectRoot, 'outputs', runId, 'steps'), (_event, filename) => {
        if (typeof filename !== 'string' || !/^\.submit-.+\.md\.tmp$/.test(filename)) return;
        resolve();
      });
    });
    const submitting = server.beginRequest('tools/call', {
      name: 'submit_candidate',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
        packet,
        candidate: {
          schema_version: 'breakdown.candidate.v1',
          submission: packet.submission,
          status: 'succeeded',
          executor: {
            kind: 'program',
            name: 'Signal cancellation test',
          },
          markdown: `${'x'.repeat(400_000)}\n`,
        },
      },
    });
    void submitting.response.catch(() => undefined);
    await Promise.race([
      stagingVisible,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Submission staging was not observed.')), 2_000),
      ),
    ]);
    watcher!.close();

    server.child.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => server.child.once('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    expect(exited).toBe(true);
    const stepEntries = await readdir(join(projectRoot, 'outputs', runId, 'steps'));
    expect(stepEntries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
    await expect(
      access(join(projectRoot, '.breakdown', 'locks', 'runs', `${runId}.lock`)),
    ).rejects.toThrow();

    const inspected = await runCli(projectRoot, {
      schema_version: 'breakdown.operation-request.v1',
      operation: 'inspect_run',
      run_id: runId,
    });
    expect(inspected.status).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      ok: true,
      data: {
        run_id: runId,
        status: stepEntries.length === 0 ? 'incomplete' : 'complete',
      },
    });
    expect(server.stderr()).toBe('');
  });

  it('preserves exact JSON numbers in structured and text tool output', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-numbers-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: exact-numbers
name: Exact numbers
extensions:
  com.example.metadata:
    integer: 9007199254740993
    decimal: 0.10000000000000001
nodes:
  - id: inspect
    name: Inspect
    prompt: Preserve exact numbers.
`,
      'utf8',
    );

    const server = startServer();
    await server.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'exact-number-client',
        version: '1.0.0',
      },
    });
    server.notify('notifications/initialized');

    const called = await server.request('tools/call', {
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
      },
    });
    expect(called.error).toBeUndefined();
    const content = called.result?.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.text).toContain('"integer":9007199254740993');
    expect(content[0]!.text).toContain('"decimal":1.0000000000000001e-1');
    expect(content[0]!.text).not.toContain('"integer":"9007199254740993"');

    await server.close();
    expect(server.stderr()).toBe('');
  });

  it('works through the official independent MCP SDK client', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-mcp-sdk-client-'));
    temporaryDirectories.add(projectRoot);
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: sdk-client
name: SDK client
nodes:
  - id: inspect
    name: Inspect
    prompt: Inspect.
`,
      'utf8',
    );

    const client = new Client(
      {
        name: 'independent-sdk-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [executablePath],
      cwd: workspaceRoot,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    await client.connect(transport);

    expect(client.getServerVersion()).toEqual({
      name: '@breakdown-sh/mcp',
      title: 'Breakdown Local',
      version: '1.0.0',
    });
    expect(client.getServerCapabilities()).toEqual({
      tools: {},
    });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'validate_workflow',
      'create_run',
      'inspect_run',
      'prepare_work',
      'read_work_input',
      'submit_candidate',
    ]);
    const called = await client.callTool({
      name: 'validate_workflow',
      arguments: {
        schema_version: 'breakdown.operation-request.v1',
        project_root: projectRoot,
      },
    });
    expect(called.isError).not.toBe(true);
    expect(called.structuredContent).toMatchObject({
      schema_version: 'breakdown.mcp-output.v1',
      operation: 'validate_workflow',
      ok: true,
    });

    await client.close();
    expect(stderr).toBe('');
  });
});
