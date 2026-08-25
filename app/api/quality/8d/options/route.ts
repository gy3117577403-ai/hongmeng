import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import { loadEightDReportOptions } from '@/lib/eight-d-reports';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const options = await loadEightDReportOptions();
    return NextResponse.json({ ok: true, ...options });
  } catch (error) {
    return eightDRouteError(error, '8D关联选项加载失败');
  }
}
