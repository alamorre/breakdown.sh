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

  it('lists run artifacts from GitHub Actions', async () => {
    const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/actions/runs/123/artifacts')) {
        return jsonResponse({
          total_count: 2,
          artifacts: [
            {
              id: 456,
              name: 'breakdown-npm-first-package-bootstrap',
              expired: false,
              size_in_bytes: 1024,
            },
            {
              id: 789,
              name: 'other-artifact',
              expired: true,
              size_in_bytes: 2048,
            },
          ],
        });
      }
      return jsonResponse({}, 200);
    });
    const adapter = new GitHubReleaseAdapter({
      token: 'test-token',
      repository: 'alamorre/breakdown.sh',
      fetchImplementation,
    });

    const artifacts = await adapter.listRunArtifacts('123');
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      id: 456,
      name: 'breakdown-npm-first-package-bootstrap',
      expired: false,
    });
  });

  it('verifies package sha256s from npm registry', async () => {
    const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('registry.npmjs.org/@breakdown-sh%2Fcore/1.0.0')) {
        return jsonResponse({
          name: '@breakdown-sh/core',
          version: '1.0.0',
          dist: {
            integrity: 'sha256-FQD9Wps3Y23yPy46E8ZPBCK05WuOe0Nwf0PEKhDHOZQ=',
            tarball: 'https://registry.npmjs.org/@breakdown-sh/core/-/core-1.0.0.tgz',
          },
        });
      }
      if (value.includes('registry.npmjs.org/@breakdown-sh%2Fcli/1.0.0')) {
        return jsonResponse({
          name: '@breakdown-sh/cli',
          version: '1.0.0',
          dist: {
            integrity: 'sha256-L9RxBA8guyBn3IdXZ0RABe6OuCOwrahBQXf8aYH2tEk=',
            tarball: 'https://registry.npmjs.org/@breakdown-sh/cli/-/cli-1.0.0.tgz',
          },
        });
      }
      if (value.includes('registry.npmjs.org/@breakdown-sh%2Fmcp/1.0.0')) {
        return jsonResponse(
          {
            message: 'Not Found',
          },
          404,
        );
      }
      return jsonResponse({}, 200);
    });
    const adapter = new GitHubReleaseAdapter({
      token: 'test-token',
      repository: 'alamorre/breakdown.sh',
      fetchImplementation,
    });

    const results = await adapter.verifyPackageSha256s(
      ['@breakdown-sh/core', '@breakdown-sh/cli', '@breakdown-sh/mcp'],
      '1.0.0',
    );
    expect(results['@breakdown-sh/core']).toMatchObject({
      sha256: '1500fd5a9b37636df23f2e3a13c64f0422b4e56b8e7b43707f43c42a10c73994',
      status: 'verified',
    });
    expect(results['@breakdown-sh/cli']).toMatchObject({
      sha256: '2fd471040e3b206e77dc875767444005ec6ec8e9300dab14177dfc6981cf6b49',
      status: 'verified',
    });
    expect(results['@breakdown-sh/mcp']).toMatchObject({
      status: 'absent',
      http_status: 404,
    });
  });
});
