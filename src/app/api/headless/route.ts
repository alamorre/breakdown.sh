import { getHeadlessApiDiscovery } from '@/lib/headless/discovery';
import { headlessOk } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

function originFor(request: Request) {
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  return headlessOk(getHeadlessApiDiscovery(originFor(request)));
}
