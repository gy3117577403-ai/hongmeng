import { NextResponse } from 'next/server';
import { appInfo } from '@/lib/app-info';
import { getSystemReadiness } from '@/lib/system-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const readiness = await getSystemReadiness();
  return NextResponse.json({
    ok: readiness.ok,
    service: 'hongmeng-workorder-resource',
    app: appInfo(),
    database: readiness.database,
    storage: readiness.storage,
    time: new Date().toISOString(),
  }, { status: readiness.ok ? 200 : 503 });
}
