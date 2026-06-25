import { z } from 'zod';
import { AI_MODEL_IDS } from '@/lib/ai/models';
import { EdgeType } from '@/types/edge';

export const jsonRecordSchema = z.record(z.string(), z.unknown());

export const uuidSchema = z.string().uuid();

export const createGraphSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  llmModel: z.enum(AI_MODEL_IDS).optional(),
});

export const updateGraphSchema = z.object({
  graphId: uuidSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  llmModel: z.enum(AI_MODEL_IDS).optional(),
});

export const createNodeSchema = z.object({
  graphId: uuidSchema,
  name: z.string().min(1).max(200),
  prompt: z.string().max(50000).optional(),
  nodeType: z.string().min(1).max(80).optional(),
  metadata: jsonRecordSchema.optional(),
  positionX: z.number(),
  positionY: z.number(),
});

export const updateNodeSchema = z.object({
  nodeId: uuidSchema,
  name: z.string().min(1).max(200).optional(),
  prompt: z.string().max(50000).optional(),
  output: z.string().max(250000).nullable().optional(),
  structuredOutput: jsonRecordSchema.nullable().optional(),
  nodeType: z.string().min(1).max(80).optional(),
  metadata: jsonRecordSchema.optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  runStatus: z
    .enum(['idle', 'queued', 'running', 'success', 'error', 'skipped', 'cancelled'])
    .optional(),
  runError: z.string().max(2000).nullable().optional(),
});

export const createEdgeSchema = z.object({
  graphId: uuidSchema,
  sourceNodeId: uuidSchema,
  targetNodeId: uuidSchema,
  edgeType: z.enum(EdgeType).or(z.string().min(1).max(80)),
  weight: z.number().min(0).max(1).optional(),
  condition: z.string().max(2000).nullable().optional(),
  transform: z.string().max(10000).nullable().optional(),
});

export const updateEdgeSchema = z.object({
  edgeId: uuidSchema,
  sourceNodeId: uuidSchema.optional(),
  targetNodeId: uuidSchema.optional(),
  edgeType: z.enum(EdgeType).or(z.string().min(1).max(80)).optional(),
  weight: z.number().min(0).max(1).optional(),
  condition: z.string().max(2000).nullable().optional(),
  transform: z.string().max(10000).nullable().optional(),
});

export const runNodeSchema = z.object({
  nodeId: uuidSchema,
  llmModel: z.enum(AI_MODEL_IDS).optional(),
});

export const runGraphSchema = z.object({
  graphId: uuidSchema,
  runId: z.string().min(1).max(100),
});

export const graphPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    clientId: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(200),
    prompt: z.string().max(50000).optional(),
    nodeType: z.string().min(1).max(80).optional(),
    metadata: jsonRecordSchema.optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  }),
  z.object({
    op: z.literal('update_node'),
    nodeId: uuidSchema,
    name: z.string().min(1).max(200).optional(),
    prompt: z.string().max(50000).optional(),
    nodeType: z.string().min(1).max(80).optional(),
    metadata: jsonRecordSchema.optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  }),
  z.object({
    op: z.literal('delete_node'),
    nodeId: uuidSchema,
    confirm: z.literal('delete_node'),
  }),
  z.object({
    op: z.literal('add_edge'),
    sourceNodeId: uuidSchema.optional(),
    sourceClientId: z.string().min(1).max(100).optional(),
    targetNodeId: uuidSchema.optional(),
    targetClientId: z.string().min(1).max(100).optional(),
    edgeType: z.enum(EdgeType).or(z.string().min(1).max(80)),
    weight: z.number().min(0).max(1).optional(),
    condition: z.string().max(2000).nullable().optional(),
    transform: z.string().max(10000).nullable().optional(),
  }),
  z.object({
    op: z.literal('update_edge'),
    edgeId: uuidSchema,
    sourceNodeId: uuidSchema.optional(),
    targetNodeId: uuidSchema.optional(),
    edgeType: z.enum(EdgeType).or(z.string().min(1).max(80)).optional(),
    weight: z.number().min(0).max(1).optional(),
    condition: z.string().max(2000).nullable().optional(),
    transform: z.string().max(10000).nullable().optional(),
  }),
  z.object({
    op: z.literal('delete_edge'),
    edgeId: uuidSchema,
    confirm: z.literal('delete_edge'),
  }),
]);

export const applyGraphPatchSchema = z.object({
  dryRun: z.boolean().default(true),
  operations: z.array(graphPatchOperationSchema).min(1).max(100),
});

export const importGraphSchema = z.object({
  mode: z.enum(['create', 'replace']).default('create'),
  graphId: uuidSchema.optional(),
  graph: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    llmProvider: z.string().nullable().optional(),
    llmModel: z.string().nullable().optional(),
    metadata: jsonRecordSchema.optional(),
  }),
  nodes: z.array(
    z.object({
      id: z.string().min(1).max(120).optional(),
      name: z.string().min(1).max(200),
      nodeType: z.string().min(1).max(80).default('default'),
      prompt: z.string().max(50000).default(''),
      output: z.string().max(250000).nullable().optional(),
      structuredOutput: jsonRecordSchema.nullable().optional(),
      metadata: jsonRecordSchema.default({}),
      runStatus: z
        .enum(['idle', 'queued', 'running', 'success', 'error', 'skipped', 'cancelled'])
        .default('idle'),
      runError: z.string().max(2000).nullable().optional(),
      lastRunAt: z.string().nullable().optional(),
      position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1).max(120).optional(),
      sourceNodeId: z.string().min(1),
      targetNodeId: z.string().min(1),
      edgeType: z.enum(EdgeType).or(z.string().min(1).max(80)),
      weight: z.number().min(0).max(1).default(1),
      condition: z.string().max(2000).nullable().optional(),
      transform: z.string().max(10000).nullable().optional(),
    }),
  ),
});

export const createExternalRunSchema = z.object({
  clientName: z.string().max(100).optional(),
  providerName: z.string().max(100).optional(),
  metadata: jsonRecordSchema.optional(),
});

export const submitExternalStepResultSchema = z.object({
  contextVersion: z.string().min(1).max(128),
  output: z.string().min(1).max(250000),
  structuredOutput: jsonRecordSchema.optional(),
  structuredSummary: jsonRecordSchema.optional(),
  citations: z
    .array(
      z.object({
        title: z.string().max(300).optional(),
        url: z.string().max(2000).optional(),
        source: z.string().max(300).optional(),
        accessedAt: z.string().max(100).optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .max(50)
    .default([]),
  clientName: z.string().max(100).optional(),
  providerName: z.string().max(100).optional(),
});

export const blockExternalStepSchema = z.object({
  contextVersion: z.string().min(1).max(128),
  reason: z.string().min(1).max(5000),
  requiredData: z.array(z.string().min(1).max(500)).max(50).default([]),
  clientName: z.string().max(100).optional(),
  providerName: z.string().max(100).optional(),
});

export const finalizeExternalRunSchema = z.object({
  allowIncomplete: z.boolean().default(false),
});
