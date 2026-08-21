import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import {
  issueDetailInclude,
  parseIssueCollaborationInput,
  serializeIssue,
} from '@/lib/issues';
import { IssueAssigneeAccessError, requireIssueAssigneeReady } from '@/lib/issue-assignee-access';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { canMutateIssueForProcess } from '@/lib/process-collaboration-access';
import {
  activeUserIdsForEmployees,
  createSystemNotification,
  issueParticipantUserIds,
} from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function detailText(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' && item.trim() ? item : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const issue = await prisma.issue.findFirst({
      where: { id: params.id, deletedAt: null },
      select: {
        id: true,
        sequence: true,
        title: true,
        priority: true,
        type: true,
        isMajorQuality: true,
        reporterId: true,
        assigneeEmployeeId: true,
        collaborators: { select: { employeeId: true } },
      },
    });
    if (!issue) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    if (!canMutateIssueForProcess(user, issue, 'UPDATE')) {
      return NextResponse.json({ ok: false, error: '只能补充工艺问题或本人参与的问题' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseIssueCollaborationInput(body);
    if (!parsed.data || parsed.errors.length) {
      return NextResponse.json({ ok: false, error: parsed.errors[0] || '协同记录格式不正确' }, { status: 400 });
    }
    const input = parsed.data;
    const taskAssignee = input.kind === 'task'
      ? await requireIssueAssigneeReady(prisma, input.assigneeEmployeeId)
      : null;

    let target: {
      id: string;
      action: string;
      actorId: string | null;
      detail: unknown;
    } | null = null;
    if (input.targetActivityId) {
      target = await prisma.issueActivity.findFirst({
        where: { id: input.targetActivityId, issueId: issue.id },
        select: { id: true, action: true, actorId: true, detail: true },
      });
      const expectedAction = input.kind === 'task_complete' ? 'task_create' : 'decision_create';
      if (!target || target.action !== expectedAction) {
        return NextResponse.json({ ok: false, error: '目标协同记录不存在或类型不匹配' }, { status: 404 });
      }
      if (input.kind === 'task_complete') {
        const assignedEmployeeId = detailText(target.detail, 'assigneeEmployeeId');
        const canComplete = target.actorId === user.id
          || (!!assignedEmployeeId && assignedEmployeeId === user.employeeId)
          || hasCapability(user.access, 'QUALITY', 'EXECUTE_WORKFLOW');
        if (!canComplete) {
          return NextResponse.json({ ok: false, error: '只有待办负责人、创建人或质量负责人可以完成该待办' }, { status: 403 });
        }
      }
    }

    const action = input.kind === 'task' ? 'task_create'
      : input.kind === 'task_complete' ? 'task_complete'
        : input.kind === 'decision' ? 'decision_create'
          : input.kind === 'decision_response'
            ? input.decision === 'approve' ? 'decision_approve' : 'decision_return'
            : 'comment';
    const detail = input.kind === 'task'
      ? {
          assigneeEmployeeId: input.assigneeEmployeeId || null,
          assigneeName: taskAssignee?.employeeName || null,
          dueAt: input.dueAt?.toISOString() || null,
        }
      : input.kind === 'decision'
        ? { dueAt: input.dueAt?.toISOString() || null }
        : input.targetActivityId
          ? { targetActivityId: input.targetActivityId }
          : undefined;

    const activity = await prisma.$transaction(async tx => {
      if (input.targetActivityId) {
        const duplicate = await tx.issueActivity.findFirst({
          where: {
            issueId: issue.id,
            action: input.kind === 'task_complete'
              ? 'task_complete'
              : { in: ['decision_approve', 'decision_return'] },
            detail: { path: ['targetActivityId'], equals: input.targetActivityId },
          },
          select: { id: true },
        });
        if (duplicate) return null;
      }
      const created = await tx.issueActivity.create({
        data: {
          issueId: issue.id,
          action,
          content: input.content || null,
          actorId: user.id,
          detail,
        },
      });
      await tx.issue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } });

      const participantIds = await issueParticipantUserIds(tx, issue.id, { excludeUserIds: [user.id] });
      const taskRecipientIds = taskAssignee
        ? await activeUserIdsForEmployees(tx, [taskAssignee.employeeId], { excludeUserIds: [user.id] })
        : [];
      const recipientUserIds = input.kind === 'task' ? taskRecipientIds : participantIds;
      if (recipientUserIds.length) {
        const code = `ISS-${String(issue.sequence).padStart(6, '0')}`;
        const eventType = input.kind === 'task' ? 'ISSUE_TASK_ASSIGNED'
          : input.kind === 'task_complete' ? 'ISSUE_TASK_COMPLETED'
            : input.kind === 'decision' ? 'ISSUE_DECISION_REQUESTED'
              : input.kind === 'decision_response' ? 'ISSUE_DECISION_RESPONDED'
                : 'ISSUE_COLLABORATION_UPDATED';
        const title = input.kind === 'task' ? `收到问题待办：${code} ${issue.title}`
          : input.kind === 'task_complete' ? `问题待办已完成：${code} ${issue.title}`
            : input.kind === 'decision' ? `问题需要协同决策：${code} ${issue.title}`
              : input.kind === 'decision_response' ? `问题决策已有结论：${code} ${issue.title}`
                : `问题有新回复：${code} ${issue.title}`;
        await createSystemNotification(tx, {
          eventType,
          dedupeKey: `issue:${issue.id}:activity:${created.id}`,
          category: input.kind === 'comment' ? 'SYSTEM' : 'TODO',
          priority: issue.priority === 'urgent' ? 'URGENT' : issue.priority === 'high' ? 'HIGH' : 'NORMAL',
          title,
          body: input.content || '请进入问题作战室查看最新协同记录。',
          targetRoute: `/workspace/issues?issueId=${encodeURIComponent(issue.id)}`,
          sourceType: 'issue',
          sourceId: issue.id,
          actorId: user.id,
          metadata: { issueSequence: issue.sequence, activityId: created.id, activityAction: action },
          recipientUserIds,
        });
      }
      return created;
    });
    if (!activity) {
      return NextResponse.json({ ok: false, error: '该待办或决策已经处理，请刷新后查看' }, { status: 409 });
    }
    const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id }, include: issueDetailInclude });
    await logOp({
      userId: user.id,
      action: `issue_${action}`,
      targetType: 'issue',
      targetId: issue.id,
      detail: { activityId: activity.id, targetActivityId: input.targetActivityId || null },
    });
    return NextResponse.json({ ok: true, issue: serializeIssue(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueAssigneeAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('issue collaboration activity failed', error);
    return NextResponse.json({ ok: false, error: '协同记录保存失败' }, { status: 500 });
  }
}
