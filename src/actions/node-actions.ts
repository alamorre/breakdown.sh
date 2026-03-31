'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { createClaudeClient } from '@/lib/ai/claude';
import { buildRunPrompt, buildSummaryPrompt, type UpstreamInput } from '@/lib/ai/build-prompt';
import { isDataSourceNode, getDataSourceType } from '@/types/data-source';
import { fetchWebUrl } from '@/lib/fetch/fetch-web-url';
import { fetchGoogleDoc } from '@/lib/fetch/fetch-google-doc';
import { fetchGoogleSheet } from '@/lib/fetch/fetch-google-sheet';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';

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
});

const runGraphSchema = z.object({
  graphId: z.string().uuid(),
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
  node: ThesisNode,
): Promise<{ data: { output: string } | null; error: string | null }> {
  const sourceType = getDataSourceType(node.node_type);
  if (!sourceType) {
    return { data: null, error: `Unknown source type: ${node.node_type}` };
  }

  // Text sources: copy prompt content directly to output
  if (sourceType === 'text') {
    if (!node.prompt) {
      return { data: null, error: 'No text content. Paste or type your text first.' };
    }

    await supabase
      .from('nodes')
      .update({
        output: node.prompt,
        run_status: 'success',
        run_error: null,
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);

    return { data: { output: node.prompt }, error: null };
  }

  const metadata = node.metadata ?? {};
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

    return { data: { output: result.content }, error: null };
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
): Promise<{ data: ThesisNode | null; error: string | null }> {
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

  return { data: data as ThesisNode, error: null };
}

export async function updateNode(
  input: z.infer<typeof updateNodeSchema>,
): Promise<{ data: ThesisNode | null; error: string | null }> {
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

  return { data: data as ThesisNode, error: null };
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

export async function runNode(
  input: z.infer<typeof runNodeSchema>,
): Promise<{ data: { output: string; summary?: string } | null; error: string | null }> {
  await getUserId();
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

  const typedNode = node as ThesisNode;

  // Branch: data source nodes fetch external content instead of calling Claude
  if (isDataSourceNode(typedNode.node_type)) {
    return runDataSourceNode(supabase, typedNode);
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

  const typedEdges = (inboundEdges ?? []) as ThesisEdge[];
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

    const sourceMap = new Map<string, ThesisNode>();
    for (const sn of (sourceNodes ?? []) as ThesisNode[]) {
      sourceMap.set(sn.id, sn);
    }

    for (const edge of typedEdges) {
      const sourceNode = sourceMap.get(edge.source_node_id);
      upstreamInputs.push({
        nodeName: sourceNode?.name ?? 'Unknown',
        nodeOutput: sourceNode?.output ?? '[not yet run]',
        edgeType: edge.edge_type,
      });
    }
  }

  const previousOutput = typedNode.output;

  await supabase
    .from('nodes')
    .update({ run_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', parsed.data.nodeId);

  const prompt = buildRunPrompt(typedNode.prompt, upstreamInputs);

  try {
    const claude = createClaudeClient();
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system:
        'You are a reasoning assistant in a node-based analysis tool. Produce clear, structured output.',
      messages: [{ role: 'user', content: prompt }],
    });

    const outputBlock = response.content.find((block) => block.type === 'text');
    const output = outputBlock && 'text' in outputBlock ? outputBlock.text : '';

    // Generate a 1-sentence summary via a fast model
    let summary: string | undefined;
    try {
      const summaryResponse = await claude.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: buildSummaryPrompt(output) }],
      });
      const summaryBlock = summaryResponse.content.find((block) => block.type === 'text');
      summary = summaryBlock && 'text' in summaryBlock ? summaryBlock.text.trim() : undefined;
    } catch {
      // Summary is non-critical — proceed without it
    }

    const updatedMetadata = { ...typedNode.metadata, ...(summary ? { summary } : {}) };

    await supabase
      .from('nodes')
      .update({
        output,
        metadata: updatedMetadata,
        run_status: 'success',
        run_error: null,
        last_run_at: new Date().toISOString(),
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
      llm_provider: 'anthropic',
      llm_model: 'claude-sonnet-4-5-20250929',
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      status: 'applied',
    });

    return { data: { output, summary }, error: null };
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

/** Topological sort using Kahn's algorithm */
function topologicalSort(nodes: ThesisNode[], edges: ThesisEdge[]): ThesisNode[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeMap = new Map<string, ThesisNode>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    const current = inDegree.get(edge.target_node_id) ?? 0;
    inDegree.set(edge.target_node_id, current + 1);
    const neighbors = adjacency.get(edge.source_node_id) ?? [];
    neighbors.push(edge.target_node_id);
    adjacency.set(edge.source_node_id, neighbors);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sorted: ThesisNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(current) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        queue.push(neighbor);
      }
    }
  }

  return sorted;
}

export async function runGraph(input: z.infer<typeof runGraphSchema>): Promise<{
  data: { results: Array<{ nodeId: string; output: string | null; error: string | null }> } | null;
  error: string | null;
}> {
  await getUserId();
  const parsed = runGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();

  const [nodesResult, edgesResult] = await Promise.all([
    supabase.from('nodes').select('*').eq('graph_id', parsed.data.graphId),
    supabase.from('edges').select('*').eq('graph_id', parsed.data.graphId),
  ]);

  if (nodesResult.error) {
    return { data: null, error: nodesResult.error.message };
  }
  if (edgesResult.error) {
    return { data: null, error: edgesResult.error.message };
  }

  const allNodes = (nodesResult.data ?? []) as ThesisNode[];
  const allEdges = (edgesResult.data ?? []) as ThesisEdge[];
  const sorted = topologicalSort(allNodes, allEdges);

  const outputCache = new Map<string, string | null>();
  for (const node of allNodes) {
    outputCache.set(node.id, node.output);
  }

  const results: Array<{ nodeId: string; output: string | null; error: string | null }> = [];

  for (const node of sorted) {
    // Data source nodes: fetch external content
    if (isDataSourceNode(node.node_type)) {
      const fetchResult = await runDataSourceNode(supabase, node);
      if (fetchResult.data) {
        outputCache.set(node.id, fetchResult.data.output);
      }
      results.push({
        nodeId: node.id,
        output: fetchResult.data?.output ?? null,
        error: fetchResult.error,
      });
      continue;
    }

    if (!node.prompt.trim()) {
      results.push({ nodeId: node.id, output: null, error: 'No prompt' });
      continue;
    }

    const inboundEdges = allEdges.filter((e) => e.target_node_id === node.id);
    const upstreamInputs: UpstreamInput[] = inboundEdges.map((edge) => {
      const sourceNode = allNodes.find((n) => n.id === edge.source_node_id);
      return {
        nodeName: sourceNode?.name ?? 'Unknown',
        nodeOutput: outputCache.get(edge.source_node_id) ?? '[not yet run]',
        edgeType: edge.edge_type,
      };
    });

    const previousOutput = node.output;
    const prompt = buildRunPrompt(node.prompt, upstreamInputs);

    await supabase
      .from('nodes')
      .update({ run_status: 'running', updated_at: new Date().toISOString() })
      .eq('id', node.id);

    try {
      const claude = createClaudeClient();
      const response = await claude.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system:
          'You are a reasoning assistant in a node-based analysis tool. Produce clear, structured output.',
        messages: [{ role: 'user', content: prompt }],
      });

      const outputBlock = response.content.find((block) => block.type === 'text');
      const output = outputBlock && 'text' in outputBlock ? outputBlock.text : '';

      // Generate a 1-sentence summary via a fast model
      let summary: string | undefined;
      try {
        const summaryResponse = await claude.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: buildSummaryPrompt(output) }],
        });
        const summaryBlock = summaryResponse.content.find((block) => block.type === 'text');
        summary = summaryBlock && 'text' in summaryBlock ? summaryBlock.text.trim() : undefined;
      } catch {
        // Summary is non-critical
      }

      const updatedMetadata = { ...node.metadata, ...(summary ? { summary } : {}) };

      await supabase
        .from('nodes')
        .update({
          output,
          metadata: updatedMetadata,
          run_status: 'success',
          run_error: null,
          last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', node.id);

      outputCache.set(node.id, output);

      await supabase.from('evaluations').insert({
        node_id: node.id,
        trigger_type: 'manual',
        trigger_source: null,
        previous_conclusion: previousOutput,
        new_conclusion: output,
        previous_confidence: null,
        new_confidence: null,
        diff_summary: summary ?? null,
        skill_doc_id: null,
        llm_provider: 'anthropic',
        llm_model: 'claude-sonnet-4-5-20250929',
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        status: 'applied',
      });

      results.push({ nodeId: node.id, output, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      await supabase
        .from('nodes')
        .update({
          run_status: 'error',
          run_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', node.id);

      results.push({ nodeId: node.id, output: null, error: message });
    }
  }

  return { data: { results }, error: null };
}
