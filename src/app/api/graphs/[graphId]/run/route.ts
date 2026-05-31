import { z } from 'zod';
import { getGraphRunStatus, runGraphWithScheduler } from '@/lib/graph/run-graph-execution';
import { RUN_GRAPH_STREAM_CONTENT_TYPE, type RunGraphStreamEvent } from '@/types/run-graph';

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

  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const write = (event: RunGraphStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          const result = await runGraphWithScheduler({
            graphId,
            runId: body.data.runId,
            onProgress: write,
          });

          if (result.error || !result.data) {
            write({ type: 'run-failed', error: result.error ?? 'Failed to run graph' });
          } else {
            write({ type: 'run-completed', data: result.data });
          }
        } catch (err) {
          write({
            type: 'run-failed',
            error: err instanceof Error ? err.message : 'Failed to run graph',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': RUN_GRAPH_STREAM_CONTENT_TYPE,
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const result = await runGraphWithScheduler({ graphId, runId: body.data.runId });
  const status = result.error ? (result.error === 'Unauthorized' ? 401 : 400) : 200;

  return Response.json(result, { status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  const result = await getGraphRunStatus(graphId);
  const status = result.error ? (result.error === 'Unauthorized' ? 401 : 400) : 200;

  return Response.json(result, { status });
}
