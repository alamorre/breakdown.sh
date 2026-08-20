import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { runVitestLog, summarizeQualificationFailure } from './platform-qualification.mjs';

const repositoryRoot = join(import.meta.dirname, '../..');

describe('platform qualification workflow', () => {
  it('should build one candidate and qualify its exact bytes on all four native runners', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-platform-qualification.yml'),
      'utf8',
    );

    expect(workflow.match(/pnpm local:release:build/g)).toHaveLength(1);
    for (const runner of ['ubuntu-24.04', 'ubuntu-24.04-arm', 'macos-15-intel', 'macos-15']) {
      expect(workflow, runner).toContain(`runner: ${runner}`);
    }
    expect(workflow).not.toContain('windows-2025');
    expect(workflow).toContain('fail-fast: false');
    expect(workflow).toContain('BREAKDOWN_QUALIFICATION_RUNNER_LABEL: ${{ matrix.runner }}');
    expect(workflow).toContain('pnpm local:release:qualify');
    expect(workflow).toContain('pnpm local:release:index-platform');
    expect(workflow).toContain('actions/setup-node@v7');
    expect(workflow).toContain('actions/upload-artifact@v7');
    expect(workflow).toContain('actions/download-artifact@v8');
    expect(workflow).toMatch(/if: \$\{\{ always\(\) \}\}[\s\S]+platform-evidence/);
  });

  it('should retain distinct timeout and assertion diagnostics', async () => {
    const fixtureRoot = await mkdtemp(join(repositoryRoot, '.breakdown-qualification-report-'));
    try {
      const testPath = join(fixtureRoot, 'failure-shapes.test.ts');
      const logPath = join(fixtureRoot, 'qualification-report.json');
      await writeFile(
        testPath,
        `import { expect, it } from 'vitest';

it('times out', async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
}, 1);

it('fails an assertion', () => {
  expect('actual').toBe('expected');
});
`,
      );

      const report = await runVitestLog({
        environment: {},
        logPath,
        repositoryRoot,
        testPaths: [testPath],
      });
      const assertions = report.testResults[0].assertionResults;

      expect(assertions[0].failureMessages[0]).toContain('Error: STACK_TRACE_ERROR');
      expect(assertions[1].failureMessages[0]).toContain(
        "AssertionError: expected 'actual' to be 'expected'",
      );
      const stderr = stripVTControlCharacters(report.qualification_process.stderr);
      expect(stderr).toContain('Error: Test timed out in 1ms.');
      expect(stderr).toContain("AssertionError: expected 'actual' to be 'expected'");
      const summary = summarizeQualificationFailure('diagnostic-fixture', report);
      expect(summary).toContain('[diagnostic-fixture] exit 1');
      expect(summary).toContain('Error: Test timed out in 1ms.');
      expect(summary).toContain("AssertionError: expected 'actual' to be 'expected'");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
