'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { buildRunPrompt, buildSummaryPrompt, type UpstreamInput } from '@/lib/ai/build-prompt';
import { AI_MODEL_IDS, getSummaryModelId, resolveAiModelSelection } from '@/lib/ai/models';
import {
  getAiProviderCredentialsSetupError,
  getProviderSetupPrompt,
  getUserAiProviderApiKey,
} from '@/lib/ai/credentials';
import { createAiCompletion } from '@/lib/ai/provider-completion';
import { isDataSourceNode, getDataSourceType } from '@/types/data-source';
import { fetchWebUrl } from '@/lib/fetch/fetch-web-url';
import { fetchGoogleDoc } from '@/lib/fetch/fetch-google-doc';
import { fetchGoogleSheet } from '@/lib/fetch/fetch-google-sheet';
import { fetchGoogleDriveSource } from '@/lib/integrations/google-drive/export';
import { formatSourceAge, isStaleSourceNode } from '@/lib/graph/source-freshness';
import { isGoogleDriveSourceConfig } from '@/types/data-source';
import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';

const createNodeSchema = z.object({
  graphId: z.string().uuid(),
  name: z.string().min(1).max(200),
  prompt: z.string().max(50000).optional(),
  nodeType: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  positionX: z.number(),
  positionY: z.number(),
});

const updateNodeSchema = z.object({
  nodeId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  prompt: z.string().max(50000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const deleteNodeSchema = z.object({
  nodeId: z.string().uuid(),
});

const runNodeSchema = z.object({
  nodeId: z.string().uuid(),
  llmModel: z.enum(AI_MODEL_IDS).optional(),
});

async function getUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

async function runDataSourceNode(
  supabase: ReturnType<typeof createServerClient>,
  node: BreakdownNode,
  userId: string,
): Promise<{
  data: { output: string; lastRunAt: string; metadata?: Record<string, unknown> } | null;
  error: string | null;
}> {
  const sourceType = getDataSourceType(node.node_type);
  if (!sourceType) {
    return { data: null, error: `Unknown source type: ${node.node_type}` };
  }

  // Text sources: copy prompt content directly to output
  if (sourceType === 'text') {
    if (!node.prompt) {
      return { data: null, error: 'No text content. Paste or type your text first.' };
    }

    const lastRunAt = new Date().toISOString();

    await supabase
      .from('nodes')
      .update({
        output: node.prompt,
        run_status: 'success',
        run_error: null,
        last_run_at: lastRunAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);

    return { data: { output: node.prompt, lastRunAt }, error: null };
  }

  const metadata = node.metadata ?? {};

  if (isGoogleDriveSourceConfig(metadata)) {
    await supabase
      .from('nodes')
      .update({ run_status: 'running', run_error: null, updated_at: new Date().toISOString() })
      .eq('id', node.id);

    try {
      const result = await fetchGoogleDriveSource(supabase, { node, userId });
      const updatedMetadata = { ...metadata, ...result.metadata };

      await supabase
        .from('nodes')
        .update({
          output: result.content,
          metadata: updatedMetadata,
          run_status: 'success',
          run_error: null,
          last_run_at: result.fetchedAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', node.id);

      return {
        data: {
          output: result.content,
          lastRunAt: result.fetchedAt,
          metadata: updatedMetadata,
        },
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Google Drive fetch error';

      await supabase
        .from('nodes')
        .update({
          run_status: 'error',
          run_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', node.id);

      return { data: null, error: message };
    }
  }

  const url = (metadata as { url?: string }).url;
  if (!url) {
    return { data: null, error: 'No URL configured. Enter a URL to fetch.' };
  }

  await supabase
    .from('nodes')
    .update({ run_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', node.id);

  try {
    let result: { content: string; fetchedAt: string };

    switch (sourceType) {
      case 'web-url':
        result = await fetchWebUrl(url);
        break;
      case 'google-doc':
        result = await fetchGoogleDoc(url);
        break;
      case 'google-sheet':
        result = await fetchGoogleSheet(url, (metadata as { sheetName?: string }).sheetName);
        break;
      case 'google-presentation':
        throw new Error('Google Presentations require a native Google Drive connection.');
    }

    await supabase
      .from('nodes')
      .update({
        output: result.content,
        run_status: 'success',
        run_error: null,
        last_run_at: result.fetchedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);

    return { data: { output: result.content, lastRunAt: result.fetchedAt }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';

    await supabase
      .from('nodes')
      .update({
        run_status: 'error',
        run_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);

    return { data: null, error: message };
  }
}

export async function createNode(
  input: z.infer<typeof createNodeSchema>,
): Promise<{ data: BreakdownNode | null; error: string | null }> {
  await getUserId();
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('nodes')
    .insert({
      graph_id: parsed.data.graphId,
      node_type: parsed.data.nodeType ?? 'default',
      name: parsed.data.name,
      prompt: parsed.data.prompt ?? '',
      metadata: parsed.data.metadata ?? {},
      position_x: parsed.data.positionX,
      position_y: parsed.data.positionY,
    })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as BreakdownNode, error: null };
}

export async function updateNode(
  input: z.infer<typeof updateNodeSchema>,
): Promise<{ data: BreakdownNode | null; error: string | null }> {
  await getUserId();
  const parsed = updateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.prompt !== undefined) updates.prompt = parsed.data.prompt;
  if (parsed.data.metadata !== undefined) updates.metadata = parsed.data.metadata;

  const { data, error } = await supabase
    .from('nodes')
    .update(updates)
    .eq('id', parsed.data.nodeId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as BreakdownNode, error: null };
}

export async function deleteNode(
  input: z.infer<typeof deleteNodeSchema>,
): Promise<{ error: string | null }> {
  await getUserId();
  const parsed = deleteNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('nodes').delete().eq('id', parsed.data.nodeId);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

export async function runNode(input: z.infer<typeof runNodeSchema>): Promise<{
  data: {
    output: string;
    summary?: string;
    lastRunAt: string;
    metadata?: Record<string, unknown>;
  } | null;
  error: string | null;
}> {
  const userId = await getUserId();
  const parsed = runNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();

  const { data: node, error: nodeError } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', parsed.data.nodeId)
    .single();

  if (nodeError || !node) {
    return { data: null, error: nodeError?.message ?? 'Node not found' };
  }

  const typedNode = node as BreakdownNode;

  // Branch: data source nodes fetch external content instead of calling Claude
  if (isDataSourceNode(typedNode.node_type)) {
    return runDataSourceNode(supabase, typedNode, userId);
  }

  if (!typedNode.prompt.trim()) {
    return { data: null, error: 'Node has no prompt. Write a task before running.' };
  }

  const { data: inboundEdges, error: edgesError } = await supabase
    .from('edges')
    .select('*')
    .eq('target_node_id', parsed.data.nodeId);

  if (edgesError) {
    return { data: null, error: edgesError.message };
  }

  const typedEdges = (inboundEdges ?? []) as BreakdownEdge[];
  const upstreamInputs: UpstreamInput[] = [];

  if (typedEdges.length > 0) {
    const sourceIds = typedEdges.map((e) => e.source_node_id);
    const { data: sourceNodes, error: sourceError } = await supabase
      .from('nodes')
      .select('*')
      .in('id', sourceIds);

    if (sourceError) {
      return { data: null, error: sourceError.message };
    }

    const sourceMap = new Map<string, BreakdownNode>();
    for (const sn of (sourceNodes ?? []) as BreakdownNode[]) {
      sourceMap.set(sn.id, sn);
    }

    const unavailableInputs: string[] = [];
    const staleInputs: string[] = [];

    for (const edge of typedEdges) {
      const sourceNode = sourceMap.get(edge.source_node_id);
      if (!sourceNode) {
        unavailableInputs.push('Unknown node');
        continue;
      }

      if (sourceNode.run_status !== 'success' || !sourceNode.output) {
        unavailableInputs.push(sourceNode.name);
        continue;
      }

      if (isStaleSourceNode(sourceNode)) {
        staleInputs.push(`${sourceNode.name} (${formatSourceAge(sourceNode.last_run_at)})`);
        continue;
      }

      upstreamInputs.push({
        nodeName: sourceNode.name,
        nodeOutput: sourceNode.output,
        edgeType: edge.edge_type,
      });
    }

    if (unavailableInputs.length > 0) {
      return {
        data: null,
        error: `Upstream input not ready: ${unavailableInputs.join(', ')}. Run or refresh it first.`,
      };
    }

    if (staleInputs.length > 0) {
      return {
        data: null,
        error: `Stale source input: ${staleInputs.join(', ')}. Use Run All or refresh the source before running this node.`,
      };
    }
  }

  const previousOutput = typedNode.output;

  const { data: graph, error: graphError } = await supabase
    .from('graphs')
    .select('llm_provider,llm_model')
    .eq('id', typedNode.graph_id)
    .eq('user_id', userId)
    .single();

  if (graphError || !graph) {
    return { data: null, error: graphError?.message ?? 'Graph not found' };
  }

  const { providerId, modelId: executionModel } = resolveAiModelSelection({
    providerId: (graph as { llm_provider?: string | null }).llm_provider,
    modelId: parsed.data.llmModel ?? (graph as { llm_model?: string | null }).llm_model,
  });

  let apiKey: string | null;
  try {
    apiKey = await getUserAiProviderApiKey(supabase, { userId, providerId });
  } catch (err) {
    return { data: null, error: getAiProviderCredentialsSetupError(err) };
  }

  if (!apiKey) {
    return { data: null, error: getProviderSetupPrompt(providerId) };
  }

  await supabase
    .from('nodes')
    .update({ run_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', parsed.data.nodeId);

  const prompt = buildRunPrompt(typedNode.prompt, upstreamInputs);

  try {
    const response = await createAiCompletion({
      apiKey,
      providerId,
      modelId: executionModel,
      maxTokens: 4096,
      system:
        'You are a reasoning assistant in a node-based analysis tool. Produce clear, structured output.',
      prompt,
    });

    const output = response.output;

    // Summary generation uses the same provider so each user only needs the key they selected.
    let summary: string | undefined;
    try {
      const summaryResponse = await createAiCompletion({
        apiKey,
        providerId,
        modelId: getSummaryModelId(providerId),
        maxTokens: 150,
        prompt: buildSummaryPrompt(output),
      });
      summary = summaryResponse.output.trim() || undefined;
    } catch {
      // Summary is non-critical; proceed without it.
    }

    const updatedMetadata = { ...typedNode.metadata, ...(summary ? { summary } : {}) };

    const lastRunAt = new Date().toISOString();

    await supabase
      .from('nodes')
      .update({
        output,
        metadata: updatedMetadata,
        run_status: 'success',
        run_error: null,
        last_run_at: lastRunAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.nodeId);

    await supabase.from('evaluations').insert({
      node_id: parsed.data.nodeId,
      trigger_type: 'manual',
      trigger_source: null,
      previous_conclusion: previousOutput,
      new_conclusion: output,
      previous_confidence: null,
      new_confidence: null,
      diff_summary: summary ?? null,
      skill_doc_id: null,
      llm_provider: providerId,
      llm_model: executionModel,
      prompt_tokens: response.inputTokens,
      completion_tokens: response.outputTokens,
      status: 'applied',
    });

    return { data: { output, summary, lastRunAt }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during AI evaluation';

    await supabase
      .from('nodes')
      .update({
        run_status: 'error',
        run_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.nodeId);

    return { data: null, error: message };
  }
}
