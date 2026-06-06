import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/api/headless');
}

describe('/api/headless discovery', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns a headless envelope with endpoint and auth metadata', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      baseUrl: 'https://breakdown.example/api/headless',
      authentication: {
        type: 'bearer',
        header: 'Authorization: Bearer <bdk_token>',
      },
      onboarding: {
        metadataUrl: 'https://breakdown.example/api/integrations/headless-onboarding',
        setupSessionsUrl: 'https://breakdown.example/api/integrations/agent-setup-sessions',
      },
    });
    expect(body.data.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/headless/graphs' }),
        expect.objectContaining({
          method: 'GET',
          path: '/api/headless/external-runs/{runId}/steps/{stepId}/context',
        }),
        expect.objectContaining({ method: 'POST', path: '/api/headless/workflows/import-and-run' }),
      ]),
    );
  });
});
