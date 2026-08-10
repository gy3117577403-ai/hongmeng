import { MajorQualityApprovalStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  loadMajorQualityApprovals,
  MAJOR_QUALITY_APPROVAL_STATUSES,
  MajorQualityApprovalError,
} from '@/lib/major-quality-approval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const rawStatus = String(request.nextUrl.searchParams.get('status') || '').toUpperCase();
    const status = rawStatus && rawStatus !== 'ALL'
      ? rawStatus as MajorQualityApprovalStatus
      : null;
    if (status && !MAJOR_QUALITY_APPROVAL_STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: '审批状态筛选不正确' }, { status: 400 });
    }
    const result = await loadMajorQualityApprovals(user, status);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof MajorQualityApprovalError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('major quality approvals failed', error);
    return NextResponse.json({ ok: false, error: '重大质量审批加载失败' }, { status: 500 });
  }
}
