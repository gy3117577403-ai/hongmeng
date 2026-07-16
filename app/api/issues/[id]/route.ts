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
    const current = await prisma.issue.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseIssueInput(body, true);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const values = parsed.data;

    if (values.workOrderId) {
      const exists = await prisma.workOrder.findFirst({ where: { id: values.workOrderId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '关联工单不存在' }, { status: 404 });
    }
    if (values.assigneeId) {
      const exists = await prisma.user.findFirst({ where: { id: values.assigneeId, isActive: true }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '负责人不存在或已停用' }, { status: 404 });
    }

    const data: Prisma.IssueUncheckedUpdateInput = {};
    if (values.title !== undefined) data.title = values.title;
    if (values.type !== undefined) data.type = values.type;
    if (values.priority !== undefined) data.priority = values.priority;
    if (values.description !== undefined) data.description = values.description;
    if (values.workOrderId !== undefined) data.workOrderId = values.workOrderId;
    if (values.assigneeId !== undefined) data.assigneeId = values.assigneeId;
    if (values.dueAt !== undefined) data.dueAt = values.dueAt;
    if (values.rootCause !== undefined) data.rootCause = values.rootCause;
    if (values.solution !== undefined) data.solution = values.solution;
    if (values.verificationResult !== undefined) data.verificationResult = values.verificationResult;
    if (!Object.keys(data).length) return NextResponse.json({ ok: false, error: '没有可更新字段' }, { status: 400 });

    const changed = Object.keys(data);
    const action = values.assigneeId !== undefined && values.assigneeId !== current.assigneeId ? 'assign' : 'update';
    const issue = await prisma.$transaction(async tx => {
      await tx.issue.update({ where: { id: current.id }, data });
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
