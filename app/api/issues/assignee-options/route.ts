import { NextResponse } from 'next/server';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { listIssueAssigneeOptions } from '@/lib/issue-assignee-access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    if (
      !hasCapability(user.access, 'QUALITY', 'UPDATE')
      && !hasCapability(user.access, 'ISSUE_MANAGEMENT', 'READ')
    ) throw new ForbiddenError();
    const employees = await listIssueAssigneeOptions(prisma);
    return NextResponse.json({
      ok: true,
      employees,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('issue assignee options failed', error);
    return NextResponse.json({ ok: false, error: '问题负责人列表加载失败' }, { status: 500 });
  }
}
