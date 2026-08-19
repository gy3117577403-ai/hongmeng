import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { issueDetailInclude, loadIssueById, parseIssueInput, serializeIssue, validateMajorQualityInput } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  canMutateIssueForProcess,
  isProcessIssueCollaborator,
} from '@/lib/process-collaboration-access';
import { IssueAssigneeAccessError, requireIssueAssigneeReady } from '@/lib/issue-assignee-access';
import { createSystemNotification } from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const issue = await loadIssueById(params.id);
    if (!issue) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('issue detail failed', error);
    return NextResponse.json({ ok: false, error: '问题详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const current = await prisma.issue.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        collaborators: { select: { employeeId: true } },
        majorApprovals: {
          select: { id: true, status: true },
        },
      },
    });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    if (!canMutateIssueForProcess(user, current, 'UPDATE')) {
      return NextResponse.json({
        ok: false,
        error: isProcessIssueCollaborator(user)
          ? '只能维护工艺问题或本人参与的问题'
          : '只能维护生产问题或本人参与的问题',
      }, { status: 403 });
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseIssueInput(body, true);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const values = parsed.data;
    const effectiveType = values.type ?? current.type;
    const effectiveMajor = values.isMajorQuality ?? current.isMajorQuality;
    const effectiveMajorReason = values.majorQualityReason !== undefined
      ? values.majorQualityReason
      : current.majorQualityReason;
    if (
      isProcessIssueCollaborator(user)
      && (effectiveType !== current.type || effectiveMajor !== current.isMajorQuality)
    ) {
      return NextResponse.json({ ok: false, error: '工艺账号不能修改问题类型或重大质量标记' }, { status: 403 });
    }
    const majorQualityError = validateMajorQualityInput({
      type: effectiveType,
      isMajorQuality: effectiveMajor,
      majorQualityReason: effectiveMajorReason,
    });
    if (majorQualityError) return NextResponse.json({ ok: false, error: majorQualityError }, { status: 400 });
    const pendingMajorApproval = current.majorApprovals.some(approval =>
      approval.status === 'PENDING_QUALITY_REVIEW' || approval.status === 'PENDING_GM_APPROVAL');
    if (pendingMajorApproval) {
      return NextResponse.json({ ok: false, error: '重大审批进行中，不能修改问题；请先退回处理' }, { status: 409 });
    }
    if (current.status === 'closed' && current.majorApprovals.some(approval => approval.status === 'APPROVED')) {
      return NextResponse.json({ ok: false, error: '已终审关闭的重大问题须先重新打开，才能修改内容' }, { status: 409 });
    }

    if (values.workOrderId) {
      const exists = await prisma.workOrder.findFirst({ where: { id: values.workOrderId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '关联工单不存在' }, { status: 404 });
    }
    const effectiveAssigneeEmployeeId = values.assigneeEmployeeId !== undefined
      ? values.assigneeEmployeeId
      : current.assigneeEmployeeId;
    const collaboratorEmployeeIds = values.collaboratorEmployeeIds
      ?.filter(id => id !== effectiveAssigneeEmployeeId) || undefined;
    const employeeIds = Array.from(new Set([
      ...(values.assigneeEmployeeId ? [values.assigneeEmployeeId] : []),
      ...(collaboratorEmployeeIds || []),
    ]));
    if (employeeIds.length) {
      const employees = await prisma.employee.count({ where: { id: { in: employeeIds }, isActive: true } });
      if (employees !== employeeIds.length) return NextResponse.json({ ok: false, error: '负责人或协同人员不存在、已离职或已停用' }, { status: 404 });
    }
    const nextAssignee = values.assigneeEmployeeId !== undefined
      ? await requireIssueAssigneeReady(prisma, values.assigneeEmployeeId)
      : null;

    const data: Prisma.IssueUncheckedUpdateInput = {};
    if (values.title !== undefined) data.title = values.title;
    if (values.type !== undefined) data.type = values.type;
    if (values.priority !== undefined) data.priority = values.priority;
    if (values.description !== undefined) data.description = values.description;
    if (values.workOrderId !== undefined) data.workOrderId = values.workOrderId;
    if (values.assigneeEmployeeId !== undefined) {
      data.assigneeEmployeeId = values.assigneeEmployeeId;
      data.assigneeId = null;
    }
    if (values.dueAt !== undefined) data.dueAt = values.dueAt;
    if (values.processName !== undefined) data.processName = values.processName;
    if (values.affectedQuantity !== undefined) data.affectedQuantity = values.affectedQuantity;
    if (values.temporaryMeasure !== undefined) data.temporaryMeasure = values.temporaryMeasure;
    if (values.rootCause !== undefined) data.rootCause = values.rootCause;
    if (values.solution !== undefined) data.solution = values.solution;
    if (values.verificationResult !== undefined) data.verificationResult = values.verificationResult;
    if (values.isMajorQuality !== undefined) data.isMajorQuality = values.isMajorQuality;
    if (values.majorQualityReason !== undefined || values.isMajorQuality === false) {
      data.majorQualityReason = effectiveMajor ? effectiveMajorReason : null;
    }
    if (!Object.keys(data).length && collaboratorEmployeeIds === undefined) return NextResponse.json({ ok: false, error: '没有可更新字段' }, { status: 400 });
    const changed = Object.keys(data);
    if (collaboratorEmployeeIds !== undefined) changed.push('collaboratorEmployeeIds');
    const currentCollaborators = current.collaborators.map(item => item.employeeId).sort().join(',');
    const nextCollaborators = collaboratorEmployeeIds?.slice().sort().join(',');
    const assignmentChanged = (values.assigneeEmployeeId !== undefined && values.assigneeEmployeeId !== current.assigneeEmployeeId)
      || (nextCollaborators !== undefined && nextCollaborators !== currentCollaborators);
    const assigneeChanged = values.assigneeEmployeeId !== undefined
      && values.assigneeEmployeeId !== current.assigneeEmployeeId;
    const action = assignmentChanged ? 'assign' : 'update';
    const issue = await prisma.$transaction(async tx => {
      const updated = await tx.issue.updateMany({
        where: {
          id: current.id,
          version: current.version,
          deletedAt: null,
          majorApprovals: {
            none: { status: { in: ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL'] } },
          },
        },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      if (collaboratorEmployeeIds !== undefined) {
        await tx.issueCollaborator.deleteMany({ where: { issueId: current.id } });
        if (collaboratorEmployeeIds.length) {
          await tx.issueCollaborator.createMany({
            data: collaboratorEmployeeIds.map(employeeId => ({ issueId: current.id, employeeId })),
            skipDuplicates: true,
          });
        }
      }
      await tx.issueActivity.create({
        data: {
          issueId: current.id,
          action,
          content: action === 'assign' ? '更新负责人' : '更新问题信息',
          actorId: user.id,
          detail: { fields: changed },
        },
      });
      const result = await tx.issue.findUniqueOrThrow({ where: { id: current.id }, include: issueDetailInclude });
      if (assigneeChanged && nextAssignee && nextAssignee.userId !== user.id) {
        await createSystemNotification(tx, {
          eventType: 'ISSUE_ASSIGNED',
          dedupeKey: `issue:${current.id}:assignment:${result.version}`,
          category: 'TODO',
          priority: result.priority === 'urgent' ? 'URGENT' : result.priority === 'high' ? 'HIGH' : 'NORMAL',
          title: `问题已分派给你：ISS-${String(result.sequence).padStart(6, '0')} ${result.title}`,
          body: '请进入问题管理查看详情、处理记录和截止时间。',
          targetRoute: `/workspace/issues?issueId=${encodeURIComponent(current.id)}`,
          sourceType: 'issue',
          sourceId: current.id,
          actorId: user.id,
          metadata: { issueSequence: result.sequence, assigneeEmployeeId: nextAssignee.employeeId },
          recipientUserIds: [nextAssignee.userId],
        });
      }
      return result;
    });
    if (!issue) {
      return NextResponse.json({ ok: false, error: '问题或审批状态已变化，请刷新后重试' }, { status: 409 });
    }
    await logOp({ userId: user.id, action: action === 'assign' ? 'assign_issue' : 'update_issue', targetType: 'issue', targetId: current.id, detail: { fields: changed } });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueAssigneeAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('issue update failed', error);
    return NextResponse.json({ ok: false, error: '问题更新失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const current = await prisma.issue.findFirst({
      where: { id: params.id, deletedAt: null },
      select: {
        id: true,
        sequence: true,
        version: true,
        majorApprovals: {
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    if (current.majorApprovals.length) {
      return NextResponse.json({ ok: false, error: '该问题已有重大审批记录，为保留审计链不能删除' }, { status: 409 });
    }
    const deleted = await prisma.$transaction(async tx => {
      const updated = await tx.issue.updateMany({
        where: {
          id: current.id,
          version: current.version,
          deletedAt: null,
          majorApprovals: { none: {} },
        },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count !== 1) return false;
      await tx.issueActivity.create({ data: { issueId: current.id, action: 'delete', content: '删除问题', actorId: user.id } });
      return true;
    });
    if (!deleted) {
      return NextResponse.json({ ok: false, error: '问题或审批状态已变化，请刷新后重试' }, { status: 409 });
    }
    await logOp({ userId: user.id, action: 'delete_issue', targetType: 'issue', targetId: current.id, detail: { sequence: current.sequence } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('issue delete failed', error);
    return NextResponse.json({ ok: false, error: '问题删除失败' }, { status: 500 });
  }
}
