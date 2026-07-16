import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  CHANGE_PRIORITIES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  changeDetailInclude,
  changeSnapshot,
  parseChangeInput,
  serializeChange,
  summarizeChanges,
} from '@/lib/changes';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import type { ChangePriority, ChangeStatus, ChangeType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const status = params.get('status');
    const type = params.get('type');
    const priority = params.get('priority');
    const ownerId = String(params.get('ownerId') || '').trim();
    const workOrderId = String(params.get('workOrderId') || '').trim();
    const sourceIssueId = String(params.get('sourceIssueId') || '').trim();
    const overdueOnly = params.get('overdue') === 'true';
    const unassignedOnly = params.get('unassigned') === 'true';
    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 40, 100);

    if (status && status !== 'all' && !CHANGE_STATUSES.includes(status as ChangeStatus)) {
      return NextResponse.json({ ok: false, error: '变更状态筛选不正确' }, { status: 400 });
    }
    if (type && type !== 'all' && !CHANGE_TYPES.includes(type as ChangeType)) {
      return NextResponse.json({ ok: false, error: '变更类型筛选不正确' }, { status: 400 });
    }
    if (priority && priority !== 'all' && !CHANGE_PRIORITIES.includes(priority as ChangePriority)) {
      return NextResponse.json({ ok: false, error: '优先级筛选不正确' }, { status: 400 });
    }

    const where: Prisma.ChangeRequestWhereInput = { deletedAt: null };
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.type = type;
    if (priority && priority !== 'all') where.priority = priority;
    if (ownerId) where.ownerId = ownerId;
    if (workOrderId) where.workOrderId = workOrderId;
    if (sourceIssueId) where.sourceIssueId = sourceIssueId;
    if (unassignedOnly) where.ownerId = null;
    if (overdueOnly) {
      where.status = { not: 'closed' };
      where.dueAt = { lt: new Date() };
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { reason: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { impactScope: { contains: keyword, mode: 'insensitive' } },
        { implementationPlan: { contains: keyword, mode: 'insensitive' } },
        { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
        { sourceIssue: { title: { contains: keyword, mode: 'insensitive' } } },
      ];
      const sequence = Number(keyword.replace(/^CHG-/i, ''));
      if (Number.isInteger(sequence) && sequence > 0) where.OR.push({ sequence });
    }

    const [records, total, summary] = await Promise.all([
      prisma.changeRequest.findMany({
        where,
        include: changeDetailInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.changeRequest.count({ where }),
      summarizeChanges(),
    ]);
    return NextResponse.json({
      ok: true,
      changes: records.map(serializeChange),
      summary,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change list failed', error);
    return NextResponse.json({ ok: false, error: '变更列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseChangeInput(body);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const data = parsed.data;

    let workOrderId = data.workOrderId || null;
    if (data.sourceIssueId) {
      const issue = await prisma.issue.findFirst({ where: { id: data.sourceIssueId, deletedAt: null }, select: { id: true, workOrderId: true } });
      if (!issue) return NextResponse.json({ ok: false, error: '来源问题不存在或已删除' }, { status: 404 });
      workOrderId ||= issue.workOrderId;
    }
    if (workOrderId) {
      const exists = await prisma.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '关联工单不存在' }, { status: 404 });
    }
    if (data.ownerId) {
      const exists = await prisma.user.findFirst({ where: { id: data.ownerId, isActive: true }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '负责人不存在或已停用' }, { status: 404 });
    }

    const change = await prisma.$transaction(async tx => {
      const created = await tx.changeRequest.create({
        data: {
          title: data.title as string,
          type: data.type || 'drawing',
          priority: data.priority || 'normal',
          reason: data.reason,
          description: data.description,
          impactAreas: data.impactAreas || [],
          impactScope: data.impactScope,
          implementationPlan: data.implementationPlan,
          implementationResult: data.implementationResult,
          validationResult: data.validationResult,
          rollbackPlan: data.rollbackPlan,
          sourceIssueId: data.sourceIssueId,
          workOrderId,
          ownerId: data.ownerId,
          requesterId: user.id,
          dueAt: data.dueAt,
          effectiveAt: data.effectiveAt,
        },
      });
      await tx.changeActivity.create({ data: { changeRequestId: created.id, action: 'create', content: '创建变更草稿', actorId: user.id } });
      await tx.dataChangeSnapshot.create({
        data: { entityType: 'change_request', entityId: created.id, action: 'create_change_request', afterJson: changeSnapshot(created), changedBy: user.displayName || user.username },
      });
      return tx.changeRequest.findUniqueOrThrow({ where: { id: created.id }, include: changeDetailInclude });
    });
    await logOp({ userId: user.id, action: 'create_change_request', targetType: 'change_request', targetId: change.id, detail: { sequence: change.sequence, type: change.type, priority: change.priority } });
    return NextResponse.json({ ok: true, change: serializeChange(change) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change create failed', error);
    return NextResponse.json({ ok: false, error: '变更创建失败' }, { status: 500 });
  }
}
