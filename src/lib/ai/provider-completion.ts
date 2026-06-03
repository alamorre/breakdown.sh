import { createClaudeClient } from '@/lib/ai/claude';
import { type AiModelId, type AiProviderId } from '@/lib/ai/models';

export type AiCompletionRequest = {
  apiKey: string;
  providerId: AiProviderId;
  modelId: AiModelId;
  system?: string;
  prompt: string;
  maxTokens: number;
};

export type AiCompletionResult = {
  output: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    message?: string;
  };
};

function getOpenAiOutput(data: OpenAiChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join('');
  }

  return '';
}

function getGeminiOutput(data: GeminiGenerateContentResponse): string {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join('') ?? ''
  );
}

async function createAnthropicCompletion(input: AiCompletionRequest): Promise<AiCompletionResult> {
  const claude = createClaudeClient(input.apiKey);
  const response = await claude.messages.create({
    model: input.modelId,
    max_tokens: input.maxTokens,
    ...(input.system ? { system: input.system } : {}),
    messages: [{ role: 'user', content: input.prompt }],
  });

  const outputBlock = response.content.find((block) => block.type === 'text');
  const output = outputBlock && 'text' in outputBlock ? outputBlock.text : '';

  return {
    output,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function createOpenAiCompletion(input: AiCompletionRequest): Promise<AiCompletionResult> {
  const messages = [
    ...(input.system ? [{ role: 'system', content: input.system }] : []),
    { role: 'user', content: input.prompt },
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.modelId,
      messages,
      max_completion_tokens: input.maxTokens,
    }),
  });
  const data = (await response.json().catch(() => null)) as OpenAiChatCompletionResponse | null;

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'OpenAI request failed');
  }

  return {
    output: data ? getOpenAiOutput(data) : '',
    inputTokens: data?.usage?.prompt_tokens ?? null,
    outputTokens: data?.usage?.completion_tokens ?? null,
  };
}

async function createGeminiCompletion(input: AiCompletionRequest): Promise<AiCompletionResult> {
  const prompt = input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.modelId}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: input.maxTokens,
        },
      }),
    },
  );
  const data = (await response.json().catch(() => null)) as GeminiGenerateContentResponse | null;

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'Gemini request failed');
  }

  return {
    output: data ? getGeminiOutput(data) : '',
    inputTokens: data?.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
  };
}

export async function createAiCompletion(input: AiCompletionRequest): Promise<AiCompletionResult> {
  switch (input.providerId) {
    case 'anthropic':
      return createAnthropicCompletion(input);
    case 'openai':
      return createOpenAiCompletion(input);
    case 'gemini':
      return createGeminiCompletion(input);
  }
}

export const testExports = {
  getGeminiOutput,
  getOpenAiOutput,
};
