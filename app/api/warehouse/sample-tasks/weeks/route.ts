import { NextRequest } from 'next/server';
import { GET as sampleWeeks } from '@/app/api/sample-tasks/weeks/route';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  url.searchParams.set('warehouse', 'true'); url.searchParams.set('purpose', 'PRODUCTION');
  return sampleWeeks(new NextRequest(url, { headers: req.headers }));
}
