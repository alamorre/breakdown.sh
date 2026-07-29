import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MCP_RELEASE_VERSION: string;
export const MCP_PROTOCOL_VERSIONS: readonly string[];
export const MCP_PREFERRED_PROTOCOL_VERSION: string;
export const MCP_SERVER_INFO: {
  readonly name: string;
  readonly title: string;
  readonly version: string;
};
export const OPERATION_NAMES: readonly [
  'validate_workflow',
  'create_run',
  'inspect_run',
  'prepare_work',
  'read_work_input',
  'submit_candidate',
];
export const TOOL_CATALOG: Tool[];
