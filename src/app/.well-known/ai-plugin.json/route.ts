import { getAiPluginManifest } from '@/lib/headless/discovery';

export const dynamic = 'force-dynamic';

function originFor(request: Request) {
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  return Response.json(getAiPluginManifest(originFor(request)));
}
