import { createHash } from 'node:crypto';

import {
  githubReleaseObservation,
  npmPackageObservation,
  sanitizeReleaseDiagnostics,
} from './release-operation.mjs';

const PACKAGE_URLS = Object.freeze({
  '@breakdown-sh/core': 'https://registry.npmjs.org/%40breakdown-sh%2Fcore',
  '@breakdown-sh/cli': 'https://registry.npmjs.org/%40breakdown-sh%2Fcli',
  '@breakdown-sh/mcp': 'https://registry.npmjs.org/%40breakdown-sh%2Fmcp',
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function responseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return await response.text();
}

export class GitHubReleaseAdapter {
  constructor({ token, repository, fetchImplementation = fetch }) {
    invariant(typeof token === 'string' && token.length > 0, 'GitHub token is required.');
    invariant(
      typeof repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),
      'GitHub repository is invalid.',
    );
    this.token = token;
    this.repository = repository;
    this.fetch = fetchImplementation;
  }

  async request(path, { method = 'GET', body, expected = [200] } = {}) {
    const response = await this.fetch(`https://api.github.com/${path.replace(/^\//, '')}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'follow',
    });
    const parsed = response.status === 204 ? null : await responseBody(response);
    if (!expected.includes(response.status)) {
      throw new Error(`GitHub API ${method} ${path} returned HTTP ${response.status}.`);
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  async dispatchWorkflow(workflowId, body) {
    const response = await this.request(
      `repos/${this.repository}/actions/workflows/${workflowId}/dispatches`,
      { method: 'POST', body, expected: [200] },
    );
    return response.body;
  }

  async getRun(runId) {
    return (await this.request(`repos/${this.repository}/actions/runs/${runId}`)).body;
  }

  async getJobs(runId) {
    const response = await this.request(
      `repos/${this.repository}/actions/runs/${runId}/jobs?per_page=100`,
    );
    return response.body?.jobs;
  }

  async listWorkflowRuns(workflowId) {
    const response = await this.request(
      `repos/${this.repository}/actions/workflows/${workflowId}/runs?per_page=100`,
    );
    return response.body?.workflow_runs;
  }

  async currentUser() {
    return (await this.request('user')).body?.login;
  }

  async branchHead(branch) {
    const response = await this.request(
      `repos/${this.repository}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return response.body?.object?.sha;
  }

  async readPublicState() {
    const releaseResponse = await this.request(
      `repos/${this.repository}/releases/tags/breakdown-local-v1.0.0`,
      { expected: [200, 404] },
    ).catch((error) => ({ status: 0, body: null, error }));
    const npmEntries = await Promise.all(
      Object.entries(PACKAGE_URLS).map(async ([name, url]) => {
        try {
          const response = await this.fetch(url, {
            headers: { Accept: 'application/json' },
            redirect: 'follow',
          });
          const body = await responseBody(response);
          return [
            name,
            npmPackageObservation({ status: response.status, body, name }),
          ];
        } catch {
          return [name, { status: 'indeterminate', http_status: 0 }];
        }
      }),
    );
    return {
      github_release: githubReleaseObservation(releaseResponse),
      npm_packages: Object.fromEntries(npmEntries),
    };
  }

  async downloadFailureEvidence(runId, jobs) {
    const artifactResponse = await this.request(
      `repos/${this.repository}/actions/runs/${runId}/artifacts?per_page=100`,
    );
    const artifacts = Array.isArray(artifactResponse.body?.artifacts)
      ? artifactResponse.body.artifacts
      : [];
    const retainedArtifacts = [];
    for (const artifact of artifacts.slice(0, 20)) {
      const record = {
        id: String(artifact.id),
        name: artifact.name,
        expired: artifact.expired,
        digest: artifact.digest,
        downloaded: false,
      };
      if (artifact.expired === false && Number(artifact.size_in_bytes) <= 10_000_000) {
        const expectedUrl = `https://api.github.com/repos/${this.repository}/actions/artifacts/${artifact.id}/zip`;
        invariant(
          artifact.archive_download_url === expectedUrl,
          'GitHub artifact download URL differs from the exact repository artifact endpoint.',
        );
        const response = await this.fetch(artifact.archive_download_url, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': '2026-03-10',
          },
          redirect: 'follow',
        });
        if (response.ok) {
          const bytes = Buffer.from(await response.arrayBuffer());
          record.downloaded = true;
          record.downloaded_size = bytes.length;
          record.downloaded_sha256 = createHash('sha256').update(bytes).digest('hex');
        }
      }
      retainedArtifacts.push(record);
    }
    const failedSteps = (Array.isArray(jobs) ? jobs : [])
      .flatMap((job) => (Array.isArray(job?.steps) ? job.steps : []))
      .filter((step) => step?.conclusion === 'failure' || step?.conclusion === 'cancelled')
      .map((step) => step.name);
    return sanitizeReleaseDiagnostics({
      failed_steps: failedSteps,
      retained_artifacts: retainedArtifacts,
    });
  }

  async listPolicies() {
    const response = await this.request(
      `repos/${this.repository}/environments/breakdown-local-stable/deployment-branch-policies?per_page=100`,
    );
    return response.body?.branch_policies;
  }

  async deletePolicy(policyId) {
    const response = await this.request(
      `repos/${this.repository}/environments/breakdown-local-stable/deployment-branch-policies/${policyId}`,
      { method: 'DELETE', expected: [204, 403] },
    );
    return { status: response.status };
  }

  async createPolicy(policy) {
    const response = await this.request(
      `repos/${this.repository}/environments/breakdown-local-stable/deployment-branch-policies`,
      { method: 'POST', body: policy, expected: [200, 303, 403] },
    );
    return { status: response.status, body: response.body };
  }

  async listRunArtifacts(runId) {
    const response = await this.request(
      `repos/${this.repository}/actions/runs/${runId}/artifacts?per_page=100`,
    );
    return Array.isArray(response.body?.artifacts) ? response.body.artifacts : [];
  }

  async verifyPackageSha256s(packageNames, expectedVersion) {
    const results = {};
    for (const name of packageNames) {
      try {
        const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${expectedVersion}`;
        const response = await this.fetch(url, {
          headers: { Accept: 'application/json' },
          redirect: 'follow',
        });
        if (response.status === 200) {
          const packument = await responseBody(response);
          let sha256Hash = null;
          // Try to extract sha256 from integrity field (sha256-<base64>)
          if (packument?.dist?.integrity) {
            const integrityMatch = /^sha256-([A-Za-z0-9+/=]+)$/.exec(packument.dist.integrity);
            if (integrityMatch) {
              try {
                const hex = Buffer.from(integrityMatch[1], 'base64').toString('hex');
                if (/^[0-9a-f]{64}$/.test(hex)) {
                  sha256Hash = hex;
                }
              } catch {
                // Invalid base64, continue
              }
            }
          }
          // Try shasum256 field if available
          if (!sha256Hash && packument?.dist?.shasum256 && /^[0-9a-f]{64}$/.test(packument.dist.shasum256)) {
            sha256Hash = packument.dist.shasum256;
          }
          
          if (sha256Hash) {
            results[name] = { sha256: sha256Hash, status: 'verified' };
          } else if (packument?.dist?.tarball) {
            // If sha256 is not in packument, we need to fetch and compute it
            const tarballResponse = await this.fetch(packument.dist.tarball, {
              redirect: 'follow',
            });
            if (tarballResponse.ok) {
              const bytes = Buffer.from(await tarballResponse.arrayBuffer());
              sha256Hash = createHash('sha256').update(bytes).digest('hex');
              results[name] = { sha256: sha256Hash, status: 'computed' };
            } else {
              results[name] = { status: 'tarball_fetch_failed', http_status: tarballResponse.status };
            }
          } else {
            results[name] = { status: 'no_shasum', http_status: response.status };
          }
        } else if (response.status === 404) {
          results[name] = { status: 'absent', http_status: 404 };
        } else {
          results[name] = { status: 'indeterminate', http_status: response.status };
        }
      } catch (error) {
        results[name] = { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
    }
    return results;
  }
}
