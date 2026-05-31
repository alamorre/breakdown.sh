import { z } from 'zod';
import { runGraphWithScheduler } from '@/lib/graph/run-graph-execution';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  runId: z.string().min(1).max(100),
});

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return Response.json({ data: null, error: body.error.message }, { status: 400 });
  }

  const result = await runGraphWithScheduler({ graphId, runId: body.data.runId });
  const status = result.error ? (result.error === 'Unauthorized' ? 401 : 400) : 200;

  return Response.json(result, { status });
}
