import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { issueDetailInclude, loadIssueById, parseIssueInput, serializeIssue } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const issue = await loadIssueById(params.id);
    if (!issue) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue detail failed', error);
    return NextResponse.json({ ok: false, error: '问题详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.issue.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { collaborators: { select: { employeeId: true } } },
    });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseIssueInput(body, true);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const values = parsed.data;

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
    if (!Object.keys(data).length && collaboratorEmployeeIds === undefined) return NextResponse.json({ ok: false, error: '没有可更新字段' }, { status: 400 });

    const changed = Object.keys(data);
    if (collaboratorEmployeeIds !== undefined) changed.push('collaboratorEmployeeIds');
    const currentCollaborators = current.collaborators.map(item => item.employeeId).sort().join(',');
    const nextCollaborators = collaboratorEmployeeIds?.slice().sort().join(',');
    const assignmentChanged = (values.assigneeEmployeeId !== undefined && values.assigneeEmployeeId !== current.assigneeEmployeeId)
      || (nextCollaborators !== undefined && nextCollaborators !== currentCollaborators);
    const action = assignmentChanged ? 'assign' : 'update';
    const issue = await prisma.$transaction(async tx => {
      if (Object.keys(data).length) await tx.issue.update({ where: { id: current.id }, data });
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
      return tx.issue.findUniqueOrThrow({ where: { id: current.id }, include: issueDetailInclude });
    });
    await logOp({ userId: user.id, action: action === 'assign' ? 'assign_issue' : 'update_issue', targetType: 'issue', targetId: current.id, detail: { fields: changed } });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue update failed', error);
    return NextResponse.json({ ok: false, error: '问题更新失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.issue.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, sequence: true } });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    await prisma.$transaction([
      prisma.issueActivity.create({ data: { issueId: current.id, action: 'delete', content: '删除问题', actorId: user.id } }),
      prisma.issue.update({ where: { id: current.id }, data: { deletedAt: new Date() } }),
    ]);
    await logOp({ userId: user.id, action: 'delete_issue', targetType: 'issue', targetId: current.id, detail: { sequence: current.sequence } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue delete failed', error);
    return NextResponse.json({ ok: false, error: '问题删除失败' }, { status: 500 });
  }
}
