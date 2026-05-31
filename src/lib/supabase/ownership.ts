import type { createServerClient } from '@/lib/supabase/server';
import type { ThesisEdge } from '@/types/edge';
import type { ThesisNode } from '@/types/node';

type Supabase = ReturnType<typeof createServerClient>;

type NodeGraphRow = {
  id: string;
  graph_id: string;
};

export async function verifyGraphOwnership(
  supabase: Supabase,
  userId: string,
  graphId: string,
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('graphs')
    .select('id')
    .eq('id', graphId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { error: 'Graph not found' };
  }

  return { error: null };
}

export async function getOwnedNode(
  supabase: Supabase,
  userId: string,
  nodeId: string,
): Promise<{ data: ThesisNode | null; error: string | null }> {
  const { data, error } = await supabase.from('nodes').select('*').eq('id', nodeId).single();

  if (error || !data) {
    return { data: null, error: 'Node not found' };
  }

  const node = data as ThesisNode;
  const ownership = await verifyGraphOwnership(supabase, userId, node.graph_id);
  if (ownership.error) {
    return { data: null, error: 'Node not found' };
  }

  return { data: node, error: null };
}

export async function getOwnedEdge(
  supabase: Supabase,
  userId: string,
  edgeId: string,
): Promise<{ data: ThesisEdge | null; error: string | null }> {
  const { data, error } = await supabase.from('edges').select('*').eq('id', edgeId).single();

  if (error || !data) {
    return { data: null, error: 'Edge not found' };
  }

  const edge = data as ThesisEdge;
  const ownership = await verifyGraphOwnership(supabase, userId, edge.graph_id);
  if (ownership.error) {
    return { data: null, error: 'Edge not found' };
  }

  return { data: edge, error: null };
}

export async function verifyNodesBelongToGraph(
  supabase: Supabase,
  graphId: string,
  nodeIds: string[],
): Promise<{ error: string | null }> {
  const uniqueNodeIds = Array.from(new Set(nodeIds));
  if (uniqueNodeIds.length === 0) {
    return { error: null };
  }

  const { data, error } = await supabase
    .from('nodes')
    .select('id, graph_id')
    .in('id', uniqueNodeIds);

  if (error) {
    return { error: error.message };
  }

  const rows = (data ?? []) as NodeGraphRow[];
  const matchingNodeIds = new Set(
    rows.filter((row) => row.graph_id === graphId).map((row) => row.id),
  );

  if (matchingNodeIds.size !== uniqueNodeIds.length) {
    return { error: 'Nodes must belong to the graph' };
  }

  return { error: null };
}
