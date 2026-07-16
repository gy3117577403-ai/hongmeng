import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { changeDetailInclude, changeSnapshot, loadChangeById, parseChangeInput, serializeChange } from '@/lib/changes';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const change = await loadChangeById(params.id);
    if (!change) return NextResponse.json({ ok: false, error: '变更不存在或已删除' }, { status: 404 });
    return NextResponse.json({ ok: true, change: serializeChange(change) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change detail failed', error);
    return NextResponse.json({ ok: false, error: '变更详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.changeRequest.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '变更不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
      return NextResponse.json({ ok: false, error: '变更已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    const parsed = parseChangeInput(body, true);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const values = parsed.data;
    if (values.workOrderId) {
      const exists = await prisma.workOrder.findFirst({ where: { id: values.workOrderId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '关联工单不存在' }, { status: 404 });
    }
    if (values.sourceIssueId) {
      const exists = await prisma.issue.findFirst({ where: { id: values.sourceIssueId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '来源问题不存在或已删除' }, { status: 404 });
    }
    if (values.ownerId) {
      const exists = await prisma.user.findFirst({ where: { id: values.ownerId, isActive: true }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '负责人不存在或已停用' }, { status: 404 });
    }
    const data: Prisma.ChangeRequestUncheckedUpdateInput = { version: { increment: 1 } };
    for (const field of ['title', 'type', 'priority', 'reason', 'description', 'impactAreas', 'impactScope', 'implementationPlan', 'implementationResult', 'validationResult', 'rollbackPlan', 'sourceIssueId', 'workOrderId', 'ownerId', 'dueAt', 'effectiveAt'] as const) {
      if (values[field] !== undefined) (data as Record<string, unknown>)[field] = values[field];
    }
    if (Object.keys(data).length === 1) return NextResponse.json({ ok: false, error: '没有可更新字段' }, { status: 400 });
    const changedFields = Object.keys(data).filter(field => field !== 'version');
    const change = await prisma.$transaction(async tx => {
      const updated = await tx.changeRequest.updateMany({ where: { id: current.id, version: current.version, deletedAt: null }, data });
      if (updated.count !== 1) return null;
      const changed = await tx.changeRequest.findUniqueOrThrow({ where: { id: current.id } });
      await tx.changeActivity.create({ data: { changeRequestId: current.id, action: values.ownerId !== undefined && values.ownerId !== current.ownerId ? 'assign' : 'update', content: '更新变更信息', actorId: user.id, detail: { fields: changedFields } } });
      await tx.dataChangeSnapshot.create({ data: { entityType: 'change_request', entityId: current.id, action: 'update_change_request', beforeJson: changeSnapshot(current), afterJson: changeSnapshot(changed), changedBy: user.displayName || user.username } });
      return tx.changeRequest.findUniqueOrThrow({ where: { id: current.id }, include: changeDetailInclude });
    });
    if (!change) return NextResponse.json({ ok: false, error: '变更已被其他操作更新，请刷新后重试' }, { status: 409 });
    await logOp({ userId: user.id, action: 'update_change_request', targetType: 'change_request', targetId: current.id, detail: { fields: changedFields } });
    return NextResponse.json({ ok: true, change: serializeChange(change) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change update failed', error);
    return NextResponse.json({ ok: false, error: '变更更新失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.changeRequest.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '变更不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
      return NextResponse.json({ ok: false, error: '变更已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    await prisma.$transaction(async tx => {
      const updated = await tx.changeRequest.updateMany({ where: { id: current.id, version: current.version, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error('VERSION_CONFLICT');
      const changed = await tx.changeRequest.findUniqueOrThrow({ where: { id: current.id } });
      await tx.changeActivity.create({ data: { changeRequestId: current.id, action: 'delete', content: '删除变更', actorId: user.id } });
      await tx.dataChangeSnapshot.create({ data: { entityType: 'change_request', entityId: current.id, action: 'delete_change_request', beforeJson: changeSnapshot(current), afterJson: changeSnapshot(changed), changedBy: user.displayName || user.username } });
    });
    await logOp({ userId: user.id, action: 'delete_change_request', targetType: 'change_request', targetId: current.id, detail: { sequence: current.sequence } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'VERSION_CONFLICT') return NextResponse.json({ ok: false, error: '变更已被其他操作更新，请刷新后重试' }, { status: 409 });
    console.error('change delete failed', error);
    return NextResponse.json({ ok: false, error: '变更删除失败' }, { status: 500 });
  }
}
