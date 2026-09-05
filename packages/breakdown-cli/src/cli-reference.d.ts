import type { OperationFailure } from '@breakdown-sh/core';

// Values are emitted by scripts/generate-protocol-validator.mjs during build.
export const CLI_VERSION: string;
export const CLI_USAGE: string;
export const CLI_EXIT_CODES: Readonly<
  Record<'success' | 'usage' | OperationFailure['failure']['kind'], number>
>;
export const HUMAN_STDERR_LIMIT_BYTES: number;
