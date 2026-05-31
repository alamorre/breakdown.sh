import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? 'unknown',
      databaseTarget: process.env.NEXT_PUBLIC_PREVIEW_DATABASE_TARGET ?? 'unknown',
      commitSha: process.env.NEXT_PUBLIC_PREVIEW_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
