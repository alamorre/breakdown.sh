import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import {
  GOOGLE_DRIVE_MIME_TYPES,
  buildGoogleDriveSourceMetadata,
  getNodeTypeForDriveMimeType,
} from '@/lib/integrations/google-drive/source';
import { getActiveGoogleDriveConnection } from '@/lib/integrations/google-drive/connections';
import type { ThesisNode } from '@/types/node';

export const dynamic = 'force-dynamic';

const pickedFileSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().min(1).max(300),
  mimeType: z.enum([
    GOOGLE_DRIVE_MIME_TYPES.document,
    GOOGLE_DRIVE_MIME_TYPES.spreadsheet,
    GOOGLE_DRIVE_MIME_TYPES.presentation,
  ]),
  url: z.string().url(),
  iconUrl: z.string().url().optional(),
});

const createSourcesSchema = z.object({
  files: z.array(pickedFileSchema).min(1).max(20),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { graphId } = await params;
  const body = createSourcesSchema.safeParse(await request.json().catch(() => ({})));
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

  const connection = await getActiveGoogleDriveConnection(supabase, userId);
  if (!connection) {
    return Response.json({ error: 'Google Drive is not connected' }, { status: 404 });
  }

  const baseX = body.data.position?.x ?? 0;
  const baseY = body.data.position?.y ?? 0;
  const nodesToInsert = body.data.files.map((file, index) => ({
    graph_id: graphId,
    node_type: getNodeTypeForDriveMimeType(file.mimeType),
    name: file.name,
    prompt: '',
    metadata: buildGoogleDriveSourceMetadata({
      connectionId: connection.id,
      accountEmail: connection.account_email,
      file,
    }),
    position_x: baseX + (index % 3) * 300,
    position_y: baseY + Math.floor(index / 3) * 180,
  }));

  const { data, error } = await supabase.from('nodes').insert(nodesToInsert).select();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ data: (data ?? []) as ThesisNode[] });
}
