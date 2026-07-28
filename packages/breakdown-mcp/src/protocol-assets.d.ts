import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const OPERATION_NAMES: readonly [
  'validate_workflow',
  'create_run',
  'inspect_run',
  'prepare_work',
  'read_work_input',
  'submit_candidate',
];
export const TOOL_CATALOG: Tool[];
