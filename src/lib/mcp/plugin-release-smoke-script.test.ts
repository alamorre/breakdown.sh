import { describe, expect, it } from 'vitest';

interface SmokeModule {
  buildMarkdownReport(summary: SmokeSummary): string;
  createDryRunResult(options: SmokeOptions): SmokeSummary;
  deriveJsonOutputPath(path: string): string;
  isForbiddenMainRef(ref: string): boolean;
  parseArgs(argv: string[], env: Record<string, string | undefined>): SmokeOptions;
  redactSecrets(value: string, secrets: string[]): string;
}

type SmokeOptions = Record<string, string | boolean | null | undefined>;

type SmokeSummary = {
  candidate: {
    version: string;
    ref: string;
    marketplaceRepo: string;
  };
};

async function smokeModule() {
  return (await import('../../../scripts/plugin-release-smoke.mjs')) as SmokeModule;
}

describe('plugin release smoke script helpers', () => {
  it('requires a candidate ref and rejects main refs', async () => {
    const smoke = await smokeModule();

    expect(() => smoke.parseArgs(['--candidate-version', '1.0.1'], {})).toThrow(
      '--ref or --pr and --candidate-version are required',
    );
    expect(() =>
      smoke.parseArgs(['--candidate-version', '1.0.1', '--ref', 'main'], {}),
    ).toThrow('Release smoke tests must run against a PR candidate ref');
    expect(smoke.isForbiddenMainRef('refs/heads/main')).toBe(true);
    expect(smoke.parseArgs(['--candidate-version', '1.0.1', '--pr', '123'], {})).toMatchObject({
      candidateRef: 'refs/pull/123/head',
    });
  });

  it('builds deterministic dry-run reports with no raw token leakage', async () => {
    const smoke = await smokeModule();
    const options = smoke.parseArgs(
      [
        '--candidate-version',
        '1.0.1',
        '--ref',
        'codex/plugin-candidate',
        '--output',
        'tmp/plugin-smoke-test.md',
        '--dry-run',
      ],
      { BREAKDOWN_RELEASE_TEST_TOKEN: 'bdk_secret_value' },
    );

    const summary = smoke.createDryRunResult(options);
    const markdown = smoke.buildMarkdownReport(summary);

    expect(smoke.deriveJsonOutputPath('plugin-smoke-test.md')).toBe('plugin-smoke-test.json');
    expect(smoke.redactSecrets('token bdk_secret_value leaked', ['bdk_secret_value'])).toBe(
      'token [REDACTED] leaked',
    );
    expect(summary.candidate).toMatchObject({
      version: '1.0.1',
      ref: 'codex/plugin-candidate',
      marketplaceRepo: 'alamorre/breakdown.sh',
    });
    expect(markdown).toContain('# Plugin Smoke Test');
    expect(markdown).toContain('## Token And Auth Friction');
    expect(markdown).toContain('## Graph Listing');
    expect(markdown).toContain('## External Evaluator Run');
    expect(markdown).toContain('## New Feedback');
    expect(markdown).toContain('## Recommendation');
    expect(markdown).not.toContain('bdk_secret_value');
  });
});
