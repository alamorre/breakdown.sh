import { beforeAll, describe, expect, it } from 'vitest';

let GET: typeof import('./route').GET;

function request() {
  return new Request('https://breakdown.example/openapi.json');
}

describe('/openapi.json', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  it('returns OpenAPI metadata for onboarding and bearer-authenticated headless routes', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.info.description).toContain('signed-in human must approve');
    expect(body.components.securitySchemes.bearerToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'bdk',
    });
    expect(body.components.schemas.ExternalStepWorkPacket.properties).toHaveProperty('node');
    expect(body.components.schemas.ExternalStepWorkPacket.properties).toHaveProperty('upstream');
    expect(body.components.schemas.ExternalStepWorkPacket.properties).toHaveProperty('submission');
    expect(body.paths['/api/headless/graphs'].get.security).toEqual([{ bearerToken: [] }]);
    expect(body.paths['/api/headless/external-runs/{runId}/next-step']).toBeDefined();
    expect(body.paths['/api/headless/external-runs/{runId}/steps/{stepId}/context']).toBeDefined();
    expect(body.paths['/api/integrations/agent-setup-sessions/{sessionId}/exchange']).toBeDefined();
  });
});
