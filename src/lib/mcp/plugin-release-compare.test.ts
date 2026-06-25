import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

type Recommendation = 'promote' | 'promote-with-known-issues' | 'block';

type Comparison = {
  recommendation: Recommendation;
  candidate: { version: string; ref: string; pr: string };
  baseline: { version: string; ref: string };
  regressions: Array<{ key: string; severity: string; acceptedKnownIssue: unknown }>;
  newFeedback: string[];
  metrics: Array<{ key: string; status: string }>;
};

type CompareModule = {
  comparePluginReleaseSmoke: (input: {
    candidate: unknown;
    baseline: unknown;
    acceptedKnownIssues?: unknown[];
    generatedAt?: string;
  }) => Comparison;
  normalizeSmokeSummary: (input: unknown) => unknown;
  renderComparisonMarkdown: (comparison: Comparison) => string;
};

const compare = (await import(
  pathToFileURL(path.join(process.cwd(), 'src/lib/mcp/plugin-release-compare.mjs')).href
)) as CompareModule;

const baseline = {
  candidate: {
    version: '1.0.0',
    ref: 'main',
  },
  metrics: {
    install_success: true,
    auth_friction: 'low',
    mcp_surface: {
      success: true,
      tools: ['list_graphs', 'get_next_step', 'submit_step_result'],
      missingTools: [],
    },
    graph_access: {
      listSuccess: true,
      readSuccess: true,
    },
    external_run_success: true,
    setup_steps: 5,
    elapsed_ms: 10000,
    docs_ambiguity: {
      count: 0,
      items: [],
    },
  },
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidate: {
      version: '1.0.1',
      ref: 'refs/pull/123/head',
      pr: '123',
    },
    checks: {
      install: { success: true },
      auth: { friction: 'low' },
      mcpSurface: {
        success: true,
        tools: ['list_graphs', 'get_next_step', 'submit_step_result'],
        missingTools: [],
      },
      graphAccess: { listSuccess: true, readSuccess: true },
      externalRun: { success: true },
      setup: { stepCount: 5, elapsedMs: 10000 },
      docs: { ambiguityCount: 0, ambiguities: [] },
    },
    ...overrides,
  };
}

describe('plugin release smoke comparison', () => {
  it('promotes a candidate with no regressions or new feedback', () => {
    const result = compare.comparePluginReleaseSmoke({
      candidate: candidate(),
      baseline,
      generatedAt: '2026-06-25T00:00:00.000Z',
    });

    expect(result.recommendation).toBe('promote');
    expect(result.candidate).toEqual({
      version: '1.0.1',
      ref: 'refs/pull/123/head',
      pr: '123',
    });
    expect(result.baseline).toMatchObject({ version: '1.0.0', ref: 'main' });
    expect(result.regressions).toEqual([]);
  });

  it('blocks on unaccepted blocking regressions', () => {
    const result = compare.comparePluginReleaseSmoke({
      candidate: candidate({
        checks: {
          install: { success: true },
          auth: { friction: 'low' },
          mcpSurface: {
            success: true,
            tools: ['list_graphs'],
            missingTools: ['get_next_step', 'submit_step_result'],
          },
          graphAccess: { listSuccess: true },
          externalRun: { success: false },
          setup: { stepCount: 5, elapsedMs: 10000 },
          docs: { ambiguityCount: 0 },
        },
      }),
      baseline,
    });

    expect(result.recommendation).toBe('block');
    expect(result.regressions.map((regression) => regression.key)).toEqual([
      'mcp_surface',
      'external_run_success',
    ]);
  });

  it('blocks on unaccepted warning regressions', () => {
    const result = compare.comparePluginReleaseSmoke({
      candidate: candidate({
        checks: {
          install: { success: true },
          auth: { friction: 'medium' },
          mcpSurface: {
            success: true,
            tools: ['list_graphs', 'get_next_step', 'submit_step_result'],
          },
          graphAccess: { listSuccess: true },
          externalRun: { success: true },
          setup: { stepCount: 8, elapsedMs: 20000 },
          docs: { ambiguityCount: 1, ambiguities: ['Release-test secret setup is unclear.'] },
        },
      }),
      baseline,
    });

    expect(result.recommendation).toBe('block');
    expect(result.regressions.map((regression) => regression.key)).toEqual([
      'auth_friction',
      'setup_steps',
      'elapsed_ms',
      'docs_ambiguity',
    ]);
  });

  it('promotes with known issues when all regressions are accepted', () => {
    const result = compare.comparePluginReleaseSmoke({
      candidate: candidate({
        checks: {
          install: { success: true },
          auth: { friction: 'medium' },
          mcpSurface: {
            success: true,
            tools: ['list_graphs', 'get_next_step', 'submit_step_result'],
          },
          graphAccess: { listSuccess: true },
          externalRun: { success: true },
          setup: { stepCount: 5, elapsedMs: 10000 },
          docs: { ambiguityCount: 0 },
        },
      }),
      baseline,
      acceptedKnownIssues: [{ metric: 'auth_friction', reason: 'Temporary docs copy gap.' }],
    });

    expect(result.recommendation).toBe('promote-with-known-issues');
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].acceptedKnownIssue).toMatchObject({
      metric: 'auth_friction',
    });
  });

  it('promotes with known issues when there is new feedback but no regression', () => {
    const result = compare.comparePluginReleaseSmoke({
      candidate: candidate({
        newFeedback: ['Add a shorter phone comment summary.'],
      }),
      baseline,
    });

    expect(result.recommendation).toBe('promote-with-known-issues');
    expect(result.newFeedback).toEqual(['Add a shorter phone comment summary.']);
  });

  it('renders markdown with separate regressions and new feedback sections', () => {
    const result = compare.comparePluginReleaseSmoke({
      candidate: candidate({
        checks: {
          install: { success: false },
          auth: { friction: 'low' },
          mcpSurface: {
            success: true,
            tools: ['list_graphs', 'get_next_step', 'submit_step_result'],
          },
          graphAccess: { listSuccess: true },
          externalRun: { success: true },
          setup: { stepCount: 5, elapsedMs: 10000 },
          docs: { ambiguityCount: 0 },
        },
        newFeedback: ['Artifact name should include the candidate version.'],
      }),
      baseline,
    });

    const markdown = compare.renderComparisonMarkdown(result);

    expect(markdown).toContain('Recommendation: `block`');
    expect(markdown).toContain('## Regressions');
    expect(markdown).toContain('Install success');
    expect(markdown).toContain('## New Feedback');
    expect(markdown).toContain('Artifact name should include the candidate version.');
  });
});
