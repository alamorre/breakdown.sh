import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NPM_PACKAGES,
  inspectFirstPackageBootstrap,
  inspectNpmTrustedPublishing,
  prepareNpmPublicationControls,
  publishFirstPackages,
  validateNpmPublicationControls,
  validateTrustedPublishingEvidence,
} from './npm-publishing.mjs';

const temporaryDirectories: string[] = [];
const candidateSourceCommit = '723e296c5a0ab5431a02022830adff8bcf0dd818';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'breakdown-npm-publishing-'));
  temporaryDirectories.push(root);
  const candidateDirectory = join(root, 'candidate');
  await mkdir(candidateDirectory);
  const packages = NPM_PACKAGES.map((name) => ({
    name,
    version: '1.0.0',
    artifact: `${name.replace('@breakdown-sh/', 'breakdown-sh-')}-1.0.0.tgz`,
  }));
  for (const entry of packages) {
    await writeFile(join(candidateDirectory, entry.artifact), `exact bytes for ${entry.name}\n`);
  }
  await writeFile(
    join(candidateDirectory, 'breakdown-release-1.0.0.json'),
    `${JSON.stringify({
      schema_version: 'breakdown.release-manifest.v1',
      release_version: '1.0.0',
      source: {
        repository: 'https://github.com/alamorre/breakdown.sh',
        git_commit: candidateSourceCommit,
      },
      packages,
      platform_conformance: {
        current_build: {
          candidate_digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) },
        },
      },
    })}\n`,
  );
  return { candidateDirectory, packages, root };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function notFound() {
  return Object.assign(new Error('npm view failed'), {
    stderr: 'npm error code E404\n404 Not Found',
  });
}

function trustedPublisher() {
  return {
    id: 'non-secret-registry-identifier',
    type: 'github',
    repository: 'alamorre/breakdown.sh',
    file: 'local-stable-publication.yml',
    environment: 'breakdown-local-stable',
    permissions: ['createPackage'],
  };
}

describe('npm first-package bootstrap controls', () => {
  it('records an absent three-package registry boundary without publishing', async () => {
    const { candidateDirectory } = await fixture();
    const commands: string[] = [];
    const commandRunner = async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`);
      throw notFound();
    };

    const evidence = await inspectFirstPackageBootstrap({
      candidateDirectory,
      capturedAt: new Date('2026-08-19T20:00:00.000Z'),
      commandRunner,
    });

    expect(evidence).toMatchObject({
      schema_version: 'breakdown.npm-publication-controls.v1',
      mode: 'first-package-bootstrap',
      release_version: '1.0.0',
      authentication: {
        method: 'one-time-granular-access-token',
        credential_value_retained: false,
        required_properties: {
          packages_and_scopes: ['@breakdown-sh'],
          organization_permission: 'no-access',
          maximum_lifetime_hours: 24,
        },
      },
    });
    expect(evidence.packages.map((entry) => entry.registry_state)).toEqual([
      'absent',
      'absent',
      'absent',
    ]);
    expect(commands).toHaveLength(3);
    expect(commands.every((command) => command.startsWith('npm view '))).toBe(true);
  });

  it('refuses a claimed package name whose exact candidate version is absent', async () => {
    const { candidateDirectory } = await fixture();
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[1] === '@breakdown-sh/core') return { stdout: '"@breakdown-sh/core"', stderr: '' };
      throw notFound();
    };

    await expect(
      inspectFirstPackageBootstrap({ candidateDirectory, commandRunner }),
    ).rejects.toThrow('@breakdown-sh/core already exists but @breakdown-sh/core@1.0.0 does not');
  });
});

describe('npm trusted-publisher inspection', () => {
  it('retains only public ownership and exact trusted-publisher identities', async () => {
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: '11.19.0\n', stderr: '' };
      if (args[0] === 'config') return { stdout: 'https://registry.npmjs.org/\n', stderr: '' };
      if (args[0] === 'whoami') return { stdout: 'adam-publisher\n', stderr: '' };
      if (args[0] === 'org') return { stdout: '{"adam-publisher":"owner"}', stderr: '' };
      if (args[0] === 'access') {
        const packageName = args[3]!;
        return { stdout: JSON.stringify({ [packageName]: 'public' }), stderr: '' };
      }
      if (args[0] === 'owner') {
        return { stdout: '["adam-publisher <private@example.com>"]', stderr: '' };
      }
      if (args[0] === 'trust') {
        return { stdout: JSON.stringify(trustedPublisher()), stderr: '' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const evidence = await inspectNpmTrustedPublishing({
      capturedAt: new Date('2026-08-19T20:00:00.000Z'),
      commandRunner,
    });

    expect(evidence.publisher).toEqual({
      username: 'adam-publisher',
      organization: 'breakdown-sh',
      organization_role: 'owner',
    });
    expect(evidence.packages).toHaveLength(3);
    expect(JSON.stringify(evidence)).not.toContain('private@example.com');
    expect(JSON.stringify(evidence)).not.toContain('non-secret-registry-identifier');
    expect(() => validateTrustedPublishingEvidence(evidence)).not.toThrow();
  });

  it('rejects a trust record for any other workflow', () => {
    const evidence = {
      schema_version: 'breakdown.npm-trusted-publishing.v1',
      registry: 'https://registry.npmjs.org/',
      publisher: {
        username: 'adam-publisher',
        organization: 'breakdown-sh',
        organization_role: 'owner',
      },
      packages: NPM_PACKAGES.map((name) => ({
        name,
        visibility: 'public',
        maintainers: ['adam-publisher'],
        trusted_publisher: { ...trustedPublisher(), file: 'other.yml' },
      })),
      credential_material_retained: false,
      verification: { status: 'passed' },
    };

    expect(() => validateTrustedPublishingEvidence(evidence)).toThrow(
      'npm trusted-publisher identity differs',
    );
  });
});

describe('one-time npm publication', () => {
  it('binds finalization to the exact bootstrap report, candidate, and trust transition', async () => {
    const { candidateDirectory, root } = await fixture();
    const bootstrapControls = await inspectFirstPackageBootstrap({
      candidateDirectory,
      commandRunner: async () => {
        throw notFound();
      },
    });
    const bootstrapReport = {
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      registry: 'https://registry.npmjs.org/',
      release_version: '1.0.0',
      candidate_digest: bootstrapControls.candidate_digest,
      repository: 'alamorre/breakdown.sh',
      workflow: 'local-stable-publication.yml',
      environment: 'breakdown-local-stable',
      publication_target: {
        signed_tag: 'breakdown-local-v1.0.0',
        source_commit: candidateSourceCommit,
      },
      execution: {
        mode: 'v1-recovery',
        ref: 'refs/heads/main',
        source_commit: 'b'.repeat(40),
        workflow_ref:
          'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/heads/main',
        workflow_sha: 'b'.repeat(40),
      },
      packages: bootstrapControls.packages.map(({ name, version, artifact, sha256 }) => ({
        name,
        version,
        artifact,
        sha256,
      })),
      publication_manifest: {
        file: 'breakdown-publication-manifest-1.0.0.json',
        sha256: 'c'.repeat(64),
      },
      authentication: 'one-time-granular-access-token',
      credential_value_retained: false,
      provenance: 'passed',
      registry_signatures: 'passed',
      verification: { status: 'passed' },
    };
    const trustedPublishing = {
      schema_version: 'breakdown.npm-trusted-publishing.v1',
      registry: 'https://registry.npmjs.org/',
      publisher: {
        username: 'adam-publisher',
        organization: 'breakdown-sh',
        organization_role: 'owner',
      },
      packages: NPM_PACKAGES.map((name) => ({
        name,
        visibility: 'public',
        maintainers: ['adam-publisher'],
        trusted_publisher: {
          type: 'github',
          repository: 'alamorre/breakdown.sh',
          file: 'local-stable-publication.yml',
          environment: 'breakdown-local-stable',
          permissions: ['createPackage'],
        },
      })),
      credential_material_retained: false,
      verification: { status: 'passed' },
    };

    await expect(
      prepareNpmPublicationControls({
        bootstrapEvidence: {
          ...bootstrapReport,
          candidate_digest: { algorithm: 'SHA-256', content: 'b'.repeat(64) },
        },
        candidateDirectory,
        mode: 'finalize-bootstrap',
        outputPath: join(root, 'invalid-controls.json'),
        trustedPublishingEvidence: trustedPublishing,
      }),
    ).rejects.toThrow('Retained first-package bootstrap evidence is incomplete or mismatched');

    await expect(
      prepareNpmPublicationControls({
        bootstrapEvidence: bootstrapReport,
        candidateDirectory,
        mode: 'finalize-bootstrap',
        outputPath: join(root, 'finalize-controls.json'),
        trustedPublishingEvidence: trustedPublishing,
      }),
    ).resolves.toMatchObject({
      mode: 'finalize-bootstrap',
      candidate_digest: bootstrapControls.candidate_digest,
      authentication: {
        method: 'previously-completed-first-package-bootstrap',
        token_publication: 'human-confirmed-disabled',
      },
    });
  });

  it('publishes only absent records and verifies all three exact public tarballs', async () => {
    const { candidateDirectory, packages, root } = await fixture();
    const controls = await inspectFirstPackageBootstrap({
      candidateDirectory,
      commandRunner: async () => {
        throw notFound();
      },
    });
    const controlsFile = 'breakdown-npm-publication-controls.json';
    await writeFile(join(candidateDirectory, controlsFile), `${JSON.stringify(controls)}\n`);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
    await writeFile(
      join(candidateDirectory, workflowIdentityFile),
      `${JSON.stringify({
        execution: {
          mode: 'tag',
          ref: 'refs/tags/breakdown-local-v1.0.0',
          source_commit: candidateSourceCommit,
          workflow_ref:
            'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/tags/breakdown-local-v1.0.0',
          workflow_sha: candidateSourceCommit,
        },
      })}\n`,
    );
    await writeFile(
      join(candidateDirectory, manifestFile),
      `${JSON.stringify({
        schema_version: 'breakdown.publication-manifest.v1',
        release_version: '1.0.0',
        source: {
          signed_tag: 'breakdown-local-v1.0.0',
          git_commit: candidateSourceCommit,
        },
        packages,
        candidate: { digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) } },
        evidence: {
          npm_publication_controls: { file: controlsFile },
          stable_workflow_identity: { file: workflowIdentityFile },
        },
      })}\n`,
    );
    const published: string[] = [];
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'publish') {
        published.push(args[1]!);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'pack') {
        const packageEntry = packages.find(
          (entry) => `${entry.name}@${entry.version}` === args[1],
        )!;
        const destination = args[args.indexOf('--pack-destination') + 1]!;
        await writeFile(
          join(destination, packageEntry.artifact),
          await readFile(join(candidateDirectory, packageEntry.artifact)),
        );
        return { stdout: JSON.stringify([{ filename: packageEntry.artifact }]), stderr: '' };
      }
      if (args[0] === 'install') return { stdout: '', stderr: '' };
      if (args[0] === 'audit' && args[1] === 'signatures') {
        return { stdout: '{"invalid":[],"missing":[]}', stderr: '' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const report = await publishFirstPackages({
      commandRunner,
      publicationDirectory: candidateDirectory,
    });

    expect(published).toEqual(packages.map((entry) => join(candidateDirectory, entry.artifact)));
    expect(report).toMatchObject({
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      authentication: 'one-time-granular-access-token',
      credential_value_retained: false,
      provenance: 'passed',
      publication_target: {
        signed_tag: 'breakdown-local-v1.0.0',
        source_commit: candidateSourceCommit,
      },
      execution: {
        mode: 'tag',
        ref: 'refs/tags/breakdown-local-v1.0.0',
        source_commit: candidateSourceCommit,
        workflow_ref:
          'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/tags/breakdown-local-v1.0.0',
        workflow_sha: candidateSourceCommit,
      },
      packages: packages.map((entry) => ({ name: entry.name, version: '1.0.0' })),
    });
    expect(root).toContain('breakdown-npm-publishing-');
  });

  it('retries npm install on E404 race during bootstrap verification (issue #257)', async () => {
    const { candidateDirectory, packages } = await fixture();
    const controls = await inspectFirstPackageBootstrap({
      candidateDirectory,
      commandRunner: async () => {
        throw notFound();
      },
    });
    const controlsFile = 'breakdown-npm-publication-controls.json';
    await writeFile(join(candidateDirectory, controlsFile), `${JSON.stringify(controls)}\n`);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
    await writeFile(
      join(candidateDirectory, workflowIdentityFile),
      `${JSON.stringify({
        execution: {
          mode: 'tag',
          ref: 'refs/tags/breakdown-local-v1.0.0',
          source_commit: candidateSourceCommit,
          workflow_ref:
            'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/tags/breakdown-local-v1.0.0',
          workflow_sha: candidateSourceCommit,
        },
      })}\n`,
    );
    await writeFile(
      join(candidateDirectory, manifestFile),
      `${JSON.stringify({
        schema_version: 'breakdown.publication-manifest.v1',
        release_version: '1.0.0',
        source: {
          signed_tag: 'breakdown-local-v1.0.0',
          git_commit: candidateSourceCommit,
        },
        packages,
        candidate: { digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) } },
        evidence: {
          npm_publication_controls: { file: controlsFile },
          stable_workflow_identity: { file: workflowIdentityFile },
        },
      })}\n`,
    );
    const published: string[] = [];
    let installAttempts = 0;
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'publish') {
        published.push(args[1]!);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'pack') {
        const packageEntry = packages.find(
          (entry) => `${entry.name}@${entry.version}` === args[1],
        )!;
        const destination = args[args.indexOf('--pack-destination') + 1]!;
        await writeFile(
          join(destination, packageEntry.artifact),
          await readFile(join(candidateDirectory, packageEntry.artifact)),
        );
        return { stdout: JSON.stringify([{ filename: packageEntry.artifact }]), stderr: '' };
      }
      if (args[0] === 'install') {
        installAttempts++;
        if (installAttempts === 1) {
          throw Object.assign(new Error('npm install failed'), {
            stderr: 'npm error code E404\n404 Not Found - GET https://registry.npmjs.org/@breakdown-sh%2Fcli',
          });
        }
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'audit' && args[1] === 'signatures') {
        return { stdout: '{"invalid":[],"missing":[]}', stderr: '' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const report = await publishFirstPackages({
      commandRunner,
      publicationDirectory: candidateDirectory,
    });

    expect(installAttempts).toBe(2);
    expect(published).toEqual(packages.map((entry) => join(candidateDirectory, entry.artifact)));
    expect(report).toMatchObject({
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      authentication: 'one-time-granular-access-token',
      provenance: 'passed',
    });
  });

  it('rejects a bootstrap control with broader organization permission', async () => {
    const { candidateDirectory } = await fixture();
    const controls = await inspectFirstPackageBootstrap({
      candidateDirectory,
      commandRunner: async () => {
        throw notFound();
      },
    });
    controls.authentication.required_properties.organization_permission = 'read-write';

    expect(() =>
      validateNpmPublicationControls(controls, {
        release_version: '1.0.0',
        candidate_digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) },
        packages: controls.packages,
      }),
    ).toThrow('npm first-package bootstrap controls are not fail-closed');
  });

  it('provides clear guidance when npm publish fails with 404 due to missing createPackage permission', async () => {
    const { candidateDirectory, root } = await fixture();
    const publicationDirectory = join(root, 'publication');
    await mkdir(publicationDirectory);
    for (const name of NPM_PACKAGES) {
      const artifact = `${name.replace('@breakdown-sh/', 'breakdown-sh-')}-1.0.0.tgz`;
      await writeFile(
        join(publicationDirectory, artifact),
        await readFile(join(candidateDirectory, artifact)),
      );
    }
    const controls = await inspectFirstPackageBootstrap({
      candidateDirectory,
      commandRunner: async () => {
        throw notFound();
      },
    });
    const controlsFile = 'breakdown-npm-publication-controls.json';
    await writeFile(join(publicationDirectory, controlsFile), `${JSON.stringify(controls)}\n`);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
    await writeFile(
      join(publicationDirectory, workflowIdentityFile),
      `${JSON.stringify({
        execution: {
          mode: 'v1-recovery',
          ref: 'refs/heads/main',
          source_commit: candidateSourceCommit,
          workflow_ref:
            'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/heads/main',
          workflow_sha: candidateSourceCommit,
        },
      })}\n`,
    );
    await writeFile(
      join(publicationDirectory, manifestFile),
      `${JSON.stringify({
        schema_version: 'breakdown.publication-manifest.v1',
        release_version: '1.0.0',
        source: {
          signed_tag: 'breakdown-local-v1.0.0',
          git_commit: candidateSourceCommit,
        },
        packages: controls.packages.map((entry) => ({
          name: entry.name,
          version: entry.version,
          artifact: entry.artifact,
        })),
        candidate: { digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) } },
        evidence: {
          npm_publication_controls: { file: controlsFile },
          stable_workflow_identity: { file: workflowIdentityFile },
        },
      })}\n`,
    );

    const commandRunner = async (command: string, args: string[]) => {
      if (command === 'npm' && args[0] === 'publish') {
        throw Object.assign(new Error('npm publish failed'), {
          stderr:
            'npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/@breakdown-sh%2fcore',
        });
      }
      throw new Error('Unexpected command');
    };

    await expect(
      publishFirstPackages({
        commandRunner,
        publicationDirectory,
      }),
    ).rejects.toThrow(
      /npm publish failed with 404 for @breakdown-sh\/core.*token lacks permission to CREATE new packages.*packages and scopes.*Read and write.*@breakdown-sh/,
    );
  });

  it('publishes absent packages from local tarballs without fetching from registry', async () => {
    const { candidateDirectory, packages } = await fixture();
    const controls = await inspectFirstPackageBootstrap({
      candidateDirectory,
      commandRunner: async () => {
        throw notFound();
      },
    });
    const controlsFile = 'breakdown-npm-publication-controls.json';
    await writeFile(join(candidateDirectory, controlsFile), `${JSON.stringify(controls)}\n`);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
    await writeFile(
      join(candidateDirectory, workflowIdentityFile),
      `${JSON.stringify({
        execution: {
          mode: 'tag',
          ref: 'refs/tags/breakdown-local-v1.0.0',
          source_commit: candidateSourceCommit,
          workflow_ref:
            'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/tags/breakdown-local-v1.0.0',
          workflow_sha: candidateSourceCommit,
        },
      })}\n`,
    );
    await writeFile(
      join(candidateDirectory, manifestFile),
      `${JSON.stringify({
        schema_version: 'breakdown.publication-manifest.v1',
        release_version: '1.0.0',
        source: {
          signed_tag: 'breakdown-local-v1.0.0',
          git_commit: candidateSourceCommit,
        },
        packages,
        candidate: { digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) } },
        evidence: {
          npm_publication_controls: { file: controlsFile },
          stable_workflow_identity: { file: workflowIdentityFile },
        },
      })}\n`,
    );
    const published: string[] = [];
    const packCalls: string[] = [];
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'publish') {
        published.push(args[1]!);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'pack') {
        packCalls.push(args[1]!);
        throw notFound();
      }
      if (args[0] === 'install') return { stdout: '', stderr: '' };
      if (args[0] === 'audit' && args[1] === 'signatures') {
        return { stdout: '{"invalid":[],"missing":[]}', stderr: '' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const report = await publishFirstPackages({
      commandRunner,
      publicationDirectory: candidateDirectory,
    });

    expect(published).toEqual(packages.map((entry) => join(candidateDirectory, entry.artifact)));
    expect(packCalls).toHaveLength(0);
    expect(report).toMatchObject({
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      authentication: 'one-time-granular-access-token',
      provenance: 'passed',
      packages: packages.map((entry) => ({ name: entry.name, version: '1.0.0' })),
    });
    expect(report.packages.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
  });

  it('verifies exact-version-present packages from registry using npm pack', async () => {
    const { candidateDirectory, packages } = await fixture();
    const presentControls = {
      ...(await inspectFirstPackageBootstrap({
        candidateDirectory,
        commandRunner: async () => {
          throw notFound();
        },
      })),
    };
    presentControls.packages = presentControls.packages.map((entry) => ({
      ...entry,
      registry_state: 'exact-version-present',
    }));
    const controlsFile = 'breakdown-npm-publication-controls.json';
    await writeFile(join(candidateDirectory, controlsFile), `${JSON.stringify(presentControls)}\n`);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
    await writeFile(
      join(candidateDirectory, workflowIdentityFile),
      `${JSON.stringify({
        execution: {
          mode: 'tag',
          ref: 'refs/tags/breakdown-local-v1.0.0',
          source_commit: candidateSourceCommit,
          workflow_ref:
            'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/tags/breakdown-local-v1.0.0',
          workflow_sha: candidateSourceCommit,
        },
      })}\n`,
    );
    await writeFile(
      join(candidateDirectory, manifestFile),
      `${JSON.stringify({
        schema_version: 'breakdown.publication-manifest.v1',
        release_version: '1.0.0',
        source: {
          signed_tag: 'breakdown-local-v1.0.0',
          git_commit: candidateSourceCommit,
        },
        packages,
        candidate: { digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) } },
        evidence: {
          npm_publication_controls: { file: controlsFile },
          stable_workflow_identity: { file: workflowIdentityFile },
        },
      })}\n`,
    );
    const published: string[] = [];
    const packCalls: string[] = [];
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'publish') {
        published.push(args[1]!);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'pack') {
        packCalls.push(args[1]!);
        const packageEntry = packages.find(
          (entry) => `${entry.name}@${entry.version}` === args[1],
        )!;
        const destination = args[args.indexOf('--pack-destination') + 1]!;
        await writeFile(
          join(destination, packageEntry.artifact),
          await readFile(join(candidateDirectory, packageEntry.artifact)),
        );
        return { stdout: JSON.stringify([{ filename: packageEntry.artifact }]), stderr: '' };
      }
      if (args[0] === 'install') return { stdout: '', stderr: '' };
      if (args[0] === 'audit' && args[1] === 'signatures') {
        return { stdout: '{"invalid":[],"missing":[]}', stderr: '' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const report = await publishFirstPackages({
      commandRunner,
      publicationDirectory: candidateDirectory,
    });

    expect(published).toHaveLength(0);
    expect(packCalls).toHaveLength(3);
    expect(packCalls).toEqual(packages.map((entry) => `${entry.name}@${entry.version}`));
    expect(report).toMatchObject({
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      authentication: 'one-time-granular-access-token',
      provenance: 'passed',
      packages: packages.map((entry) => ({ name: entry.name, version: '1.0.0' })),
    });
  });

  it('detects resumable mixed state when core is present and cli/mcp are absent', async () => {
    const { candidateDirectory, packages } = await fixture();
    const commands: string[] = [];
    const commandRunner = async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`);
      
      if (args[0] === 'view') {
        const packageSpec = args[1];
        
        // Core package exists and version exists
        if (packageSpec === '@breakdown-sh/core') {
          return { stdout: JSON.stringify({ name: '@breakdown-sh/core' }), stderr: '' };
        }
        if (packageSpec === '@breakdown-sh/core@1.0.0') {
          return { stdout: JSON.stringify({ name: '@breakdown-sh/core', version: '1.0.0' }), stderr: '' };
        }
        
        // CLI and MCP don't exist yet
        if (packageSpec === '@breakdown-sh/cli' || packageSpec === '@breakdown-sh/mcp') {
          throw notFound();
        }
        if (packageSpec.includes('@breakdown-sh/cli@') || packageSpec.includes('@breakdown-sh/mcp@')) {
          throw notFound();
        }
      }
      
      if (args[0] === 'pack' && args[1] === '@breakdown-sh/core@1.0.0') {
        const destination = args[args.indexOf('--pack-destination') + 1]!;
        const coreEntry = packages.find((entry) => entry.name === '@breakdown-sh/core')!;
        await writeFile(
          join(destination, coreEntry.artifact),
          await readFile(join(candidateDirectory, coreEntry.artifact)),
        );
        return { stdout: JSON.stringify([{ filename: coreEntry.artifact }]), stderr: '' };
      }
      
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const evidence = await inspectFirstPackageBootstrap({
      candidateDirectory,
      capturedAt: new Date('2026-09-02T18:00:00.000Z'),
      commandRunner,
    });

    expect(evidence).toMatchObject({
      schema_version: 'breakdown.npm-publication-controls.v1',
      mode: 'first-package-bootstrap',
      release_version: '1.0.0',
      packages: [
        {
          name: '@breakdown-sh/core',
          version: '1.0.0',
          registry_state: 'exact-version-present',
        },
        {
          name: '@breakdown-sh/cli',
          version: '1.0.0',
          registry_state: 'absent',
        },
        {
          name: '@breakdown-sh/mcp',
          version: '1.0.0',
          registry_state: 'absent',
        },
      ],
    });
  });

  it('publishes cli and mcp when core is already present (resumable mixed state)', async () => {
    const { candidateDirectory, packages } = await fixture();
    
    // Create mixed state controls: core present, cli/mcp absent
    const mixedControls = {
      ...(await inspectFirstPackageBootstrap({
        candidateDirectory,
        commandRunner: async () => {
          throw notFound();
        },
      })),
    };
    mixedControls.packages = mixedControls.packages.map((entry) => ({
      ...entry,
      registry_state:
        entry.name === '@breakdown-sh/core' ? 'exact-version-present' : 'absent',
    }));
    
    const controlsFile = 'breakdown-npm-publication-controls.json';
    await writeFile(join(candidateDirectory, controlsFile), `${JSON.stringify(mixedControls)}\n`);
    
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
    await writeFile(
      join(candidateDirectory, workflowIdentityFile),
      `${JSON.stringify({
        execution: {
          mode: 'v1-recovery',
          ref: 'refs/heads/main',
          source_commit: candidateSourceCommit,
          workflow_ref:
            'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/heads/main',
          workflow_sha: candidateSourceCommit,
        },
      })}\n`,
    );
    
    await writeFile(
      join(candidateDirectory, manifestFile),
      `${JSON.stringify({
        schema_version: 'breakdown.publication-manifest.v1',
        release_version: '1.0.0',
        source: {
          signed_tag: 'breakdown-local-v1.0.0',
          git_commit: candidateSourceCommit,
        },
        packages,
        candidate: { digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) } },
        evidence: {
          npm_publication_controls: { file: controlsFile },
          stable_workflow_identity: { file: workflowIdentityFile },
        },
      })}\n`,
    );
    
    const published: string[] = [];
    const packCalls: string[] = [];
    const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'publish') {
        const publishPath = args[1]!;
        published.push(publishPath);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'pack') {
        packCalls.push(args[1]!);
        const packageSpec = args[1]!;
        if (packageSpec === '@breakdown-sh/core@1.0.0') {
          const destination = args[args.indexOf('--pack-destination') + 1]!;
          const coreEntry = packages.find((entry) => entry.name === '@breakdown-sh/core')!;
          await writeFile(
            join(destination, coreEntry.artifact),
            await readFile(join(candidateDirectory, coreEntry.artifact)),
          );
          return { stdout: JSON.stringify([{ filename: coreEntry.artifact }]), stderr: '' };
        }
        throw new Error(`npm pack called for absent package: ${packageSpec}`);
      }
      if (args[0] === 'install') return { stdout: '', stderr: '' };
      if (args[0] === 'audit' && args[1] === 'signatures') {
        return { stdout: '{"invalid":[],"missing":[]}', stderr: '' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };

    const report = await publishFirstPackages({
      commandRunner,
      publicationDirectory: candidateDirectory,
    });

    // Core was already present (npm pack was called), cli and mcp were published
    expect(published).toHaveLength(2);
    expect(published.map((p) => p.split('/').pop())).toEqual([
      'breakdown-sh-cli-1.0.0.tgz',
      'breakdown-sh-mcp-1.0.0.tgz',
    ]);
    expect(packCalls).toEqual(['@breakdown-sh/core@1.0.0']);
    expect(report).toMatchObject({
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      packages: packages.map((entry) => ({ name: entry.name, version: '1.0.0' })),
    });
  });
});
