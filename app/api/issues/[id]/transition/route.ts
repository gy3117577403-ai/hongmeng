import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import {
  ISSUE_STATUSES,
  issueCollaborationBlockers,
  issueDetailInclude,
  issueTransitionAuthority,
  issueVerificationBlockers,
  issueVerificationBasis,
  serializeIssue,
  transitionIssueData,
} from '@/lib/issues';
import { logOp } from '@/lib/logs';
import {
  cancelPendingMajorQualityApproval,
  MajorQualityApprovalError,
  submitMajorQualityApproval,
} from '@/lib/major-quality-approval';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import type { IssueStatus } from '@/types';
import { canMutateIssueForProcess } from '@/lib/process-collaboration-access';
import {
  activeUserIdsForEmployees,
  createSystemNotification,
  issueParticipantUserIds,
} from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class IssueTransitionConflictError extends Error {}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const requestId = randomUUID();
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const current = await prisma.issue.findFirst({
      where: { id: params.id, deletedAt: null },
      include: issueDetailInclude,
    });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const target = typeof body.status === 'string' ? body.status as IssueStatus : null;
    if (!target || !ISSUE_STATUSES.includes(target)) return NextResponse.json({ ok: false, error: '目标状态不正确' }, { status: 400 });
    if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== current.version) {
      return NextResponse.json({ ok: false, code: 'ISSUE_VERSION_CONFLICT', error: '问题记录已变化或页面版本过旧，请刷新核对后再操作' }, { status: 409 });
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
    const authority = issueTransitionAuthority({
      currentStatus: current.status as IssueStatus,
      targetStatus: target,
      userId: user.id,
      employeeId: user.employeeId,
      laborRole: user.laborRole,
      reporterId: current.reporterId,
      verifierEmployeeId: current.verifierEmployeeId,
      hasWorkflowAccess: canMutateIssueForProcess(user, current, 'EXECUTE_WORKFLOW'),
      hasQualityWorkflow: hasCapability(user.access, 'QUALITY', 'EXECUTE_WORKFLOW'),
    });
    if (!authority.allowed) {
      return NextResponse.json({
        ok: false,
        error: current.status === 'awaiting_confirmation'
          ? '只有问题发起人可以确认完结或退回处理'
          : current.status === 'verifying'
            ? '只有指定验证人或质量负责人可以提交验证结论'
            : current.status === 'closed'
              ? '只有问题发起人可以重新打开已关闭问题'
              : '只能流转工艺问题或本人参与的问题',
      }, { status: 403 });
    }
    if (authority.adminOverride && !comment) {
      return NextResponse.json({ ok: false, error: '管理员代操作必须填写审计说明' }, { status: 400 });
    }
    if (target === 'processing' && current.status !== 'pending') {
      if (!comment) return NextResponse.json({ ok: false, error: '退回或重新打开时必须填写说明' }, { status: 400 });
    }
    const transition = transitionIssueData(current, target, body, new Date(), user.id);
    if (transition.error) return NextResponse.json({ ok: false, error: transition.error }, { status: 409 });
    if (current.status === 'processing' && target === 'verifying') {
      const rootCause = typeof body.rootCause === 'string' ? body.rootCause.trim() : current.rootCause;
      const solution = typeof body.solution === 'string' ? body.solution.trim() : current.solution;
      const blockers = issueVerificationBlockers({
        assigneeEmployeeId: current.assigneeEmployeeId,
        verifierEmployeeId: current.verifierEmployeeId,
        rootCause,
        solution,
        attachmentCount: current.attachments.length,
        isMajorQuality: current.isMajorQuality,
        activities: current.activities,
      });
      if (blockers.length) {
        return NextResponse.json({
          ok: false,
          error: `闭环资料尚未完整：${blockers.join('、')}`,
          blockers,
        }, { status: 409 });
      }
    }
    if (target === 'awaiting_confirmation' || target === 'closed') {
      const blockers = issueCollaborationBlockers(current.activities);
      if (blockers.length) return NextResponse.json({ ok: false, code: 'ISSUE_CLOSURE_BLOCKED', error: blockers.join('；'), blockers }, { status: 409 });
    }
    if (current.isMajorQuality && current.status === 'verifying' && target === 'awaiting_confirmation') {
      return NextResponse.json({ ok: false, error: '重大质量问题须先完成质量复核和总经办终审' }, { status: 409 });
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
          detail: {
            workflowAction: `${current.status}->${target}`,
            adminOverride: authority.adminOverride,
            actorLaborRole: user.laborRole,
            actorUserId: user.id,
            verificationBasis: target === 'closed' ? issueVerificationBasis(current) : null,
          },
        },
      });
      const recipientUserIds = target === 'verifying' && current.verifierEmployeeId
        ? await activeUserIdsForEmployees(tx, [current.verifierEmployeeId], { excludeUserIds: [user.id] })
        : target === 'awaiting_confirmation'
          ? (!current.reporterId || current.reporterId === user.id ? [] : [current.reporterId])
          : await issueParticipantUserIds(tx, current.id, { excludeUserIds: [user.id] });
      if (recipientUserIds.length) {
        const code = `ISS-${String(current.sequence).padStart(6, '0')}`;
        await createSystemNotification(tx, {
          eventType: target === 'verifying' ? 'ISSUE_SUBMITTED_FOR_VERIFICATION'
            : target === 'awaiting_confirmation' ? 'ISSUE_AWAITING_REQUESTER_CONFIRMATION'
              : target === 'closed' ? 'ISSUE_CLOSED'
                : 'ISSUE_RETURNED_TO_PROCESSING',
          dedupeKey: `issue:${current.id}:transition:${current.version + 1}:${target}`,
          category: target === 'verifying' || target === 'awaiting_confirmation' ? 'TODO' : 'SYSTEM',
          priority: current.priority === 'urgent' ? 'URGENT' : current.priority === 'high' ? 'HIGH' : 'NORMAL',
          title: target === 'verifying' ? `问题待你验证：${code} ${current.title}`
            : target === 'awaiting_confirmation' ? `问题待你确认完结：${code} ${current.title}`
              : target === 'closed' ? `问题已由发起人确认完结：${code} ${current.title}`
                : `问题已退回处理：${code} ${current.title}`,
          body: comment || (target === 'verifying'
            ? '处理资料已齐全，请在闭环控制台验证。'
            : target === 'awaiting_confirmation'
              ? '验证已通过，请发起人核对结果后确认完结或退回处理。'
              : '请进入问题协同作战室查看状态变更。'),
          targetRoute: `/workspace/issues?issueId=${encodeURIComponent(current.id)}`,
          sourceType: 'issue',
          sourceId: current.id,
          actorId: user.id,
          metadata: { issueSequence: current.sequence, fromStatus: current.status, toStatus: target },
          recipientUserIds,
        });
      }
      return tx.issue.findUniqueOrThrow({ where: { id: current.id }, include: issueDetailInclude });
    });
    await logOp({
      userId: user.id,
      action: 'transition_issue',
      targetType: 'issue',
      targetId: current.id,
      detail: {
        fromStatus: current.status,
        toStatus: target,
        adminOverride: authority.adminOverride,
        comment: comment || null,
      },
    });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue, user) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueTransitionConflictError) {
      return NextResponse.json({ ok: false, code: 'ISSUE_VERSION_CONFLICT', error: '问题状态已发生变化，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof MajorQualityApprovalError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('issue transition failed', { requestId, error });
    return NextResponse.json({ ok: false, code: 'ISSUE_TRANSITION_FAILED', requestId, error: '问题操作未能确认成功，请刷新核对结果后重试；持续失败请联系管理员并提供追踪号' }, { status: 500 });
  }
}
