import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/api/headless/tools');
}

describe('/api/headless/tools discovery', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns JSON pointing agents to MCP tools/list instead of HTML 404', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      collectionEndpoint: false,
      mcp: {
        url: 'https://breakdown.example/api/mcp',
        transport: 'streamable-http',
        diagnosticTool: 'diagnose_breakdown_setup',
        listTools: {
          body: { method: 'tools/list' },
        },
      },
      onboarding: {
        codexDiagnosticsUrl: 'https://breakdown.example/api/integrations/codex/diagnostics',
      },
    });
  });
});
