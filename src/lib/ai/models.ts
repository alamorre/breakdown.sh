export const ANTHROPIC_MODEL_OPTIONS = [
  {
    id: 'claude-opus-4-8',
    family: 'opus',
    label: 'Opus',
  },
  {
    id: 'claude-sonnet-4-6',
    family: 'sonnet',
    label: 'Sonnet',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    family: 'haiku',
    label: 'Haiku',
  },
] as const;

export type AnthropicModelOption = (typeof ANTHROPIC_MODEL_OPTIONS)[number];
export type AnthropicModelId = AnthropicModelOption['id'];
export type AnthropicModelFamily = AnthropicModelOption['family'];

export const DEFAULT_ANTHROPIC_MODEL_ID: AnthropicModelId = 'claude-sonnet-4-6';
export const ANTHROPIC_SUMMARY_MODEL_ID: AnthropicModelId = 'claude-haiku-4-5-20251001';

export const ANTHROPIC_MODEL_IDS = ANTHROPIC_MODEL_OPTIONS.map((option) => option.id) as [
  AnthropicModelId,
  ...AnthropicModelId[],
];

export function isAnthropicModelId(value: unknown): value is AnthropicModelId {
  return typeof value === 'string' && ANTHROPIC_MODEL_OPTIONS.some((option) => option.id === value);
}

export function resolveAnthropicModelId(value: string | null | undefined): AnthropicModelId {
  return isAnthropicModelId(value) ? value : DEFAULT_ANTHROPIC_MODEL_ID;
}

export function getAnthropicModelOption(modelId: string | null | undefined): AnthropicModelOption {
  const resolvedModelId = resolveAnthropicModelId(modelId);
  return (
    ANTHROPIC_MODEL_OPTIONS.find((option) => option.id === resolvedModelId) ??
    ANTHROPIC_MODEL_OPTIONS[1]
  );
}
