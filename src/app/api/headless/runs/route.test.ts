import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/api/headless/runs');
}

describe('/api/headless/runs discovery', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns JSON explaining graph-scoped run routes instead of HTML 404', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error).toBeNull();
    expect(body.data.collectionEndpoint).toBe(false);
    expect(body.data.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/api/headless/graphs/{graphId}/run' }),
        expect.objectContaining({ path: '/api/headless/external-runs/{runId}/next-step' }),
        expect.objectContaining({
          path: '/api/headless/external-runs/{runId}/steps/{stepId}/context',
        }),
      ]),
    );
  });
});
