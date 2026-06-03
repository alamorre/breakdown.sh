export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const OPENAI_PROVIDER_ID = 'openai';
export const GEMINI_PROVIDER_ID = 'gemini';

export const ANTHROPIC_MODEL_OPTIONS = [
  {
    id: 'claude-opus-4-8',
    provider: ANTHROPIC_PROVIDER_ID,
    family: 'opus',
    label: 'Opus',
  },
  {
    id: 'claude-sonnet-4-6',
    provider: ANTHROPIC_PROVIDER_ID,
    family: 'sonnet',
    label: 'Sonnet',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: ANTHROPIC_PROVIDER_ID,
    family: 'haiku',
    label: 'Haiku',
  },
] as const;

export const OPENAI_MODEL_OPTIONS = [
  {
    id: 'gpt-5.5',
    provider: OPENAI_PROVIDER_ID,
    family: 'frontier',
    label: 'GPT-5.5',
  },
  {
    id: 'gpt-5.4',
    provider: OPENAI_PROVIDER_ID,
    family: 'frontier',
    label: 'GPT-5.4',
  },
  {
    id: 'gpt-5.4-mini',
    provider: OPENAI_PROVIDER_ID,
    family: 'mini',
    label: 'GPT-5.4 mini',
  },
] as const;

export const GEMINI_MODEL_OPTIONS = [
  {
    id: 'gemini-2.5-pro',
    provider: GEMINI_PROVIDER_ID,
    family: 'pro',
    label: 'Gemini 2.5 Pro',
  },
  {
    id: 'gemini-2.5-flash',
    provider: GEMINI_PROVIDER_ID,
    family: 'flash',
    label: 'Gemini 2.5 Flash',
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: GEMINI_PROVIDER_ID,
    family: 'flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
  },
] as const;

export const AI_PROVIDER_OPTIONS = [
  {
    id: ANTHROPIC_PROVIDER_ID,
    label: 'Anthropic',
    defaultModelId: 'claude-sonnet-4-6',
    summaryModelId: 'claude-haiku-4-5-20251001',
    models: ANTHROPIC_MODEL_OPTIONS,
  },
  {
    id: OPENAI_PROVIDER_ID,
    label: 'OpenAI',
    defaultModelId: 'gpt-5.4',
    summaryModelId: 'gpt-5.4-mini',
    models: OPENAI_MODEL_OPTIONS,
  },
  {
    id: GEMINI_PROVIDER_ID,
    label: 'Gemini',
    defaultModelId: 'gemini-2.5-pro',
    summaryModelId: 'gemini-2.5-flash-lite',
    models: GEMINI_MODEL_OPTIONS,
  },
] as const;

export const AI_MODEL_OPTIONS = [
  ...ANTHROPIC_MODEL_OPTIONS,
  ...OPENAI_MODEL_OPTIONS,
  ...GEMINI_MODEL_OPTIONS,
] as const;

export type AiProviderOption = (typeof AI_PROVIDER_OPTIONS)[number];
export type AiProviderId = AiProviderOption['id'];
export type AiModelOption = (typeof AI_MODEL_OPTIONS)[number];
export type AiModelId = AiModelOption['id'];
export type AnthropicModelOption = (typeof ANTHROPIC_MODEL_OPTIONS)[number];
export type AnthropicModelId = AnthropicModelOption['id'];
export type AnthropicModelFamily = AnthropicModelOption['family'];

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = ANTHROPIC_PROVIDER_ID;
export const DEFAULT_AI_MODEL_ID: AiModelId = 'claude-sonnet-4-6';
export const DEFAULT_ANTHROPIC_MODEL_ID: AnthropicModelId = 'claude-sonnet-4-6';
export const ANTHROPIC_SUMMARY_MODEL_ID: AnthropicModelId = 'claude-haiku-4-5-20251001';

export const AI_PROVIDER_IDS = AI_PROVIDER_OPTIONS.map((option) => option.id) as [
  AiProviderId,
  ...AiProviderId[],
];

export const AI_MODEL_IDS = AI_MODEL_OPTIONS.map((option) => option.id) as [
  AiModelId,
  ...AiModelId[],
];

export const ANTHROPIC_MODEL_IDS = ANTHROPIC_MODEL_OPTIONS.map((option) => option.id) as [
  AnthropicModelId,
  ...AnthropicModelId[],
];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && AI_PROVIDER_OPTIONS.some((option) => option.id === value);
}

export function isAiModelId(value: unknown): value is AiModelId {
  return typeof value === 'string' && AI_MODEL_OPTIONS.some((option) => option.id === value);
}

export function isAnthropicModelId(value: unknown): value is AnthropicModelId {
  return typeof value === 'string' && ANTHROPIC_MODEL_OPTIONS.some((option) => option.id === value);
}

export function getAiProviderOption(providerId: string | null | undefined): AiProviderOption {
  return (
    AI_PROVIDER_OPTIONS.find((option) => option.id === providerId) ??
    AI_PROVIDER_OPTIONS.find((option) => option.id === DEFAULT_AI_PROVIDER_ID) ??
    AI_PROVIDER_OPTIONS[0]
  );
}

export function getAiModelOption(modelId: string | null | undefined): AiModelOption {
  return (
    AI_MODEL_OPTIONS.find((option) => option.id === modelId) ??
    AI_MODEL_OPTIONS.find((option) => option.id === DEFAULT_AI_MODEL_ID) ??
    AI_MODEL_OPTIONS[0]
  );
}

export function getProviderForModel(modelId: string | null | undefined): AiProviderId {
  return getAiModelOption(modelId).provider;
}

export function getSummaryModelId(providerId: AiProviderId): AiModelId {
  return getAiProviderOption(providerId).summaryModelId;
}

export function resolveAiModelSelection(input: {
  providerId?: string | null;
  modelId?: string | null;
}): { providerId: AiProviderId; modelId: AiModelId } {
  if (isAiModelId(input.modelId)) {
    const model = getAiModelOption(input.modelId);
    return { providerId: model.provider, modelId: model.id };
  }

  const provider = getAiProviderOption(input.providerId);
  return { providerId: provider.id, modelId: provider.defaultModelId };
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
