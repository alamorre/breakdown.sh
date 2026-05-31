import type { createServerClient } from '@/lib/supabase/server';

type SupabaseClient = ReturnType<typeof createServerClient>;

export async function cancelRun(supabase: SupabaseClient, input: { graphId: string }) {
  const { error } = await supabase
    .from('nodes')
    .update({
      run_status: 'cancelled',
      run_error: 'Run cancellation requested. In-flight nodes will finish before the run stops.',
      updated_at: new Date().toISOString(),
    })
    .eq('graph_id', input.graphId)
    .eq('run_status', 'queued');

  if (error) {
    throw new Error(error.message);
  }
}

export async function isRunCancelled(supabase: SupabaseClient, graphId: string) {
  const { data, error } = await supabase
    .from('nodes')
    .select('id')
    .eq('graph_id', graphId)
    .eq('run_status', 'cancelled')
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).length > 0;
}
