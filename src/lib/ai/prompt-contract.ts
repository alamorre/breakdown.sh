import type { BreakdownEdge } from '@/types/edge';
import type { BreakdownNode } from '@/types/node';

export type PromptContractSource = 'metadata' | 'legacy-metadata' | 'default';

export interface NodePromptContract {
  version: 'node-prompt-contract.v1';
  objective: string;
  role?: string;
  requiredInputs?: Array<{
    name: string;
    source: 'upstream' | 'host_tool' | 'user' | 'current_data' | 'external_source';
    required: boolean;
  }>;
  method?: string[];
  toolPolicy?: {
    requiresCurrentData?: boolean;
    suggestedHostTools?: string[];
    blockWhenUnavailable?: boolean;
    hostToolInstructions?: string;
  };
  outputContract: {
    format: 'json' | 'markdown+json';
    schema: Record<string, unknown>;
    markdownSections?: string[];
  };
  acceptanceCriteria?: string[];
  citationRequirements?: {
    required: boolean;
    minCount?: number;
    requireAccessedAt?: boolean;
  };
}

export interface ResolvedNodePromptContract {
  contract: NodePromptContract;
  source: PromptContractSource;
  structuredOutputRequired: boolean;
}

export interface NodeExecutionUpstreamInput {
  edgeId?: string;
  sourceNodeId?: string;
  nodeName: string;
  nodeOutput: string | null;
  structuredOutput?: Record<string, unknown> | null;
  edgeType: string;
  condition?: string | null;
  transform?: string | null;
  runStatus?: string | null;
  lastRunAt?: string | null;
  stale?: boolean;
  freshnessWarning?: string | null;
}

export interface NodeExecutionPrompt {
  executionPrompt: string;
  contract: NodePromptContract;
  contractSource: PromptContractSource;
  outputContract: NodePromptContract['outputContract'];
  outputSchema: Record<string, unknown>;
  structuredOutputRequired: boolean;
}

const DEFAULT_STRUCTURED_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['summary', 'findings', 'dataGaps'],
  additionalProperties: true,
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    dataGaps: { type: 'array', items: { type: 'string' } },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === 'string' && Boolean(item.trim()),
  );
  return values.length > 0 ? values : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function schemaRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function normalizeContract(value: unknown): NodePromptContract | null {
  if (!isRecord(value) || value.version !== 'node-prompt-contract.v1') return null;
  const outputContract = isRecord(value.outputContract) ? value.outputContract : null;
  const schema = outputContract ? schemaRecord(outputContract.schema) : undefined;
  const format = outputContract?.format;
  if (!schema || (format !== 'json' && format !== 'markdown+json')) return null;

  const objective = optionalString(value.objective);
  if (!objective) return null;

  const toolPolicy = isRecord(value.toolPolicy)
    ? {
        requiresCurrentData:
          typeof value.toolPolicy.requiresCurrentData === 'boolean'
            ? value.toolPolicy.requiresCurrentData
            : undefined,
        suggestedHostTools: stringArray(value.toolPolicy.suggestedHostTools),
        blockWhenUnavailable:
          typeof value.toolPolicy.blockWhenUnavailable === 'boolean'
            ? value.toolPolicy.blockWhenUnavailable
            : undefined,
        hostToolInstructions: optionalString(value.toolPolicy.hostToolInstructions),
      }
    : undefined;

  const citationRequirements = isRecord(value.citationRequirements)
    ? {
        required: value.citationRequirements.required === true,
        minCount:
          typeof value.citationRequirements.minCount === 'number'
            ? value.citationRequirements.minCount
            : undefined,
        requireAccessedAt: value.citationRequirements.requireAccessedAt === true,
      }
    : undefined;

  return {
    version: 'node-prompt-contract.v1',
    objective,
    role: optionalString(value.role),
    requiredInputs: Array.isArray(value.requiredInputs)
      ? value.requiredInputs.filter(isRecord).map((input) => ({
          name: optionalString(input.name) ?? 'Unnamed input',
          source:
            input.source === 'host_tool' ||
            input.source === 'user' ||
            input.source === 'current_data' ||
            input.source === 'external_source'
              ? input.source
              : 'upstream',
          required: input.required !== false,
        }))
      : undefined,
    method: stringArray(value.method),
    toolPolicy,
    outputContract: {
      format,
      schema,
      markdownSections: stringArray(outputContract?.markdownSections),
    },
    acceptanceCriteria: stringArray(value.acceptanceCriteria),
    citationRequirements,
  };
}

function looksLikeCurrentDataWork(node: BreakdownNode, metadata: Record<string, unknown>) {
  if (metadata.requiresCurrentData === true) return true;
  const text = `${node.name}\n${node.prompt}`.toLowerCase();
  return [
    'current',
    'latest',
    'recent',
    'stock',
    'ticker',
    'market data',
    'filing',
    'valuation',
    'financial statement',
  ].some((needle) => text.includes(needle));
}

function upstreamRequiredInputs(
  upstreamInputs: NodeExecutionUpstreamInput[] = [],
): NodePromptContract['requiredInputs'] {
  if (upstreamInputs.length === 0) return undefined;
  return upstreamInputs.map((input) => ({
    name: input.nodeName,
    source: 'upstream',
    required: ['depends_on', 'inputs_to', 'sequences_before'].includes(input.edgeType),
  }));
}

function buildDefaultContract(
  node: BreakdownNode,
  upstreamInputs: NodeExecutionUpstreamInput[] = [],
): NodePromptContract {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const acceptanceCriteria = stringArray(metadata.acceptanceCriteria);
  const expectedOutput = optionalString(metadata.expectedOutput);
  const requiresCurrentData = looksLikeCurrentDataWork(node, metadata);
  const suggestedHostTools = stringArray(metadata.suggestedHostTools);
  const hostToolInstructions = optionalString(metadata.hostToolInstructions);

  return {
    version: 'node-prompt-contract.v1',
    objective: node.prompt.trim() || `Complete the Breakdown node "${node.name}".`,
    role: 'Reasoning step executor in a node-based analysis workflow.',
    requiredInputs: upstreamRequiredInputs(upstreamInputs),
    method: [
      'Restate the task in the context of this node and its upstream inputs.',
      'Use upstream outputs as evidence, preserving caveats and unresolved questions.',
      'Separate facts, assumptions, uncertainty, and data gaps.',
      ...(expectedOutput
        ? [`Shape the answer toward this expected output: ${expectedOutput}`]
        : []),
    ],
    toolPolicy: {
      requiresCurrentData,
      suggestedHostTools,
      blockWhenUnavailable: requiresCurrentData,
      hostToolInstructions:
        hostToolInstructions ??
        'Use host-console tools when the task requires facts beyond the provided graph context. If required data or tools are unavailable, report a data gap instead of fabricating facts.',
    },
    outputContract: {
      format: 'markdown+json',
      schema: DEFAULT_STRUCTURED_OUTPUT_SCHEMA,
      markdownSections: ['Summary', 'Evidence', 'Assumptions And Gaps', 'Next Handoff'],
    },
    acceptanceCriteria: acceptanceCriteria ?? [
      'Answer the node objective directly.',
      'Use upstream inputs only where they are relevant.',
      'Call out unsupported claims, missing data, and open questions.',
      'Return a structuredOutput payload that matches the output schema.',
    ],
    citationRequirements: {
      required: requiresCurrentData,
      minCount: requiresCurrentData ? 1 : 0,
      requireAccessedAt: requiresCurrentData,
    },
  };
}

export function resolveNodePromptContract(
  node: BreakdownNode,
  upstreamInputs: NodeExecutionUpstreamInput[] = [],
): ResolvedNodePromptContract {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const explicit = normalizeContract(metadata.promptContract ?? metadata.nodePromptContract);
  if (explicit) {
    return { contract: explicit, source: 'metadata', structuredOutputRequired: true };
  }

  const contract = buildDefaultContract(node, upstreamInputs);
  const hasLegacyMetadata =
    metadata.expectedOutput !== undefined ||
    metadata.acceptanceCriteria !== undefined ||
    metadata.requiresCurrentData !== undefined ||
    metadata.suggestedHostTools !== undefined ||
    metadata.hostToolInstructions !== undefined;

  return {
    contract,
    source: hasLegacyMetadata ? 'legacy-metadata' : 'default',
    structuredOutputRequired: false,
  };
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function renderUpstreamInputs(upstreamInputs: NodeExecutionUpstreamInput[]) {
  if (upstreamInputs.length === 0) {
    return 'No upstream inputs are connected. Treat the node prompt as the primary task, and state assumptions or missing inputs explicitly.';
  }

  return upstreamInputs
    .map((input, index) => {
      const details = [
        `Input ${index + 1}: ${input.nodeName}`,
        `Edge type: ${input.edgeType}`,
        input.condition ? `Condition: ${input.condition}` : null,
        input.transform ? `Transform instruction: ${input.transform}` : null,
        input.runStatus ? `Run status: ${input.runStatus}` : null,
        input.lastRunAt ? `Last run at: ${input.lastRunAt}` : null,
        input.freshnessWarning ? `Freshness warning: ${input.freshnessWarning}` : null,
        '',
        'Human-readable output:',
        input.nodeOutput ?? '[no output available]',
        input.structuredOutput
          ? `\nStructured output:\n${formatJson(input.structuredOutput)}`
          : null,
      ].filter((line): line is string => line !== null);
      return details.join('\n');
    })
    .join('\n\n---\n\n');
}

function renderList(values: string[] | undefined, fallback: string) {
  if (!values || values.length === 0) return fallback;
  return values.map((value) => `- ${value}`).join('\n');
}

function renderRequiredInputs(contract: NodePromptContract) {
  if (!contract.requiredInputs || contract.requiredInputs.length === 0) {
    return '- No required inputs were declared beyond the node prompt.';
  }
  return contract.requiredInputs
    .map(
      (input) => `- ${input.name} (${input.source}; ${input.required ? 'required' : 'optional'})`,
    )
    .join('\n');
}

function renderToolPolicy(contract: NodePromptContract) {
  const policy = contract.toolPolicy;
  if (!policy) {
    return 'Use available host tools only when the task requires facts beyond the graph context.';
  }

  return [
    `Requires current data: ${policy.requiresCurrentData ? 'yes' : 'no'}`,
    policy.suggestedHostTools?.length
      ? `Suggested host tools: ${policy.suggestedHostTools.join(', ')}`
      : null,
    `Block or report data gaps when unavailable: ${
      policy.blockWhenUnavailable ? 'yes' : 'report explicit gaps'
    }`,
    policy.hostToolInstructions ?? null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function renderCitationRequirements(contract: NodePromptContract) {
  const requirements = contract.citationRequirements;
  if (!requirements?.required) {
    return 'Citations are required for external facts and useful for any non-obvious evidence.';
  }

  return [
    `Citations are required. Minimum count: ${requirements.minCount ?? 1}.`,
    requirements.requireAccessedAt
      ? 'Include accessedAt/source timestamps when the host tool provides them.'
      : null,
    'If required sources cannot be reached, include the missing source in structuredOutput.dataGaps.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function buildNodeExecutionPrompt(input: {
  node: BreakdownNode;
  inboundEdges?: BreakdownEdge[];
  upstreamInputs?: NodeExecutionUpstreamInput[];
  mode: 'internal' | 'external';
}): NodeExecutionPrompt {
  const upstreamInputs = input.upstreamInputs ?? [];
  const resolved = resolveNodePromptContract(input.node, upstreamInputs);
  const { contract } = resolved;
  const markdownSections = contract.outputContract.markdownSections?.length
    ? contract.outputContract.markdownSections.join(', ')
    : 'Summary, Evidence, Assumptions And Gaps, Next Handoff';

  const executionPrompt = [
    '# Breakdown Node Execution Prompt',
    '',
    `Execution mode: ${input.mode}`,
    `Node: ${input.node.name}`,
    `Node id: ${input.node.id}`,
    `Node type: ${input.node.node_type}`,
    '',
    '## Objective',
    contract.objective,
    '',
    '## Role',
    contract.role ?? 'Reasoning step executor in a node-based analysis workflow.',
    '',
    '## User-Written Node Prompt',
    input.node.prompt.trim() || '[empty prompt]',
    '',
    '## Required Inputs',
    renderRequiredInputs(contract),
    '',
    '## Upstream Inputs',
    renderUpstreamInputs(upstreamInputs),
    '',
    '## Tool And Source Policy',
    renderToolPolicy(contract),
    '',
    '## Method',
    renderList(
      contract.method,
      '- Analyze the task carefully.\n- Preserve uncertainty and data gaps.\n- Prepare output for downstream graph nodes.',
    ),
    '',
    '## Evidence And Citations',
    renderCitationRequirements(contract),
    '',
    '## Acceptance Checklist',
    renderList(contract.acceptanceCriteria, '- Satisfy the objective and output contract.'),
    '',
    '## Output Contract',
    `Format: ${contract.outputContract.format}`,
    `Markdown sections: ${markdownSections}`,
    'Structured output JSON Schema:',
    formatJson(contract.outputContract.schema),
    '',
    'Return concise human-readable output for the node, then end with a fenced `json` block containing ONLY the structuredOutput object that satisfies the schema above.',
    'Do not invent missing facts. Put unavailable required data in structuredOutput.dataGaps and explain the impact in the human-readable output.',
  ].join('\n');

  return {
    executionPrompt,
    contract,
    contractSource: resolved.source,
    outputContract: contract.outputContract,
    outputSchema: contract.outputContract.schema,
    structuredOutputRequired: resolved.structuredOutputRequired,
  };
}

function findJsonFence(text: string): string | null {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const fence of fences.reverse()) {
    const body = fence[1]?.trim();
    if (body?.startsWith('{')) return body;
  }
  return null;
}

export function parseStructuredOutputFromText(output: string): Record<string, unknown> | null {
  const candidates = [findJsonFence(output), output.trim()].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) {
        return isRecord(parsed.structuredOutput) ? parsed.structuredOutput : parsed;
      }
    } catch {
      // Try the next parse candidate.
    }
  }

  return null;
}

export function fallbackStructuredOutput(
  output: string,
  citations: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  const summary =
    output
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 500) || 'Completed step output.';

  return {
    summary,
    findings: [],
    dataGaps: [],
    citations,
  };
}

function jsonType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function deepEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateJsonSchema(value: unknown, schema: unknown, path = '$'): string[] {
  if (!isRecord(schema)) return [];
  const errors: string[] = [];

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(item, value))) {
    errors.push(
      `${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`,
    );
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }

  const allowedTypes = Array.isArray(schema.type)
    ? schema.type.filter((type): type is string => typeof type === 'string')
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];
  if (allowedTypes.length > 0) {
    const actual = jsonType(value);
    const typeMatches = allowedTypes.some((type) =>
      type === 'number' ? actual === 'number' || actual === 'integer' : actual === type,
    );
    if (!typeMatches) {
      errors.push(`${path} must be ${allowedTypes.join(' or ')}, received ${actual}`);
      return errors;
    }
  }

  if (schema.type === 'object' || isRecord(schema.properties) || Array.isArray(schema.required)) {
    if (!isRecord(value)) {
      errors.push(`${path} must be object, received ${jsonType(value)}`);
      return errors;
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const key of required) {
      if (value[key] === undefined) errors.push(`${path}.${key} is required`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (value[key] !== undefined) {
        errors.push(...validateJsonSchema(value[key], propertySchema, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (schema.type === 'array' || schema.items !== undefined) {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be array, received ${jsonType(value)}`);
      return errors;
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`));
      });
    }
  }

  if (schema.type === 'string' && typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} character(s)`);
    }
  }

  return errors;
}

function dataGapsFromStructuredOutput(structuredOutput: Record<string, unknown>) {
  const value = structuredOutput.dataGaps ?? structuredOutput.data_gaps;
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

export function validateNodeStructuredOutput(input: {
  contract: NodePromptContract;
  structuredOutput: Record<string, unknown> | null | undefined;
  citations?: Array<Record<string, unknown>>;
}): { ok: true } | { ok: false; errors: string[] } {
  if (!input.structuredOutput) {
    return { ok: false, errors: ['structuredOutput is required for this node contract.'] };
  }

  const errors = validateJsonSchema(input.structuredOutput, input.contract.outputContract.schema);
  const dataGaps = dataGapsFromStructuredOutput(input.structuredOutput);
  const citations = input.citations ?? [];
  const citationRequirements = input.contract.citationRequirements;
  const needsCurrentData = input.contract.toolPolicy?.requiresCurrentData === true;

  if ((citationRequirements?.required || needsCurrentData) && dataGaps.length === 0) {
    const minCount = citationRequirements?.minCount ?? 1;
    if (citations.length < minCount) {
      errors.push(
        `At least ${minCount} citation(s) or an explicit structuredOutput.dataGaps entry are required.`,
      );
    }
    if (citationRequirements?.requireAccessedAt) {
      for (const [index, citation] of citations.entries()) {
        if (typeof citation.accessedAt !== 'string' || !citation.accessedAt.trim()) {
          errors.push(`citations[${index}].accessedAt is required.`);
        }
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
