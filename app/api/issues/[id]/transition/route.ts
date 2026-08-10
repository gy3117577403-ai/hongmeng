import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { ISSUE_STATUSES, issueDetailInclude, serializeIssue, transitionIssueData } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import {
  cancelPendingMajorQualityApproval,
  MajorQualityApprovalError,
  submitMajorQualityApproval,
} from '@/lib/major-quality-approval';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import type { IssueStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class IssueTransitionConflictError extends Error {}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const current = await prisma.issue.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const target = typeof body.status === 'string' ? body.status as IssueStatus : null;
    if (!target || !ISSUE_STATUSES.includes(target)) return NextResponse.json({ ok: false, error: '目标状态不正确' }, { status: 400 });
    const transition = transitionIssueData(current, target, body);
    if (transition.error) return NextResponse.json({ ok: false, error: transition.error }, { status: 409 });
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
    if (current.isMajorQuality && current.status === 'verifying' && target === 'closed') {
      return NextResponse.json({ ok: false, error: '重大质量问题须由总经办终审通过后自动关闭' }, { status: 409 });
    }
    if (current.isMajorQuality && current.status === 'verifying' && target === 'processing' && !comment) {
      return NextResponse.json({ ok: false, error: '撤回重大审批并退回处理时必须填写原因' }, { status: 400 });
    }

    const issue = await prisma.$transaction(async tx => {
      if (current.isMajorQuality && current.status === 'verifying' && target === 'processing') {
        await cancelPendingMajorQualityApproval(tx, current.id, user, comment);
      }
      const updated = await tx.issue.updateMany({
        where: { id: current.id, status: current.status, version: current.version, deletedAt: null },
        data: transition.data,
      });
      if (updated.count !== 1) throw new IssueTransitionConflictError();
      if (current.isMajorQuality && current.status === 'processing' && target === 'verifying') {
        await submitMajorQualityApproval(tx, current, user, current.version + 1);
      }
      await tx.issueActivity.create({
        data: {
          issueId: current.id,
          action: 'transition',
          content: comment || null,
          fromStatus: current.status,
          toStatus: target,
          actorId: user.id,
        },
      });
      return tx.issue.findUniqueOrThrow({ where: { id: current.id }, include: issueDetailInclude });
    });
    await logOp({ userId: user.id, action: 'transition_issue', targetType: 'issue', targetId: current.id, detail: { fromStatus: current.status, toStatus: target } });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueTransitionConflictError) {
      return NextResponse.json({ ok: false, error: '问题状态已发生变化，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof MajorQualityApprovalError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('issue transition failed', error);
    return NextResponse.json({ ok: false, error: '问题状态流转失败' }, { status: 500 });
  }
}
