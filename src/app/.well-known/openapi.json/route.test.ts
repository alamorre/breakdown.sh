import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/.well-known/openapi.json');
}

describe('/.well-known/openapi.json', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns the public OpenAPI document', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.servers).toEqual([{ url: 'https://breakdown.example' }]);
    expect(body.paths['/api/integrations/agent-setup-sessions']).toBeDefined();
    expect(body.paths['/api/headless/tools']).toBeDefined();
  });
});
