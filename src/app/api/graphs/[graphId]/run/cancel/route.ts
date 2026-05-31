import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { cancelRun } from '@/lib/graph/run-cancellation';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  runId: z.string().min(1).max(100),
});

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: body.error.message }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: graph, error: graphError } = await supabase
    .from('graphs')
    .select('id')
    .eq('id', graphId)
    .eq('user_id', userId)
    .single();

  if (graphError || !graph) {
    return Response.json({ error: graphError?.message ?? 'Graph not found' }, { status: 404 });
  }

  try {
    await cancelRun(supabase, { graphId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to cancel run' },
      { status: 400 },
    );
  }

  return Response.json({ ok: true });
}
