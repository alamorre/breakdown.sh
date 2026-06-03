import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThesisActor } from '@/lib/thesis-service/actor';
import { ThesisServiceError } from '@/lib/thesis-service/errors';

const { mockResolveHeadlessActor, mockCreateServerClient } = vi.hoisted(() => ({
  mockResolveHeadlessActor: vi.fn(),
  mockCreateServerClient: vi.fn(),
}));

vi.mock('@/lib/thesis-service/actor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/thesis-service/actor')>();
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

const readOnlyActor: ThesisActor = {
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
      new ThesisServiceError('unauthorized', 'Missing bearer token', 401),
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
    expect(body.result.serverInfo.name).toBe('breakdown-thesis-remote-mcp');

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
