import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { previewProcessReportSubmission } from '@/lib/process-report-submissions';
import { reportingRecoveryErrorResponse } from '@/lib/process-report-submission-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    return NextResponse.json({ ok: true, data: await previewProcessReportSubmission(params.id, user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return reportingRecoveryErrorResponse(error); }
}
