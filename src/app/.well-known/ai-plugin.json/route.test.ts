import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/.well-known/ai-plugin.json');
}

describe('/.well-known/ai-plugin.json', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns a public plugin manifest that links onboarding and OpenAPI metadata', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schema_version: 'v1',
      name_for_model: 'breakdown',
      auth: { type: 'service_http', authorization_type: 'bearer' },
      api: { type: 'openapi', url: 'https://breakdown.example/openapi.json' },
      onboarding_url: 'https://breakdown.example/api/integrations/headless-onboarding',
      human_approval: { required: true },
    });
  });
});
