import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  issueCode,
  issueDetailInclude,
  parseIssueInput,
  serializeIssue,
  summarizeIssues,
} from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  createIssueWorkOrder,
  issueWorkOrderOptionSelect,
  IssueWorkOrderConflictError,
  parseIssueWorkOrderDraft,
  serializeIssueWorkOrderOption,
} from '@/lib/issue-work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';
import type { IssuePriority, IssueStatus, IssueType, IssueWorkOrderDraftDTO } from '@/types';

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
    const assigneeId = String(params.get('assigneeId') || '').trim();
    const workOrderId = String(params.get('workOrderId') || '').trim();
    const sourceType = String(params.get('sourceType') || '').trim();
    const overdueOnly = params.get('overdue') === 'true';
    const unassignedOnly = params.get('unassigned') === 'true';
    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 40, 100);

    if (status && status !== 'all' && !ISSUE_STATUSES.includes(status as IssueStatus)) {
      return NextResponse.json({ ok: false, error: '问题状态筛选不正确' }, { status: 400 });
    }
    if (type && type !== 'all' && !ISSUE_TYPES.includes(type as IssueType)) {
      return NextResponse.json({ ok: false, error: '问题类型筛选不正确' }, { status: 400 });
    }
    if (priority && priority !== 'all' && !ISSUE_PRIORITIES.includes(priority as IssuePriority)) {
      return NextResponse.json({ ok: false, error: '优先级筛选不正确' }, { status: 400 });
    }

    const where: Prisma.IssueWhereInput = { deletedAt: null };
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.type = type;
    if (priority && priority !== 'all') where.priority = priority;
    if (assigneeId) where.assigneeEmployeeId = assigneeId;
    if (workOrderId) where.workOrderId = workOrderId;
    if (sourceType) where.sourceType = sourceType;
    if (unassignedOnly) {
      where.assigneeId = null;
      where.assigneeEmployeeId = null;
    }
    if (overdueOnly) {
      where.status = { not: 'closed' };
      where.dueAt = { lt: new Date() };
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { sourceCode: { contains: keyword, mode: 'insensitive' } },
        { rootCause: { contains: keyword, mode: 'insensitive' } },
        { solution: { contains: keyword, mode: 'insensitive' } },
        { processName: { contains: keyword, mode: 'insensitive' } },
        { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { businessCode: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
        { assigneeEmployee: { name: { contains: keyword, mode: 'insensitive' } } },
        { assigneeEmployee: { employeeNo: { contains: keyword, mode: 'insensitive' } } },
      ];
      const sequence = Number(keyword.replace(/^ISS-/i, ''));
      if (Number.isInteger(sequence) && sequence > 0) where.OR.push({ sequence });
    }

    const [records, total, summary] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: issueDetailInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.issue.count({ where }),
      summarizeIssues(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({
      ok: true,
      issues: records.map(serializeIssue),
      summary,
      pagination: { page, pageSize, total, totalPages },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue list failed', error);
    return NextResponse.json({ ok: false, error: '问题列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let submittedWorkOrderDraft: IssueWorkOrderDraftDTO | null = null;
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseIssueInput(body);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const data = parsed.data;
    const parsedWorkOrder = parseIssueWorkOrderDraft(body.newWorkOrderDraft);
    if (parsedWorkOrder.errors.length) return NextResponse.json({ ok: false, error: parsedWorkOrder.errors[0] }, { status: 400 });
    submittedWorkOrderDraft = parsedWorkOrder.draft;
    if (submittedWorkOrderDraft && data.workOrderId) {
      return NextResponse.json({ ok: false, error: '不能同时选择已有工单和新建工单' }, { status: 400 });
    }

    if (data.workOrderId) {
      const exists = await prisma.workOrder.findFirst({ where: { id: data.workOrderId, deletedAt: null }, select: { id: true } });
      if (!exists) return NextResponse.json({ ok: false, error: '关联工单不存在' }, { status: 404 });
    }
    const collaboratorEmployeeIds = (data.collaboratorEmployeeIds || [])
      .filter(id => id !== data.assigneeEmployeeId);
    const employeeIds = Array.from(new Set([
      ...(data.assigneeEmployeeId ? [data.assigneeEmployeeId] : []),
      ...collaboratorEmployeeIds,
    ]));
    if (employeeIds.length) {
      const employees = await prisma.employee.count({ where: { id: { in: employeeIds }, isActive: true } });
      if (employees !== employeeIds.length) return NextResponse.json({ ok: false, error: '负责人或协同人员不存在、已离职或已停用' }, { status: 404 });
    }

    if (body.allowDuplicate !== true && data.workOrderId) {
      const duplicateSignals: Prisma.IssueWhereInput[] = [
        { title: { equals: data.title as string, mode: 'insensitive' } },
      ];
      if (data.processName) duplicateSignals.push({ processName: { equals: data.processName, mode: 'insensitive' } });
      const duplicate = await prisma.issue.findFirst({
        where: {
          deletedAt: null,
          status: { not: 'closed' },
          workOrderId: data.workOrderId,
          type: data.type || 'production',
          OR: duplicateSignals,
        },
        select: { id: true, sequence: true, title: true, status: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (duplicate) {
        return NextResponse.json({
          ok: false,
          error: '检测到同一工单下可能重复的问题，请先核对',
          duplicateIssue: { id: duplicate.id, code: issueCode(duplicate.sequence), title: duplicate.title, status: duplicate.status },
        }, { status: 409 });
      }
    }

    const result = await prisma.$transaction(async tx => {
      const createdWorkOrder = submittedWorkOrderDraft
        ? await createIssueWorkOrder(tx, submittedWorkOrderDraft, user.id)
        : null;
      const workOrderId = createdWorkOrder?.id || data.workOrderId || null;
      const created = await tx.issue.create({
        data: {
          title: data.title as string,
          type: data.type || 'production',
          priority: data.priority || 'normal',
          description: data.description,
          workOrderId,
          assigneeEmployeeId: data.assigneeEmployeeId,
          processName: data.processName,
          affectedQuantity: data.affectedQuantity,
          temporaryMeasure: data.temporaryMeasure,
          dueAt: data.dueAt,
          rootCause: data.rootCause,
          solution: data.solution,
          reporterId: user.id,
          sourceType: 'manual',
          sourceId: workOrderId,
          sourceRoute: workOrderId ? `/dashboard?workOrderId=${encodeURIComponent(workOrderId)}` : '/workspace/issues',
          collaborators: collaboratorEmployeeIds.length
            ? { create: collaboratorEmployeeIds.map(employeeId => ({ employeeId })) }
            : undefined,
        },
      });
      await tx.issueActivity.create({
        data: {
          issueId: created.id,
          action: 'create',
          content: '创建问题',
          actorId: user.id,
          detail: {
            assigneeEmployeeId: data.assigneeEmployeeId || null,
            collaboratorCount: collaboratorEmployeeIds.length,
            createdWorkOrderId: createdWorkOrder?.id || null,
          },
        },
      });
      const issue = await tx.issue.findUniqueOrThrow({ where: { id: created.id }, include: issueDetailInclude });
      return { issue, createdWorkOrder };
    });
    if (result.createdWorkOrder) {
      await snapshotChange({
        entityType: 'work_order',
        entityId: result.createdWorkOrder.id,
        action: 'create_work_order_from_issue',
        after: workOrderSnapshot(result.createdWorkOrder),
        changedBy: user.displayName || user.username,
      });
    }
    await logOp({
      userId: user.id,
      action: 'create_issue',
      targetType: 'issue',
      targetId: result.issue.id,
      detail: {
        code: result.issue.sequence,
        type: result.issue.type,
        priority: result.issue.priority,
        createdWorkOrderId: result.createdWorkOrder?.id || null,
      },
    });
    return NextResponse.json({
      ok: true,
      issue: serializeIssue(result.issue),
      createdWorkOrder: result.createdWorkOrder
        ? serializeIssueWorkOrderOption(result.createdWorkOrder)
        : null,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof IssueWorkOrderConflictError) {
      return NextResponse.json({
        ok: false,
        error: error.softDeleted
          ? '该工单号存在于回收站，请先恢复工单或更换工单号'
          : '工单号已存在，请核对后使用已有工单',
        conflictType: error.softDeleted ? 'soft_deleted' : 'existing',
        existingWorkOrder: error.softDeleted ? undefined : error.existingWorkOrder,
      }, { status: 409 });
    }
    if ((error as { code?: string }).code === 'P2002' && submittedWorkOrderDraft?.code) {
      const existing = await prisma.workOrder.findFirst({
        where: { code: { equals: submittedWorkOrderDraft.code, mode: 'insensitive' } },
        select: issueWorkOrderOptionSelect,
      });
      if (existing) {
        return NextResponse.json({
          ok: false,
          error: existing.deletedAt
            ? '该工单号存在于回收站，请先恢复工单或更换工单号'
            : '工单号已存在，请核对后使用已有工单',
          conflictType: existing.deletedAt ? 'soft_deleted' : 'existing',
          existingWorkOrder: existing.deletedAt ? undefined : serializeIssueWorkOrderOption(existing),
        }, { status: 409 });
      }
    }
    console.error('issue create failed', error);
    return NextResponse.json({ ok: false, error: '问题创建失败' }, { status: 500 });
  }
}
