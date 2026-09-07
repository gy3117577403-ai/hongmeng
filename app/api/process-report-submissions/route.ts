import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { listProcessReportSubmissions } from '@/lib/process-report-submissions';
import { reportingRecoveryErrorResponse } from '@/lib/process-report-submission-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const data = await listProcessReportSubmissions(user.id, {
      status: req.nextUrl.searchParams.get('status') || undefined,
      keyword: req.nextUrl.searchParams.get('keyword') || undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') || 30),
      offset: Number(req.nextUrl.searchParams.get('offset') || 0),
    });
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return reportingRecoveryErrorResponse(error); }
}
