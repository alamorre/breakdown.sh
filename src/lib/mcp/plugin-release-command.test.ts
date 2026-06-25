import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

type ReleaseCommand = {
  shouldRun: boolean;
  command: string;
  level?: string;
  ref?: string | null;
  acceptedKnownIssues?: boolean;
  reportPath?: string;
  baselinePath?: string;
};

type ReleaseCommandScript = {
  parsePluginReleaseCommand: (commentBody: string) => ReleaseCommand;
  evaluatePromotion: (input: {
    report: Record<string, unknown>;
    acceptedKnownIssues?: boolean;
  }) => { ok: boolean; message: string };
  buildPromotedBaseline: (input: {
    report: Record<string, unknown>;
    reportPath?: string;
    actor?: string;
    pr?: string;
    sha?: string;
    promotedAt?: string;
    acceptedKnownIssues?: boolean;
  }) => Record<string, unknown>;
  buildRegressionIssues: (
    report: Record<string, unknown>,
  ) => Array<{ title: string; body: string; labels: string[] }>;
};

const releaseCommand = (await import(
  pathToFileURL(path.join(process.cwd(), 'scripts/plugin-release-command.mjs')).href
)) as ReleaseCommandScript;

describe('plugin release phone command helper', () => {
  it('parses bump commands with semver levels', () => {
    expect(releaseCommand.parsePluginReleaseCommand('/bump patch')).toMatchObject({
      shouldRun: true,
      command: 'bump',
      level: 'patch',
    });
    expect(releaseCommand.parsePluginReleaseCommand('/bump minor')).toMatchObject({
      level: 'minor',
    });
    expect(releaseCommand.parsePluginReleaseCommand('/bump major')).toMatchObject({
      level: 'major',
    });
  });

  it('parses release-test, promote, and file-regression commands', () => {
    expect(releaseCommand.parsePluginReleaseCommand('/release-test ref=feature/head')).toMatchObject({
      shouldRun: true,
      command: 'release-test',
      ref: 'feature/head',
    });

    expect(
      releaseCommand.parsePluginReleaseCommand('/promote accept-known-issues report=out.json'),
    ).toMatchObject({
      shouldRun: true,
      command: 'promote',
      acceptedKnownIssues: true,
      reportPath: 'out.json',
    });

    expect(releaseCommand.parsePluginReleaseCommand('/file-regressions')).toMatchObject({
      shouldRun: true,
      command: 'file-regressions',
    });
  });

  it('ignores unsupported or incomplete commands', () => {
    expect(releaseCommand.parsePluginReleaseCommand('looks good')).toMatchObject({
      shouldRun: false,
      command: 'none',
    });

    expect(releaseCommand.parsePluginReleaseCommand('/bump')).toMatchObject({
      shouldRun: false,
      command: 'bump',
    });

    expect(releaseCommand.parsePluginReleaseCommand('/ship-it')).toMatchObject({
      shouldRun: false,
      command: 'ship-it',
    });
  });

  it('gates promotion on a passing release-test recommendation', () => {
    const report = {
      recommendation: 'promote',
      candidateVersion: '1.0.1',
      testedRef: 'refs/pull/123/head',
      testedSha: 'abc123',
      baselineVersion: '1.0.0',
      regressions: [],
    };

    expect(releaseCommand.evaluatePromotion({ report }).ok).toBe(true);

    expect(
      releaseCommand.buildPromotedBaseline({
        report,
        actor: 'maintainer',
        pr: '123',
        sha: 'abc123',
        promotedAt: '2026-06-25T00:00:00.000Z',
      }),
    ).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-06-25T00:00:00.000Z',
      promotedBy: 'maintainer',
      pullRequest: '123',
      candidate: {
        version: '1.0.1',
        ref: 'refs/pull/123/head',
        sha: 'abc123',
      },
      recommendation: 'promote',
    });
  });

  it('preserves promoted comparison metrics for the next baseline', () => {
    const baseline = releaseCommand.buildPromotedBaseline({
      report: {
        recommendation: 'promote',
        candidate: { version: '1.1.0', ref: 'abc123' },
        metrics: [
          { key: 'install_success', candidate: true },
          { key: 'elapsed_ms', candidate: 12000 },
          {
            key: 'mcp_surface',
            candidate: { success: true, tools: ['list_graphs'], missingTools: [] },
          },
        ],
      },
      sha: 'abc123',
      promotedAt: '2026-06-25T00:00:00.000Z',
    });

    expect(baseline).toMatchObject({
      candidate: { version: '1.1.0', ref: 'abc123', sha: 'abc123' },
      metrics: {
        install_success: true,
        elapsed_ms: 12000,
        mcp_surface: { success: true, tools: ['list_graphs'], missingTools: [] },
      },
    });
  });

  it('requires explicit known-issue acceptance for promote-with-known-issues', () => {
    const report = {
      summary: { recommendation: 'promote-with-known-issues' },
      candidate: { version: '1.0.1', ref: 'refs/pull/123/head' },
      comparison: { regressions: [{ title: 'Docs ambiguity regressed' }] },
    };

    expect(releaseCommand.evaluatePromotion({ report }).ok).toBe(false);
    expect(
      releaseCommand.evaluatePromotion({ report, acceptedKnownIssues: true }).ok,
    ).toBe(true);
  });

  it('blocks promotion when release-test reports block or incomplete metadata', () => {
    expect(
      releaseCommand.evaluatePromotion({
        report: {
          recommendation: 'block',
          candidateVersion: '1.0.1',
          testedRef: 'refs/pull/123/head',
        },
      }).ok,
    ).toBe(false);

    expect(
      releaseCommand.evaluatePromotion({
        report: {
          recommendation: 'promote',
          candidateVersion: '1.0.1',
        },
      }).ok,
    ).toBe(false);
  });

  it('builds regression issue payloads without exposing secrets', () => {
    const issues = releaseCommand.buildRegressionIssues({
      candidateVersion: '1.0.1',
      testedRef: 'refs/pull/123/head',
      baselineVersion: '1.0.0',
      regressions: [
        {
          title: 'External evaluator failed',
          details: 'finalize_external_run returned an error',
        },
      ],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      title: 'External evaluator failed',
      labels: ['regression', 'plugin-release-loop'],
    });
    expect(issues[0].body).toContain('Candidate version: 1.0.1');
    expect(issues[0].body).toContain('finalize_external_run returned an error');
    expect(issues[0].body).not.toContain('BREAKDOWN_RELEASE_TEST_TOKEN');
  });
});
