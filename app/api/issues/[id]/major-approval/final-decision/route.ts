import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  decideMajorQualityApproval,
  MajorQualityApprovalError,
  parseMajorQualityDecision,
} from '@/lib/major-quality-approval';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireCapability('MAJOR_APPROVAL', 'APPROVE');
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
    const expectedVersion = Number(body.expectedVersion);
    if (!approvalId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return NextResponse.json({ ok: false, error: '审批记录或版本不正确' }, { status: 400 });
    }
    const approval = await decideMajorQualityApproval(user, {
      issueId: params.id,
      approvalId,
      expectedVersion,
      decision: parseMajorQualityDecision(body.decision),
      note: typeof body.note === 'string' ? body.note : '',
    });
    return NextResponse.json({ ok: true, approval });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof MajorQualityApprovalError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('major quality final decision failed', error);
    return NextResponse.json({ ok: false, error: '重大质量终审失败' }, { status: 500 });
  }
}
