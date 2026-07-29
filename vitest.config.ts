import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'local/contracts/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/**/*.{ts,tsx}',
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
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/types/**'],
      thresholds: {
        lines: 26,
        'scripts/{build-local-release.mjs,local-release/*.mjs}': {
          lines: 80,
        },
      },
    },
  },
});
