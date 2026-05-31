import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { cancelRun } from '@/lib/graph/run-cancellation';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  runId: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: body.error.message }, { status: 400 });
  }

  cancelRun(body.data.runId);
  return Response.json({ ok: true });
}
