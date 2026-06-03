export const THESIS_SCOPES = [
  'graphs:read',
  'graphs:write',
  'runs:execute',
  'runs:external_execute',
  'runs:write_results',
  'runs:cancel',
] as const;

export type ThesisScope = (typeof THESIS_SCOPES)[number];

export const ALL_THESIS_SCOPES = [...THESIS_SCOPES] as ThesisScope[];
