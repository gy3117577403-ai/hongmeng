import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { cancelProcessReportSubmission, resolveProcessReportSubmission } from '@/lib/process-report-submissions';
import type { ReportSubmissionResolutionInput } from '@/lib/process-report-submission-contract';
import { reportingRecoveryErrorResponse } from '@/lib/process-report-submission-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    if (req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return NextResponse.json({ ok: false, error: '请提交 JSON 格式请求' }, { status: 415 });
    const body = await req.json() as ReportSubmissionResolutionInput & { action?: string };
    if (body.action === 'CANCEL') return NextResponse.json({ ok: true, pending: false, data: await cancelProcessReportSubmission(params.id, user.id, body.expectedVersion) });
    const result = await resolveProcessReportSubmission(params.id, user.id, body);
    return result.pending ? NextResponse.json({ ok: true, pending: true, submission: result.submission }, { status: 202 })
      : NextResponse.json({ ok: true, pending: false, data: result.submission });
  } catch (error) { return reportingRecoveryErrorResponse(error); }
}
