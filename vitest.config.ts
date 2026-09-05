import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Also support package-local invocations, where Vitest resolves globs from that package.
    include: [
      'src/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'local/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'packages/breakdown-core/src/{canonical-json,index,run-inspection,unicode}.ts',
        'scripts/build-local-release.mjs',
        'scripts/local-release/command-line.mjs',
        'scripts/local-release/contracts-archive.mjs',
        'scripts/local-release/filesystem.mjs',
        'scripts/local-release/host-evidence.mjs',
        'scripts/local-release/package-artifacts.mjs',
        'scripts/local-release/platform-evidence.mjs',
        'scripts/local-release/platform-qualification.mjs',
        'scripts/local-release/release-inspection.mjs',
        'scripts/local-release/release-metadata.mjs',
        'scripts/local-release/skills-archive.mjs',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      thresholds: {
        'packages/breakdown-core/src/{canonical-json,index,run-inspection,unicode}.ts': {
          lines: 80,
        },
        'scripts/{build-local-release.mjs,local-release/*.mjs}': {
          lines: 80,
        },
      },
    },
  },
});
