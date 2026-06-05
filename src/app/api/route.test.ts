import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/api');
}

describe('/api discovery', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns public agent discovery metadata without auth', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.endpoints).toMatchObject({
      aiPluginManifestUrl: 'https://breakdown.example/.well-known/ai-plugin.json',
      openApiUrl: 'https://breakdown.example/openapi.json',
      onboardingUrl: 'https://breakdown.example/api/integrations/headless-onboarding',
      agentSetupSessionsUrl: 'https://breakdown.example/api/integrations/agent-setup-sessions',
      headlessApiBaseUrl: 'https://breakdown.example/api/headless',
      mcpUrl: 'https://breakdown.example/api/mcp',
    });
    expect(body.humanApproval).toMatchObject({
      required: true,
      exchangeBeforeApproval: { status: 409, code: 'conflict' },
    });
    expect(body.nextSteps).toContain(
      'POST /api/integrations/agent-setup-sessions to create an approval session',
    );
  });
});
