export const BREAKDOWN_SCOPES = [
  'graphs:read',
  'graphs:write',
  'runs:execute',
  'runs:external_execute',
  'runs:write_results',
  'runs:cancel',
] as const;

export type BreakdownScope = (typeof BREAKDOWN_SCOPES)[number];

export const ALL_BREAKDOWN_SCOPES = [...BREAKDOWN_SCOPES] as BreakdownScope[];

export const RELEASE_TEST_SCOPES: BreakdownScope[] = [
  'graphs:read',
  'graphs:write',
  'runs:external_execute',
  'runs:write_results',
];
