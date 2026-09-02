import { describe, expect, it, vi } from 'vitest';

import { GitHubReleaseAdapter } from './github-release-adapter.mjs';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub release adapter', () => {
  it('uses the versioned dispatch response and keeps credentials out of errors', async () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        workflow_run_id: 9900208,
        run_url: 'https://api.github.com/repos/alamorre/breakdown.sh/actions/runs/9900208',
        html_url: 'https://github.com/alamorre/breakdown.sh/actions/runs/9900208',
      }),
    );
    const adapter = new GitHubReleaseAdapter({
      token,
      repository: 'alamorre/breakdown.sh',
      fetchImplementation,
    });
    await expect(
      adapter.dispatchWorkflow(323419480, { ref: 'main', inputs: { exact: 'value' } }),
    ).resolves.toMatchObject({ workflow_run_id: 9900208 });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.github.com/repos/alamorre/breakdown.sh/actions/workflows/323419480/dispatches',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
        }),
      }),
    );

    fetchImplementation.mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, 403));
    await expect(adapter.getRun('1')).rejects.not.toThrow(token);
  });

  it('treats only explicit public 404 responses as absent', async () => {
    const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/releases/tags/')) return jsonResponse({ message: 'Not Found' }, 404);
      return jsonResponse({ error: 'Not found' }, 404);
    });
    const adapter = new GitHubReleaseAdapter({
      token: 'test-token',
      repository: 'alamorre/breakdown.sh',
      fetchImplementation,
    });
    await expect(adapter.readPublicState()).resolves.toMatchObject({
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'absent', http_status: 404 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    });

    fetchImplementation.mockImplementation(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/releases/tags/')) return jsonResponse({ message: 'Server error' }, 500);
      return jsonResponse({ error: 'Not found' }, 404);
    });
    await expect(adapter.readPublicState()).resolves.toMatchObject({
      github_release: { status: 'indeterminate', http_status: 0 },
    });
  });

  it('returns status codes for deployment-branch-policy operations including 403', async () => {
    const fetchImplementation = vi.fn(
      async (url: string | URL | Request, options?: RequestInit) => {
        const value = String(url);
        const method = options?.method ?? 'GET';
        if (value.includes('deployment-branch-policies')) {
          if (method === 'DELETE') {
            return new Response(JSON.stringify({ message: 'Resource not accessible' }), {
              status: 403,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (method === 'POST') {
            return new Response(JSON.stringify({ message: 'Resource not accessible' }), {
              status: 403,
              headers: { 'content-type': 'application/json' },
            });
          }
        }
        return jsonResponse({}, 200);
      },
    );
    const adapter = new GitHubReleaseAdapter({
      token: 'test-token',
      repository: 'alamorre/breakdown.sh',
      fetchImplementation,
    });

    await expect(adapter.deletePolicy(58863256)).resolves.toMatchObject({ status: 403 });
    await expect(adapter.createPolicy({ name: 'main', type: 'branch' })).resolves.toMatchObject({
      status: 403,
    });
  });
});
