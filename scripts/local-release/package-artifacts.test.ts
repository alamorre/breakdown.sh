import { describe, expect, it } from 'vitest';

import * as packageArtifacts from './package-artifacts.mjs';

type CommandResult = { stderr: string; stdout: string };
type Execute = (
  executable: string,
  arguments_: string[],
  options: Record<string, unknown>,
) => Promise<CommandResult>;
type RunPackageArtifactCommand = (
  command: string,
  arguments_: string[],
  options: Record<string, unknown>,
  environment: {
    comSpec?: string | null;
    execute: Execute;
    platform: NodeJS.Platform;
  },
) => Promise<CommandResult>;

const runPackageArtifactCommand = (
  packageArtifacts as unknown as {
    runPackageArtifactCommand: RunPackageArtifactCommand;
  }
).runPackageArtifactCommand;

describe('package artifact command launcher', () => {
  it('should launch npm through npm.cmd on Windows', async () => {
    const invocations: Array<{ arguments_: string[]; executable: string }> = [];

    await runPackageArtifactCommand(
      'npm',
      ['install', '--ignore-scripts'],
      { cwd: 'C:\\candidate-tools' },
      {
        platform: 'win32',
        comSpec: 'C:\\Windows\\System32\\cmd.exe',
        execute: async (executable, arguments_) => {
          invocations.push({ arguments_, executable });
          return { stderr: '', stdout: '' };
        },
      },
    );

    expect(invocations).toEqual([
      {
        executable: 'C:\\Windows\\System32\\cmd.exe',
        arguments_: ['/d', '/s', '/c', 'npm.cmd', 'install', '--ignore-scripts'],
      },
    ]);
  });

  it('should launch npm directly on POSIX platforms', async () => {
    const invocations: Array<{ arguments_: string[]; executable: string }> = [];

    await runPackageArtifactCommand(
      'npm',
      ['install', '--ignore-scripts'],
      { cwd: '/candidate-tools' },
      {
        platform: 'linux',
        execute: async (executable, arguments_) => {
          invocations.push({ arguments_, executable });
          return { stderr: '', stdout: '' };
        },
      },
    );

    expect(invocations).toEqual([
      {
        executable: 'npm',
        arguments_: ['install', '--ignore-scripts'],
      },
    ]);
  });

  it('should fall back to cmd.exe when Windows has no ComSpec', async () => {
    const invocations: Array<{ arguments_: string[]; executable: string }> = [];

    await runPackageArtifactCommand(
      'npm',
      ['install'],
      {},
      {
        platform: 'win32',
        comSpec: null,
        execute: async (executable, arguments_) => {
          invocations.push({ arguments_, executable });
          return { stderr: '', stdout: '' };
        },
      },
    );

    expect(invocations).toEqual([
      {
        executable: 'cmd.exe',
        arguments_: ['/d', '/s', '/c', 'npm.cmd', 'install'],
      },
    ]);
  });
});
