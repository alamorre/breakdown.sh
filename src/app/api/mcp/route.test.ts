import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from '@/lib/breakdown-service/actor';
import { BreakdownServiceError } from '@/lib/breakdown-service/errors';

const { mockResolveHeadlessActor, mockCreateServerClient } = vi.hoisted(() => ({
  mockResolveHeadlessActor: vi.fn(),
  mockCreateServerClient: vi.fn(),
}));

vi.mock('@/lib/breakdown-service/actor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/breakdown-service/actor')>();
  return {
    ...original,
    resolveHeadlessActor: mockResolveHeadlessActor,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

let OPTIONS: typeof import('./route').OPTIONS;
let POST: typeof import('./route').POST;

const readOnlyActor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
  tokenName: 'Local MCP',
  scopes: ['graphs:read'],
};

const graphRows = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user_123',
    name: 'Remote MCP Smoke Graph',
    description: null,
    llm_provider: null,
    llm_model: null,
    created_at: '2026-06-03T00:00:00.000Z',
    updated_at: '2026-06-03T00:00:00.000Z',
  },
];

const requiredHeadlessTools = [
  'list_graphs',
  'get_graph',
  'create_graph',
  'update_graph',
  'delete_graph',
  'create_node',
  'update_node',
  'delete_node',
  'connect_nodes',
  'update_edge',
  'delete_edge',
  'export_graph',
  'import_graph',
  'import_graph_and_create_external_run',
  'get_workflow_manifest',
  'apply_graph_patch',
  'run_node',
  'run_graph',
  'get_run_status',
  'cancel_run',
  'create_external_run',
  'get_next_step',
  'get_step_context',
  'submit_step_result',
  'mark_step_blocked',
  'finalize_external_run',
  'summarize_run_delta',
];

const requiredResourceTemplates = [
  'graph',
  'graph_manifest',
  'graph_node',
  'graph_run_status',
  'external_run',
  'external_run_step',
];

const requiredPrompts = [
  'decompose_reasoning_chain',
  'follow_breakdown_graph',
  'extend_graph_from_research',
  'refresh_sources_and_propagate',
  'summarize_graph_delta',
];

interface McpToolListEntry {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

function createMockSupabase() {
  const graphsOrder = vi.fn().mockResolvedValue({ data: graphRows, error: null });
  const graphsEq = vi.fn(() => ({ order: graphsOrder }));
  const graphsSelect = vi.fn(() => ({ eq: graphsEq }));
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    from: vi.fn((table: string) => {
      if (table === 'graphs') {
        return {
          select: graphsSelect,
          insert,
        };
      }

      return {
        insert,
      };
    }),
  };
}

function mcpRequest(body: unknown, token = 'bdk_test_secret') {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function postRpc(body: unknown) {
  const response = await POST(mcpRequest(body));
  return {
    response,
    body: await response.json(),
  };
}

describe('/api/mcp Streamable HTTP route', () => {
  beforeAll(async () => {
    const route = await import('./route');
    OPTIONS = route.OPTIONS;
    POST = route.POST;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHeadlessActor.mockResolvedValue(readOnlyActor);
    mockCreateServerClient.mockReturnValue(createMockSupabase());
  });

  it('responds to CORS preflight for hosted MCP clients', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('fails closed when bearer authentication is missing or invalid', async () => {
    mockResolveHeadlessActor.mockRejectedValue(
      new BreakdownServiceError('unauthorized', 'Missing bearer token', 401),
    );

    const response = await POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect(body.error.message).toBe('Missing bearer token');
  });

  it('starts the official Streamable HTTP transport and lists remote-safe tools', async () => {
    const { response, body } = await postRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '0.0.0' },
      },
    });

    expect(response.status).toBe(200);
    expect(body.result.serverInfo.name).toBe('breakdown-remote-mcp');

    const tools = await postRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    expect(tools.response.status).toBe(200);
    expect(tools.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['list_graphs', 'get_graph', 'create_graph', 'submit_step_result']),
    );
    expect(
      tools.body.result.tools.find((tool: { name: string }) => tool.name === 'delete_graph')
        .annotations.destructiveHint,
    ).toBe(true);
  });

  it('advertises complete tool schemas, scope metadata, and safety annotations', async () => {
    const { body } = await postRpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/list',
      params: {},
    });
    const tools = body.result.tools as McpToolListEntry[];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(requiredHeadlessTools));
    for (const toolName of requiredHeadlessTools) {
      expect(byName.get(toolName)?.inputSchema).toBeTruthy();
    }

    expect(byName.get('list_graphs')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('delete_graph')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('apply_graph_patch')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('run_graph')?.annotations?.openWorldHint).toBe(true);

    expect(byName.get('apply_graph_patch')?._meta?.['breakdown/requiredScope']).toBe(
      'graphs:write',
    );
    expect(
      byName.get('import_graph_and_create_external_run')?._meta?.['breakdown/requiredScope'],
    ).toEqual(['graphs:write', 'runs:external_execute']);

    const submitProperties = byName.get('submit_step_result')?.inputSchema?.properties ?? {};
    expect(submitProperties).toHaveProperty('runId');
    expect(submitProperties).toHaveProperty('stepId');
    expect(submitProperties).toHaveProperty('contextVersion');
    expect(submitProperties).toHaveProperty('output');
  });

  it('advertises graph resources, resource templates, and workflow prompts', async () => {
    const resources = await postRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/list',
      params: {},
    });
    const resourceTemplates = await postRpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/templates/list',
      params: {},
    });
    const prompts = await postRpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'prompts/list',
      params: {},
    });

    expect(resources.response.status).toBe(200);
    expect(
      resources.body.result.resources.map((resource: { name: string }) => resource.name),
    ).toEqual(expect.arrayContaining(['graphs']));

    expect(resourceTemplates.response.status).toBe(200);
    expect(
      resourceTemplates.body.result.resourceTemplates.map(
        (resourceTemplate: { name: string }) => resourceTemplate.name,
      ),
    ).toEqual(expect.arrayContaining(requiredResourceTemplates));

    expect(prompts.response.status).toBe(200);
    expect(prompts.body.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual(
      expect.arrayContaining(requiredPrompts),
    );
  });

  it('calls a read-only tool with bearer-token actor context', async () => {
    const { response, body } = await postRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'list_graphs',
        arguments: {},
      },
    });

    expect(response.status).toBe(200);
    expect(body.result.isError).not.toBe(true);
    expect(JSON.parse(body.result.content[0].text)).toEqual(graphRows);
  });

  it('prevents under-scoped write tools from mutating data', async () => {
    const { response, body } = await postRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'create_graph',
        arguments: { name: 'Should not create' },
      },
    });

    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Missing required scope: graphs:write');
  });
});
